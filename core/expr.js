// SimCore 미니 표현식 언어 — 파서 + 평가기
// 지원: 숫자/문자열 리터럴, 변수 참조, + - * / %, 비교(== != > < >= <=),
//       and/or/not, 3항(?:), 괄호, 함수 round/floor/ceil/abs/min/max/clamp/rand
// 비지원(의도적): 대입, 루프, 프로퍼티 접근, 임의 함수 — 카드는 코드가 아니다.

const FUNCS = {
  round: (a) => Math.round(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  abs: (a) => Math.abs(a),
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  // rand는 평가 컨텍스트의 rng를 사용 (시드 RNG 주입)
  // count/has/sum은 목록(list) 인자를 받으므로 evalAst에서 직접 처리
};

const FUNC_ARITY = {
  round: [1, 1], floor: [1, 1], ceil: [1, 1], abs: [1, 1],
  min: [2, Infinity], max: [2, Infinity], clamp: [3, 3], rand: [2, 2],
  count: [1, 1], has: [2, 2], sum: [1, 2],
};

/**
 * 목록 항목의 기한 표시 `@숫자` — 그 항목이 끝나는 시점(보통 절대 경과일).
 * 남은 일수가 아니라 **끝나는 날**을 적는 이유: 남은 일수로 하면 매 턴 전부 1씩 깎아야 하는데
 * 미니 표현식엔 반복문이 없어 애초에 불가능하고, 절대값이면 날짜를 며칠씩 건너뛰어도 저절로 맞는다.
 * @returns {number|null}
 */
function itemExpiry(s) {
  // 음수도 기한으로 읽는다 (v0.87.2) — 보조 AI가 "@-22"처럼 쓰면 이미 지난 기한이라
  // 다음 만료 정리에서 즉시 빠진다. 실사고: 음수가 패턴에 안 걸려 null(무기한)이 되는 바람에
  // 지난 일정이 영영 안 지워지는 유령 항목이 됐다 ("거리 홍보 및 게릴라 버스킹 @-22").
  const m = String(s).match(/@(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * 목록 항목에서 숫자를 뽑는다 — sum()의 파싱 규칙이자, 패널이 항목별 값을 보여줄 때 쓰는 것과 같은 함수.
 *
 * 규칙은 딱 하나: **숫자가 항목 맨 끝에 있어야 한다.** ("양모 계약 +12" → 12)
 * "아무 데나 있는 마지막 숫자"로 하면 "양모 계약 12 (30일)"이 30으로 조용히 잘못 잡힌다.
 * 끝을 강제하면 그런 항목은 아예 0이 되고, 패널이 '숫자 없음'으로 표시해 눈에 띈다.
 * 조용히 틀리는 것보다 드러나게 실패하는 쪽이 낫다.
 *
 * 기한 표시는 먼저 떼어낸다. 안 그러면 "성벽 부역 @450"이 하루 450짜리 수입으로 잡힌다.
 * @returns {number|null} 숫자가 없으면 null
 */
function itemValue(s) {
  // 기한 떼기도 음수까지 (itemExpiry와 같은 패턴) — 안 떼면 "@-22"의 -22가 값으로 잡힌다
  const m = String(s).replace(/@-?\d+(?:\.\d+)?/g, '').match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  return m ? parseFloat(m[1]) : null;
}

// ── 토크나이저 ──────────────────────────────────────────────

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value) => tokens.push({ type, value, pos: i });
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    // 숫자
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i, seenDot = false;
      while (j < src.length && (/[0-9]/.test(src[j]) || (src[j] === '.' && !seenDot))) {
        if (src[j] === '.') seenDot = true;
        j++;
      }
      push('num', parseFloat(src.slice(i, j)));
      i = j; continue;
    }
    // 문자열 ('...' 또는 "...")
    if (c === "'" || c === '"') {
      let j = i + 1, buf = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { buf += src[j + 1]; j += 2; }
        else { buf += src[j]; j++; }
      }
      if (j >= src.length) throw new ExprError(`닫히지 않은 문자열 (위치 ${i})`);
      push('str', buf);
      i = j + 1; continue;
    }
    // 식별자 / 키워드
    if (/[A-Za-z_가-힣]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_가-힣]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === 'and' || word === 'or' || word === 'not') push('op', word);
      else if (word === 'true') push('num', 1);
      else if (word === 'false') push('num', 0);
      else push('ident', word);
      i = j; continue;
    }
    // 연산자
    const two = src.slice(i, i + 2);
    if (['==', '!=', '>=', '<='].includes(two)) { push('op', two); i += 2; continue; }
    if ('+-*/%<>()?:,'.includes(c)) { push(c === '(' || c === ')' || c === ',' ? c : 'op', c); i++; continue; }
    throw new ExprError(`알 수 없는 문자 '${c}' (위치 ${i})`);
  }
  push('eof', null);
  return tokens;
}

// ── 파서 (Pratt) ────────────────────────────────────────────
// AST: {t:'num'|'str'|'var'|'bin'|'un'|'ternary'|'call', ...}

const BIN_PREC = {
  'or': 1, 'and': 2,
  '==': 3, '!=': 3, '>': 3, '<': 3, '>=': 3, '<=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
};

class ExprError extends Error {}

function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    const t = next();
    if (t.type !== type) throw new ExprError(`'${type}' 필요, '${t.value ?? t.type}' 발견 (위치 ${t.pos})`);
    return t;
  };

  function parsePrimary() {
    const t = next();
    if (t.type === 'num') return { t: 'num', v: t.value };
    if (t.type === 'str') return { t: 'str', v: t.value };
    if (t.type === 'ident') {
      if (peek().type === '(') {
        next(); // (
        const args = [];
        if (peek().type !== ')') {
          args.push(parseExpr(0));
          while (peek().type === ',') { next(); args.push(parseExpr(0)); }
        }
        expect(')');
        if (!(t.value in FUNC_ARITY)) throw new ExprError(`알 수 없는 함수 '${t.value}'`);
        const [lo, hi] = FUNC_ARITY[t.value];
        if (args.length < lo || args.length > hi)
          throw new ExprError(`${t.value}() 인자 개수 오류 (${args.length}개)`);
        return { t: 'call', fn: t.value, args };
      }
      return { t: 'var', name: t.value };
    }
    if (t.type === 'op' && (t.value === '-' || t.value === 'not')) {
      return { t: 'un', op: t.value, e: parsePrimary() };
    }
    if (t.type === '(') {
      const e = parseExpr(0);
      expect(')');
      return e;
    }
    throw new ExprError(`예상치 못한 토큰 '${t.value ?? t.type}' (위치 ${t.pos})`);
  }

  function parseExpr(minPrec) {
    let left = parsePrimary();
    for (;;) {
      const t = peek();
      if (t.type === 'op' && t.value === '?' ) {
        if (minPrec > 0) break;
        next();
        const a = parseExpr(0);
        const colon = next();
        if (!(colon.type === 'op' && colon.value === ':'))
          throw new ExprError(`3항 연산자에 ':' 필요 (위치 ${colon.pos})`);
        const b = parseExpr(0);
        left = { t: 'ternary', c: left, a, b };
        continue;
      }
      if (t.type !== 'op' || !(t.value in BIN_PREC)) break;
      const prec = BIN_PREC[t.value];
      if (prec < minPrec) break;
      next();
      const right = parseExpr(prec + 1);
      left = { t: 'bin', op: t.value, l: left, r: right };
    }
    return left;
  }

  const ast = parseExpr(0);
  expect('eof');
  return ast;
}

// ── 평가기 ──────────────────────────────────────────────────
// env: { lookup(name) -> value | undefined, rng: () => [0,1) }

function truthy(v) {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

function asNum(v, ctx) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) return Number(v);
  throw new ExprError(`숫자가 필요한 곳에 '${v}' (${ctx})`);
}

function evalAst(ast, env) {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'str': return ast.v;
    case 'var': {
      const v = env.lookup(ast.name);
      if (v === undefined) throw new ExprError(`알 수 없는 변수 '${ast.name}'`);
      return typeof v === 'boolean' ? (v ? 1 : 0) : v;
    }
    case 'un': {
      const v = evalAst(ast.e, env);
      if (ast.op === '-') return -asNum(v, '단항 -');
      return truthy(v) ? 0 : 1; // not
    }
    case 'ternary':
      return truthy(evalAst(ast.c, env)) ? evalAst(ast.a, env) : evalAst(ast.b, env);
    case 'call': {
      const args = ast.args.map((a) => evalAst(a, env));
      if (ast.fn === 'rand') {
        const [lo, hi] = [asNum(args[0], 'rand'), asNum(args[1], 'rand')];
        if (!env.rng) throw new ExprError('rand()를 지원하지 않는 컨텍스트');
        return Math.floor(env.rng() * (hi - lo + 1)) + lo; // 정수 [lo, hi]
      }
      if (ast.fn === 'count') {
        const v = args[0];
        if (Array.isArray(v)) return v.length;
        if (typeof v === 'string') return v.length;
        return asNum(v, 'count');
      }
      if (ast.fn === 'has') {
        const [arr, item] = args;
        if (Array.isArray(arr)) return arr.includes(String(item)) ? 1 : 0;
        if (typeof arr === 'string') return arr.includes(String(item)) ? 1 : 0;
        return 0;
      }
      if (ast.fn === 'sum') {
        const [arr, filter] = args;
        if (!Array.isArray(arr)) return 0;
        const f = args.length > 1 ? String(filter) : null;
        let total = 0;
        for (const it of arr) {
          const s = String(it);
          if (f && !s.includes(f)) continue;
          total += itemValue(s) ?? 0;
        }
        return total;
      }
      return FUNCS[ast.fn](...args.map((v, i) => asNum(v, `${ast.fn}() 인자${i + 1}`)));
    }
    case 'bin': {
      const op = ast.op;
      if (op === 'and') return truthy(evalAst(ast.l, env)) ? (truthy(evalAst(ast.r, env)) ? 1 : 0) : 0;
      if (op === 'or') return truthy(evalAst(ast.l, env)) ? 1 : (truthy(evalAst(ast.r, env)) ? 1 : 0);
      const l = evalAst(ast.l, env);
      const r = evalAst(ast.r, env);
      if (op === '==') return eq(l, r) ? 1 : 0;
      if (op === '!=') return eq(l, r) ? 0 : 1;
      if (op === '+' && (typeof l === 'string' || typeof r === 'string')) return String(l) + String(r);
      const ln = asNum(l, `'${op}' 좌변`), rn = asNum(r, `'${op}' 우변`);
      switch (op) {
        case '+': return ln + rn;
        case '-': return ln - rn;
        case '*': return ln * rn;
        case '/': return rn === 0 ? 0 : ln / rn; // 0 나눗셈은 0 (봇이 죽는 것보다 낫다)
        case '%': return rn === 0 ? 0 : ln % rn;
        case '>': return ln > rn ? 1 : 0;
        case '<': return ln < rn ? 1 : 0;
        case '>=': return ln >= rn ? 1 : 0;
        case '<=': return ln <= rn ? 1 : 0;
      }
    }
  }
  throw new ExprError(`평가 불가 노드: ${ast.t}`);
}

function eq(l, r) {
  if (typeof l === 'string' || typeof r === 'string') return String(l) === String(r);
  return asNum(l, '==') === asNum(r, '==');
}

// ── 공개 API ────────────────────────────────────────────────

const cache = new Map();

/** 표현식 컴파일 (파스 에러는 여기서 던져짐 — 스키마 검증 시 사용) */
function compile(src) {
  if (!cache.has(src)) cache.set(src, parse(src));
  const ast = cache.get(src);
  return (lookup, rng) => evalAst(ast, { lookup, rng });
}

/** 원샷 평가 */
function evaluate(src, lookup, rng) {
  return compile(src)(lookup, rng);
}

/** 표현식이 참조하는 변수 이름 목록 (스키마 검증용) */
function referencedVars(src) {
  const names = new Set();
  (function walk(n) {
    if (n.t === 'var') names.add(n.name);
    if (n.t === 'bin') { walk(n.l); walk(n.r); }
    if (n.t === 'un') walk(n.e);
    if (n.t === 'ternary') { walk(n.c); walk(n.a); walk(n.b); }
    if (n.t === 'call') n.args.forEach(walk);
  })(parse(src));
  return [...names];
}

/**
 * 식 안의 변수 참조를 새 이름으로 (패치 충돌 개명용 — patch.js).
 * 토큰 단위라 문자열 리터럴 속 같은 글자("gold")나 다른 식별자(gold2)는 안 건드린다.
 * 정규식 치환으로 하면 has(목록, "gold")의 따옴표 안까지 바뀌는 사고가 난다.
 */
function renameVar(src, oldId, newId) {
  const s = String(src);
  let tokens;
  try { tokens = tokenize(s); }
  catch (e) { return s; }   // 깨진 식은 손대지 않는다 — 어차피 병합 후 검증이 잡는다
  let out = '', last = 0;
  for (const t of tokens) {
    if (t.type === 'ident' && t.value === oldId) {
      out += s.slice(last, t.pos) + newId;
      last = t.pos + oldId.length;
    }
  }
  return out + s.slice(last);
}

module.exports = { compile, evaluate, referencedVars, renameVar, ExprError, truthy, itemValue, itemExpiry };
