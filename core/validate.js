// 스키마 검증 — 제작자 경험의 절반. 오류는 위치(path)와 함께 전부 수집해서 돌려준다.

const { compile, referencedVars, ExprError } = require('./expr');
const { parseStart, timeConfig, EXPOSABLE, SKIP_DAY, SKIP_MIN, EPOCH_KEY,
  RANDOM_BOUNDS: TIME_RANDOM_BOUNDS } = require('./time');

const VAR_TYPES = ['int', 'float', 'text', 'bool', 'enum', 'list'];
const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// 숫자 대응표 라벨 감지 — "계절 (0겨울 1봄 2여름 3가을)"처럼 코드북을 라벨에 넣는 AI 상습 실수.
// 한 자리 숫자+낱말 짝이 **서로 다른 숫자로 3개 이상**이어야 잡는다 ("201호"·"2층 3호"류 오탐 방지).
function codebookDigits(label) {
  if (typeof label !== 'string') return 0;
  const re = /(?<![0-9가-힣a-zA-Z])([0-9])[=:]?[가-힣a-zA-Z]/g;
  const digits = new Set();
  let m;
  while ((m = re.exec(label))) digits.add(m[1]);
  return digits.size;
}
const RESERVED = new Set(['true', 'false', 'and', 'or', 'not',
  'round', 'floor', 'ceil', 'abs', 'min', 'max', 'clamp', 'rand', 'count', 'has', 'sum']);

/**
 * 변수 하나 없이도 실제로 뭔가를 하는 기능이 켜져 있나 — 에셋 전용 설치의 통과 조건.
 * 나머지 기능(상태창·이벤트·시간·편성·달력·판정)은 전부 변수를 읽거나 쓰므로 여기 없다.
 */
function varFreeWork(schema) {
  if (Array.isArray(schema.assets?.packs) && schema.assets.packs.length) return true;
  if (schema.suggest) return true;
  return false;
}

function validateSchema(schema) {
  const errors = [];
  const warnings = [];
  const err = (path, msg) => errors.push({ path, msg });
  const warn = (path, msg) => warnings.push({ path, msg });

  if (!schema || typeof schema !== 'object') {
    return { ok: false, errors: [{ path: '$', msg: '스키마가 JSON 객체가 아님' }], warnings };
  }
  if (schema.simcore !== '0.1') warn('$.simcore', `지원 버전은 0.1 (현재: ${schema.simcore})`);

  // ── vars ──
  const vars = Array.isArray(schema.vars) ? schema.vars : [];
  // 변수 0개 — v0.64까지는 무조건 오류였다. 그런데 에셋 팩(이미지 태그 자동화)은 상태를
  // 하나도 안 본다. 그것만 쓰려는 제작자에게 "쓰지도 않을 변수를 하나 만들어라"라고 하는 건
  // 설계가 아니라 통행세다. 그래서 **변수 없이도 도는 기능이 실제로 켜져 있으면** 통과시키고,
  // 정말로 아무 일도 안 하는 빈 스키마만 막는다.
  if (!Array.isArray(schema.vars)) {
    err('$.vars', 'vars는 배열이어야 합니다 (변수를 안 쓰더라도 빈 배열 []은 있어야 함)');
  } else if (!vars.length) {
    if (varFreeWork(schema)) {
      warn('$.vars', '변수가 없습니다 — 에셋(이미지 태그)만 쓰는 봇으로 설치됩니다. '
        + '상태창·명령·이벤트·시간은 뜨지 않습니다');
    } else {
      err('$.vars', '변수가 하나도 정의되지 않음 — 변수 없이 도는 기능(에셋 팩)이라도 하나는 켜져 있어야 합니다');
    }
  }
  const ids = new Set();
  const cmdNames = new Set();
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i], p = `$.vars[${i}]`;
    if (!v.id || !ID_RE.test(v.id)) { err(p, `잘못된 id: '${v.id}' (영문자/숫자/_, 영문자 시작)`); continue; }
    if (RESERVED.has(v.id)) err(p, `'${v.id}'는 예약어라 변수 id로 쓸 수 없음`);
    if (ids.has(v.id)) err(p, `중복된 id: '${v.id}'`);
    ids.add(v.id);
    if (!VAR_TYPES.includes(v.type)) err(p, `알 수 없는 type: '${v.type}'`);
    if (v.type === 'enum') {
      if (!Array.isArray(v.enum) || v.enum.length < 2) err(p, 'enum 타입은 enum 배열(2개 이상) 필요');
      else if (v.init !== undefined && !v.enum.includes(v.init)) err(p, `init '${v.init}'이 enum 목록에 없음`);
    }
    if ((v.type === 'int' || v.type === 'float')) {
      if (v.init !== undefined && typeof v.init !== 'number') err(p, 'init은 숫자여야 함');
      if (v.min != null && v.max != null && v.min > v.max) err(p, 'min > max');
      if (v.init !== undefined && v.min != null && v.init < v.min) err(p, 'init < min');
      if (v.init !== undefined && v.max != null && v.init > v.max) err(p, 'init > max');
      if (codebookDigits(v.label) >= 3) {
        warn(p, `라벨에 숫자 대응표가 보입니다 ('${v.label}') — 이 용도는 enum 타입이 정답입니다. `
          + `type: "enum", enum: ["겨울","봄",…]으로 바꾸면 화면과 보조 AI 양쪽에 숫자 대신 낱말이 갑니다`);
      }
    }
    if (v.type === 'bool' && v.init !== undefined && typeof v.init !== 'boolean')
      err(p, 'bool의 init은 true/false여야 함');
    if (v.type === 'text') {
      if (v.init !== undefined && typeof v.init !== 'string') err(p, 'text의 init은 문자열이어야 함');
      if (v.maxLength != null && (typeof v.maxLength !== 'number' || v.maxLength < 1))
        err(p, 'maxLength는 양수여야 함');
    }
    // 채팅 명령 이름 — 공백/'-'가 들어가면 파서가 인자와 구분을 못 한다
    // 상태창 자리표시자와 이름이 겹치면 {commands}가 그 변수로 잡혀 명령 목록이 안 나온다.
    if (v.id === 'commands' || v.id === 'lastcheck' || v.id === 'scenario') {
      warn(p, `'${v.id}'는 상태창 자리표시자 {${v.id}}가 쓰는 이름입니다 — 변수 id를 바꾸세요`);
    }
    if (v.cmd != null) {
      if (typeof v.cmd !== 'string' || !v.cmd.trim()) err(p, 'cmd는 비어있지 않은 문자열이어야 함');
      else if (/[\s\/-]/.test(v.cmd)) err(p, `cmd '${v.cmd}'에 공백·'/'·'-'는 쓸 수 없음`);
      else if (cmdNames.has(v.cmd)) err(p, `중복된 cmd: '${v.cmd}'`);
      else {
        cmdNames.add(v.cmd);
        // '/선택'은 갈림길(choices) 내장 명령 — 변수가 이 이름을 쓰면 갈림길 선택이 막힌다
        if (v.cmd === '선택') warn(p, `'선택'은 갈림길 선택 명령(/선택)이 쓰는 이름입니다 — 다른 이름을 권합니다`);
      }
    }
    if (v.type === 'list') {
      if (v.init !== undefined && !Array.isArray(v.init)) err(p, 'list의 init은 배열이어야 함');
      if (Array.isArray(v.init) && v.init.some((x) => typeof x !== 'string')) err(p, 'list 항목은 전부 문자열');
      if (v.maxItems != null && (typeof v.maxItems !== 'number' || v.maxItems < 1)) err(p, 'maxItems는 양수');
      if (v.itemMaxLength != null && (typeof v.itemMaxLength !== 'number' || v.itemMaxLength < 1)) err(p, 'itemMaxLength는 양수');
    }
  }

  // ── derived ──
  const derived = Array.isArray(schema.derived) ? schema.derived : [];
  const allIds = new Set(ids);
  // 시간 노출 파생(date/clock/…)은 조건식·템플릿에서 변수처럼 쓰인다 —
  // 파생·규칙 검사보다 먼저 이름을 등록해야 `hour >= 22` 같은 식이 통과한다.
  const tcfg = timeConfig(schema);
  const exposedNames = new Set(tcfg ? tcfg.expose : []);
  for (const n of exposedNames) allIds.add(n);
  // 편성 가상 목록 (v0.59) — 편성표가 있으면 'deployed'(편성 슬롯에 앉은 이름들)를
  // 어느 조건식·자리표시자에서든 쓸 수 있다: has(deployed, '아린'). 실행은 engine.makeLookup이 맡는다.
  if (schema.party != null && typeof schema.party === 'object' && !Array.isArray(schema.party)) {
    allIds.add('deployed');
  }
  // 시나리오 노출 (v0.90) — scn_act(막 id)·scn_label(라벨)·scn_turns(막 경과 턴).
  // 규칙·파생 검사보다 먼저 등록해야 `scn_act == "act2"` 같은 조건이 통과한다.
  if (schema.scenario != null && typeof schema.scenario === 'object' && !Array.isArray(schema.scenario)) {
    for (const n of ['scn_act', 'scn_label', 'scn_turns']) allIds.add(n);
  }
  for (let i = 0; i < derived.length; i++) {
    const d = derived[i], p = `$.derived[${i}]`;
    if (!d.id || !ID_RE.test(d.id)) { err(p, `잘못된 id: '${d.id}'`); continue; }
    // 시간 노출 이름과의 충돌은 "중복"이라고만 하면 원인을 못 찾는다 —
    // 파생 목록에는 하나뿐이라 유저가 아무리 봐도 짝을 못 찾는다 (실측: 변수 탭 통째 교체 후).
    if (exposedNames.has(d.id)) {
      err(p, `'${d.id}'는 시간 체계가 이미 쓰는 이름입니다 — 파생 이름을 바꾸거나, `
        + `[시간] 탭의 노출 목록에서 '${d.id}'를 빼세요 (직접 계산하는 달력을 쓰려면 시간 체계를 끄세요)`);
    } else if (allIds.has(d.id)) err(p, `중복된 id: '${d.id}'`);
    allIds.add(d.id);
    checkExpr(d.expr, p + '.expr', allIds, err, { allowRand: false });
    if (codebookDigits(d.label) >= 3) {
      warn(p, `라벨에 숫자 대응표가 보입니다 ('${d.label}') — 파생은 식이 낱말을 직접 반환할 수 있습니다. `
        + `조건식으로 "겨울"·"봄" 같은 문자열을 돌려주게 바꾸면 화면에 숫자 대신 낱말이 뜹니다`);
    }
  }

  // 리롤 안정 난수 (기본 켜짐) — 배선은 v0.1부터 있었는데 검증이 없어 오타가 조용히
  // 무시됐다. `rerollStable: false`라고 적고 "왜 리롤해도 같지"로 헤매는 자리다 (실기 제보).
  if (schema.rerollStableRng != null && typeof schema.rerollStableRng !== 'boolean')
    err('$.rerollStableRng', `rerollStableRng는 true/false여야 함 (현재: '${schema.rerollStableRng}')`);

  // ── time (시간 체계 — 설계: docs/design-시간.md) ──
  if (schema.time != null) {
    const T = schema.time;
    if (typeof T !== 'object' || Array.isArray(T)) err('$.time', 'time은 객체여야 함');
    else {
      const calendar = T.calendar ?? 'gregorian';
      if (!['gregorian', 'flat30'].includes(calendar))
        err('$.time.calendar', `calendar는 gregorian(실제 달력) | flat30(한 달 30일 × 12달) (현재: '${T.calendar}')`);
      if (T.start == null) err('$.time.start', 'start 필요 — "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm"');
      else if (!parseStart(T.start, calendar === 'flat30' ? 'flat30' : 'gregorian'))
        err('$.time.start', `'${T.start}'를 시작 시점으로 읽을 수 없음 — "YYYY-MM-DD HH:mm" 형식의 실재하는 날짜여야 함`);
      if (T.advance != null && !['explicit', 'perTurn'].includes(T.advance))
        err('$.time.advance', `advance는 explicit(명시적 진행만) | perTurn(턴마다 하루) (현재: '${T.advance}')`);
      // 시작 시각 무작위 (v0.80) — 칸마다 [최소, 최대]. 안 적은 칸은 start 값을 그대로 쓴다.
      // 조용히 무시되면 "켠 줄 알았는데 늘 같은 시각"이 되므로 형태 오류는 전부 잡는다.
      if (T.startRandom != null) {
        const SR = T.startRandom;
        const LABEL = { year: '년', month: '월', dom: '일', hour: '시', minute: '분' };
        if (typeof SR !== 'object' || Array.isArray(SR)) {
          err('$.time.startRandom', 'startRandom은 객체 — { hour: [6, 22], dom: [1, 28] } 처럼 칸마다 [최소, 최대]');
        } else {
          const keys = Object.keys(SR);
          if (!keys.length) warn('$.time.startRandom', '범위가 하나도 없습니다 — 무작위 시작이 꺼진 것과 같습니다 (칸을 채우거나 startRandom을 지우세요)');
          for (const k of keys) {
            const p = `$.time.startRandom.${k}`;
            if (!TIME_RANDOM_BOUNDS[k]) {
              err(p, `모르는 칸 '${k}' — ${Object.keys(TIME_RANDOM_BOUNDS).join(', ')} 중에서 고르세요`);
              continue;
            }
            const [bl, bh] = TIME_RANDOM_BOUNDS[k];
            const r = SR[k];
            if (!Array.isArray(r) || r.length !== 2 || r.some((n) => typeof n !== 'number' || !isFinite(n))) {
              err(p, `${LABEL[k]} 범위는 숫자 두 개 — [최소, 최대] (허용 ${bl}~${bh})`);
            } else if (r[0] > r[1]) {
              err(p, `${LABEL[k]} 범위의 최소가 최대보다 큽니다 (${r[0]} > ${r[1]})`);
            } else if (r[0] < bl || r[1] > bh) {
              err(p, `${LABEL[k]} 범위가 ${bl}~${bh}를 벗어납니다 (현재 ${r[0]}~${r[1]})`);
            }
          }
          // flat30은 한 달이 30일 — 31일을 뽑아 봐야 말일로 당겨지므로 알려 준다
          if (calendar === 'flat30' && Array.isArray(SR.dom) && SR.dom[1] > 30)
            warn('$.time.startRandom.dom', 'flat30 달력은 한 달이 30일입니다 — 31은 30으로 당겨집니다');
        }
      }
      if (T.format != null) {
        if (typeof T.format !== 'object' || Array.isArray(T.format)) err('$.time.format', 'format은 객체 — { date, clock }');
        else {
          if (T.format.date != null && (typeof T.format.date !== 'string' || !/YYYY|YY|MM|M|DD|D/.test(T.format.date)))
            err('$.time.format.date', `날짜 형식에 YYYY/YY/MM/M/DD/D 토큰이 하나도 없음 (현재: '${T.format.date}')`);
          if (T.format.clock != null && (typeof T.format.clock !== 'string' || !/HH|H|mm|m/.test(T.format.clock)))
            err('$.time.format.clock', `시각 형식에 HH/H/mm/m 토큰이 하나도 없음 (현재: '${T.format.clock}')`);
        }
      }
      if (T.weekdays != null && (!Array.isArray(T.weekdays) || T.weekdays.length !== 7
          || T.weekdays.some((w) => typeof w !== 'string' || !w.trim())))
        err('$.time.weekdays', '요일은 7개짜리 문자열 배열이어야 함 — 첫 칸이 월요일');
      if (T.seasons != null && (!Array.isArray(T.seasons) || T.seasons.length !== 4
          || T.seasons.some((s) => typeof s !== 'string' || !s.trim())))
        err('$.time.seasons', '계절은 4개짜리 문자열 배열이어야 함 — 봄·여름·가을·겨울 순');
      if (T.expose != null) {
        if (!Array.isArray(T.expose)) err('$.time.expose', 'expose는 이름 배열이어야 함');
        else for (const n of T.expose) {
          if (!EXPOSABLE.includes(n))
            err('$.time.expose', `'${n}'은 노출 가능한 이름이 아님 — 가능: ${EXPOSABLE.join(', ')}`);
        }
      }
      // 이름 충돌 — 노출 파생은 변수처럼 쓰이므로 같은 이름의 변수가 있으면 어느 쪽인지 알 수 없다.
      // (파생과의 충돌은 위 derived 검사가 그 자리에서 더 구체적으로 알려 준다)
      if (tcfg) {
        for (const n of tcfg.expose) {
          if (ids.has(n))
            err('$.time.expose', `노출 이름 '${n}'이 변수와 겹칩니다 — 변수를 지우거나(정리 마법사) expose에서 빼세요`);
        }
      }
      if (ids.has(EPOCH_KEY))
        err('$.vars', `'${EPOCH_KEY}'는 시간 체계가 쓰는 예약 키입니다 — 변수 id를 바꾸세요`);
      // 진행 입구 — explicit인데 skip 변수가 하나도 없으면 시간이 영영 안 흐른다
      const skipDefs = vars.filter((v) => v.id === SKIP_DAY || v.id === SKIP_MIN);
      if ((T.advance ?? 'explicit') === 'explicit' && !skipDefs.length)
        warn('$.time', `advance가 explicit인데 ${SKIP_DAY}/${SKIP_MIN} 변수가 없습니다 — 시간을 진행할 입구가 없어 `
          + '날짜가 영영 멈춥니다. int 변수를 만들어 allow에 올리거나(보조가 보고) 액션 효과로 굳히세요');
      for (const sv of skipDefs) {
        if (sv.type !== 'int')
          err(`$.vars`, `'${sv.id}'는 시간 진행 입구라 int여야 합니다 (현재: ${sv.type}) — 엔진이 매 턴 소비 후 0으로 되돌립니다`);
        else if (sv.min == null || sv.min < 0)
          warn('$.vars', `'${sv.id}'에 min: 0을 권합니다 — 음수 진행은 무시되지만 화면에는 음수가 남습니다`);
      }
    }
  }

  const listIds = new Set(vars.filter((v) => v.type === 'list').map((v) => v.id));
  // 판정 id는 여기서 미리 모은다 — 이벤트·액션의 check 참조 검사가 checks 구조 검증보다 먼저 돈다
  const checkIds = new Set((Array.isArray(schema.checks) ? schema.checks : []).map((c) => c.id).filter(Boolean));
  const checkRef = (x, p) => {
    if (x.check != null && (typeof x.check !== 'string' || !checkIds.has(x.check)))
      err(p, `check '${x.check}'가 checks(판정)에 없음`);
  };
  // 갈림길(choices) — 이벤트의 속성. 터지면 pending으로 들어가 유저가 /선택으로 고른다.
  const checkChoices = (e, p) => {
    if (e.choices == null) {
      if (e.timeout != null) warn(p, 'timeout은 choices(갈림길)와 함께 쓰는 값입니다 — choices가 없어 무시됩니다');
      return;
    }
    if (!Array.isArray(e.choices) || !e.choices.length) { err(p, 'choices는 비어있지 않은 배열이어야 함'); return; }
    if (e.choices.length === 1) warn(p, '선택지가 하나뿐입니다 — 갈림길이 아닙니다. 둘 이상을 두거나 choices를 빼세요');
    e.choices.forEach((c, ci) => {
      const cp = `${p}.choices[${ci}]`;
      if (!c.label || typeof c.label !== 'string' || !c.label.trim()) err(cp, '선택지 label 필요');
      if (c.when != null) checkExpr(c.when, cp + '.when', allIds, err, { allowRand: false });
      (c.effects || []).forEach((r, j) => checkSet(r, `${cp}.effects[${j}]`));
      if (c.inject != null && typeof c.inject !== 'string') err(cp, 'inject는 문자열');
    });
    const last = e.choices[e.choices.length - 1];
    if (last && last.when)
      warn(p, '마지막 선택지에 조건(when)이 있습니다 — 타임아웃 자동 결정은 마지막 항목을 고르는데, '
        + '잠겨 있으면 아무 효과 없이 지나갑니다. 마지막은 조건 없는 항목("외면한다"류)을 권합니다');
    if (e.timeout == null)
      warn(p, 'timeout이 없습니다 — 고를 때까지 다른 갈림길이 전부 막히고, 선택지가 만질 변수는 보조 AI에서 계속 빠집니다. 2~4턴을 권합니다');
    else if (typeof e.timeout !== 'number' || !Number.isInteger(e.timeout) || e.timeout < 1)
      err(p, 'timeout은 1 이상의 정수여야 함');
    const seen = new Set();
    for (const c of e.choices) {
      const k = String(c.label ?? '').trim();
      if (k && seen.has(k)) { warn(p, `선택지 라벨 '${k}'이 겹칩니다 — /선택 이름 매칭이 모호해집니다 (번호로는 됩니다)`); break; }
      seen.add(k);
    }
  };
  // exprIds: 판정 등급의 when/effects는 roll/mod/total(/vs)을 임시 식별자로 쓸 수 있다
  const checkSet = (rule, p, exprIds = allIds) => {
    // 목록 효과 { list, add, remove, expire }
    if (rule.list !== undefined) {
      if (!listIds.has(rule.list)) err(p, `list 효과 대상 '${rule.list}'이 목록(list) 변수가 아님`);
      if (rule.add != null && !Array.isArray(rule.add)) err(p, 'add는 배열이어야 함');
      if (rule.remove != null && !Array.isArray(rule.remove)) err(p, 'remove는 배열이어야 함');
      if (rule.expire != null) {
        if (typeof rule.expire !== 'string') err(p, 'expire는 수식 문자열이어야 함 (예: "day")');
        else checkExpr(rule.expire, p + '.expire', exprIds, err, { allowRand: false });
      }
      if (rule.add == null && rule.remove == null && rule.expire == null)
        warn(p, 'add/remove/expire가 모두 없는 list 효과');
      return;
    }
    if (!ids.has(rule.set)) err(p, `set 대상 '${rule.set}'이 vars에 없음 (derived는 set 불가)`);
    else if (listIds.has(rule.set)) err(p, `목록 '${rule.set}'은 수식 set 불가 — list 효과(add/remove)를 사용`);
    checkExpr(rule.expr, p + '.expr', exprIds, err, { allowRand: true });
  };

  // ── rules ──
  const rules = schema.rules || {};
  (rules.onTurn || []).forEach((r, i) => checkSet(r, `$.rules.onTurn[${i}]`));
  // 시간 등호 + 래치 없음 — 명시적 진행에서는 하루가 여러 턴이라 `dom == 급여일`이 래치 없이는
  // 그 날 내내 매 턴 발동한다 (실측: 맨션봇 급여일 중복 지급). 진단 시뮬은 하루=1턴을 가정해
  // 이 사고를 못 보므로 정적 린트가 유일한 방어선이다. 랜덤 표는 추첨+쿨다운이 빈도를 이미
  // 조절하므로 조건 이벤트만 본다 (계절 분위기 랜덤까지 잡으면 정상 설계를 나무라게 된다).
  if (tcfg && tcfg.advance === 'explicit' && tcfg.expose.length) {
    const eqRe = new RegExp(`\\b(${tcfg.expose.join('|')})\\s*==`);
    (rules.events || []).forEach((e, i) => {
      if (!e.when || e.once) return;
      const m = String(e.when).match(eqRe);
      if (!m) return;
      let whenVars = [];
      try { whenVars = referencedVars(e.when).filter((n) => ids.has(n)); } catch { return; }
      // 효과가 조건 속 변수를 만지면 래치로 본다 (rent_billed 패턴)
      if ((e.effects || []).some((f) => whenVars.includes(f.set))) return;
      warn(`$.rules.events[${i}]`, `'${e.id}'의 시간 등호 조건(\`${m[1]} ==\`)은 그 날(시각) 내내 참입니다 — `
        + '명시적 진행에서는 하루가 여러 턴이라 매 턴 발동합니다. '
        + '경보 플래그 래치(when에 "and not 플래그" + 효과로 플래그 세움)나 "마지막 처리 월" 기록 변수로 막으세요');
    });
  }
  const eventIds = new Set();
  (rules.events || []).forEach((e, i) => {
    const p = `$.rules.events[${i}]`;
    if (!e.id) err(p, '이벤트 id 필요');
    else if (eventIds.has(e.id)) err(p, `중복 이벤트 id: '${e.id}'`);
    else eventIds.add(e.id);
    checkExpr(e.when, p + '.when', allIds, err, { allowRand: false });
    (e.effects || []).forEach((r, j) => checkSet(r, `${p}.effects[${j}]`));
    if (e.notify != null && typeof e.notify !== 'string') err(p, 'notify는 문자열');
    checkRef(e, p);
    checkChoices(e, p);
  });
  const re = rules.randomEvents;
  if (re) {
    // 숫자 또는 식 (v0.89.1) — 식은 0~1 스케일. 난이도 변수를 읽어 프리셋마다 빈도가 달라진다.
    if (typeof re.chancePerTurn === 'string') {
      checkExpr(re.chancePerTurn, '$.rules.randomEvents.chancePerTurn', allIds, err, { allowRand: false });
    } else if (typeof re.chancePerTurn !== 'number' || re.chancePerTurn < 0 || re.chancePerTurn > 1)
      err('$.rules.randomEvents.chancePerTurn', '0~1 사이 숫자 또는 식(0~1 스케일) 필요');
    (re.table || []).forEach((e, i) => {
      const p = `$.rules.randomEvents.table[${i}]`;
      if (!e.id) err(p, '이벤트 id 필요');
      else if (eventIds.has(e.id)) err(p, `중복 이벤트 id: '${e.id}'`);
      else eventIds.add(e.id);
      if (e.weight != null && (typeof e.weight !== 'number' || e.weight <= 0)) err(p, 'weight는 양수');
      if (e.when != null) checkExpr(e.when, p + '.when', allIds, err, { allowRand: false });
      (e.effects || []).forEach((r, j) => checkSet(r, `${p}.effects[${j}]`));
      checkRef(e, p);
      checkChoices(e, p);
    });
  }

  // ── updater ──
  const up = schema.updater || {};
  if (up.contextTurns != null
      && (typeof up.contextTurns !== 'number' || !Number.isInteger(up.contextTurns)
          || up.contextTurns < 1 || up.contextTurns > 5))
    err('$.updater.contextTurns', '보조모델에 보낼 최근 대화 턴 수는 1~5 사이 정수여야 함');
  // 감지 신고 (v0.74) — 기본 켜짐이라 false만 저장된다. 다른 값이 오면 조용히 켜진 채
  // 돌아가므로 알려 준다
  if (up.wordDetect != null && typeof up.wordDetect !== 'boolean')
    err('$.updater.wordDetect', `wordDetect는 true/false여야 함 (현재: '${up.wordDetect}')`);
  const varById = Object.fromEntries(vars.map((v) => [v.id, v]));
  (up.allow || []).forEach((a, i) => {
    const p = `$.updater.allow[${i}]`;
    const v = varById[a.id];
    if (!v) { err(p, `allow 대상 '${a.id}'이 vars에 없음`); return; }
    // 한도를 거는 쪽이 오히려 드물다. 변수 자체에 min/max가 있으면 값이 이미 묶여 있으므로
    // 경고하지 않는다 — 안 그러면 숫자 변수 수만큼 경고가 쏟아져 진짜 지적이 묻힌다.
    // 위아래 어느 쪽으로도 막혀 있지 않은 변수만 남긴다.
    if ((v.type === 'int' || v.type === 'float')
        && a.maxDelta == null && a.maxGain == null && a.maxLoss == null
        && v.min == null && v.max == null)
      warn(p, `숫자형 '${a.id}'은 범위(min/max)도 증감 한도(maxDelta)도 없습니다 — AI가 어떤 값으로도 바꿀 수 있습니다`);
    for (const capKey of ['maxDelta', 'maxGain', 'maxLoss']) {
      if (a[capKey] != null && (typeof a[capKey] !== 'number' || a[capKey] < 0))
        err(p, `${capKey}는 0 이상의 숫자여야 함`);
    }
    // mentions — 이번 턴 글에 그 낱말이 있을 때만 열어 준다 (로어북 키워드와 같은 방식)
    if (a.mentions != null) {
      if (a.mentions === true) {
        if (!v.label) err(p, `mentions: true는 label을 낱말로 씁니다 — '${a.id}'에 label이 없습니다`);
        else if (v.label.length <= 1)
          warn(p, `'${v.label}'은 한 글자라 아무 문장에나 걸립니다 — mentions에 더 긴 말을 직접 적으세요`);
      } else {
        const keys = [].concat(a.mentions);
        if (!keys.length || keys.some((k) => typeof k !== 'string' || !k.trim()))
          err(p, 'mentions는 true이거나 비어있지 않은 문자열(또는 그 배열)이어야 함');
        else if (keys.some((k) => k.trim().length <= 1))
          warn(p, `${p}의 낱말 중 한 글자짜리가 있습니다 — 아무 문장에나 걸립니다`);
        else {
          // 문장 종결형 낱말 (v0.73) — 부분일치는 음절 단위라 "다쳤다"는 그 한 꼴에만 걸린다
          // ("다쳤고"를 놓친다. ⚠ 어간 "다치"도 답이 아니다 — "다치었다"→"다쳤다" 축약으로
          // 어간 음절이 사라진다). 끝의 '다'만 떼면("다쳤") 걸리는 폭이 순증한다. 과거형 축약
          // 음절 + '다'로 끝나는 키만 잡는다 — 명사가 이 꼴로 끝나는 일은 없어 오탐이 없다.
          const conj = keys.find((k) => /[했됐였았었쳤졌렸겼났왔갔섰샀탔]다$/.test(k.trim()));
          if (conj) warn(p, `'${conj.trim()}'은 그 꼴 그대로일 때만 걸립니다 — 끝의 '다'를 떼세요`
            + ` ("${conj.trim().slice(0, -1)}"이면 "${conj.trim().slice(0, -1)}고" 같은 다른 어미에도 걸립니다)`);
        }
      }
      // 낱말이 어떤 변수의 format 단위 문자열에 들어 있으면 사실상 항상 열린다 —
      // 상태창이 매 턴 그 단위를 찍고("70골드"), 모델도 같은 단위로 값을 말하기 때문이다.
      // (실측 사고: 대장간 봇 — funds의 낱말 "골드"가 "{v}골드" 포맷에 포함 → 매 턴 개방 → 돈 자동 증식)
      {
        const mentionKeys = (a.mentions === true ? [v.label] : [].concat(a.mentions))
          .filter((k) => typeof k === 'string' && k.trim());
        const fmtOwners = vars.concat(schema.derived || []).filter((x) => typeof x.format === 'string');
        for (const k of mentionKeys) {
          const hit = fmtOwners.find((x) => x.format.toLowerCase().includes(k.trim().toLowerCase()));
          if (hit) {
            warn(p, `낱말 '${k.trim()}'이 '${hit.id}'의 표시 형식('${hit.format}')에 들어 있습니다`
              + ` — 상태창이 매 턴 이 단위를 찍으므로 사실상 항상 열립니다. 거래가 실제로 일어났을 때만 나오는 표현으로 바꾸세요`);
            break; // 변수당 한 번이면 충분 — 경고 폭주 방지
          }
        }
      }
    }
    // whenArmed(액션 잠금) — 그 액션이 무장·발동된 턴에만 보조 AI에게 열린다
    if (a.whenArmed != null) {
      const ids = [].concat(a.whenArmed);
      const actionIds = new Set((schema.actions || []).map((x) => x.id));
      if (!ids.length || ids.some((k) => typeof k !== 'string' || !k.trim()))
        err(p, 'whenArmed는 액션 id 문자열(또는 그 배열)이어야 함');
      else {
        for (const k of ids) {
          if (!actionIds.has(k)) err(p, `whenArmed의 '${k}'가 actions에 없음`);
        }
      }
    }
    // (text의 maxLength 미지정은 기본 200자가 적용되는 정상 동작이라 경고하지 않음)
  });

  // 한 낱말이 다른 낱말 안에 들어 있는 건 auxAllowList가 '가려짐'으로 처리하므로 결함이 아니다.
  // 문제가 될 수 있는 건 **똑같은 낱말**이다 — 어느 쪽을 열지 가릴 방법이 없어 늘 함께 열린다.
  // 단, 한 인물의 변수 묶음(호감·기분·위치…)이 낱말을 공유하는 건 정상 설계다. 그래서
  // 낱말 집합이 완전히 같은 변수들은 묶음당 한 줄로 접고(인물당 5~6개면 수백 줄이 나온다),
  // 서로 다른 묶음에 걸친 낱말만 진짜 겹침으로 경고한다.
  {
    const entries = [];
    for (const a of (up.allow || [])) {
      if (!a.mentions) continue;
      const v = varById[a.id];
      const keys = [...new Set((a.mentions === true ? [v?.label] : [].concat(a.mentions))
        .filter((k) => typeof k === 'string' && k.trim())
        .map((k) => k.trim().toLowerCase()))];
      if (keys.length) entries.push({ id: a.id, keys, sig: [...keys].sort().join('\u0000') });
    }
    const bySig = new Map(); // 낱말 집합 서명 → 그 집합을 그대로 쓰는 변수 id들
    for (const e of entries) {
      if (!bySig.has(e.sig)) bySig.set(e.sig, []);
      bySig.get(e.sig).push(e.id);
    }
    for (const [sig, ids] of bySig) {
      if (ids.length < 2) continue;
      const words = sig.split('\u0000');
      const wordStr = words.slice(0, 3).map((w) => `'${w}'`).join('·')
        + (words.length > 3 ? ` 외 ${words.length - 3}낱말` : '');
      warn('$.updater.allow', `${wordStr}을 ${ids[0]} 등 ${ids.length}개 변수가 같이 씁니다 — 늘 함께 열립니다.`
        + ' 한 인물·주제 묶음이면 정상이고, 무관한 변수라면 낱말을 나누세요');
    }
    // 묶음 경계를 넘는 낱말 — 이 낱말 하나가 서로 다른 묶음을 전부 열어버린다
    const byWord = new Map(); // 낱말 → { sigs, ids }
    for (const e of entries) {
      for (const k of e.keys) {
        if (!byWord.has(k)) byWord.set(k, { sigs: new Set(), ids: [] });
        const slot = byWord.get(k);
        slot.sigs.add(e.sig); slot.ids.push(e.id);
      }
    }
    for (const [k, slot] of byWord) {
      if (slot.sigs.size < 2) continue;
      warn('$.updater.allow', `'${k}'가 서로 다른 묶음의 변수 ${slot.ids.length}개(${slot.ids.slice(0, 2).join(', ')} …)에 걸쳐 있습니다`
        + ' — 이 낱말이 나오면 그 변수들이 전부 함께 열립니다. 의도가 아니면 한쪽을 다르게 적으세요');
    }
  }

  // ── suggest (다음 행동 제안, v0.43) ──
  if (schema.suggest != null) {
    if (typeof schema.suggest !== 'object' || Array.isArray(schema.suggest)) {
      err('$.suggest', 'suggest는 객체여야 함 — { count, guide }');
    } else {
      const sg = schema.suggest;
      if (sg.count != null && (!Number.isInteger(sg.count) || sg.count < 2 || sg.count > 4))
        err('$.suggest.count', '제안 개수는 2~4 사이 정수여야 함');
      if (sg.guide != null && typeof sg.guide !== 'string')
        err('$.suggest.guide', '제안 지침은 문자열이어야 함');
      if (typeof sg.guide === 'string' && sg.guide.length > 400)
        warn('$.suggest.guide', '제안 지침이 400자를 넘습니다 — 매 턴 보조 프롬프트에 실리는 글입니다');
      // 제안은 보조 AI 응답에 실려 온다 — 보조 AI가 아예 안 도는 봇이면 영영 안 뜬다
      if (!schema.updater || !(schema.updater.allow || []).length)
        warn('$.suggest', '다음 행동 제안은 보조 AI 응답에 실려 옵니다 — 허용 변수(updater.allow)가 없으면 보조 AI가 돌지 않아 제안도 뜨지 않습니다');
    }
  }

  // ── promptState / statusUI ──
  if (schema.promptState?.template) {
    checkTemplateRefs(schema.promptState.template, '$.promptState.template', allIds, err);
  }
  if (typeof schema.promptState?.eventPriority === 'string') {
    checkTemplateRefs(schema.promptState.eventPriority, '$.promptState.eventPriority', allIds, err);
  }
  if (typeof schema.promptState?.checkGuide === 'string') {
    checkTemplateRefs(schema.promptState.checkGuide, '$.promptState.checkGuide', allIds, err);
  }
  const ui = schema.statusUI || {};
  if (ui.mode === 'template') {
    // <style> 블록은 CSS이므로 자리표시자 검사에서 제외 (통짜 붙여넣기 지원)
    const stripStyle = (s) => String(s).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    const conds = Array.isArray(ui.templates) ? ui.templates : [];
    if (!conds.length && (typeof ui.template !== 'string' || !ui.template.trim()))
      err('$.statusUI.template', '템플릿 모드인데 template이 비어 있음');
    if (typeof ui.template === 'string' && ui.template.trim())
      checkTemplateRefs(stripStyle(ui.template), '$.statusUI.template', allIds, err);

    const tplIds = new Set();
    let sawUnconditional = false;
    conds.forEach((t, i) => {
      const p = `$.statusUI.templates[${i}]`;
      if (!t || typeof t !== 'object') { err(p, '객체가 아님'); return; }
      // id는 CSS 클래스(.sim-tpl-<id>)가 되므로 반드시 안전한 이름이어야 한다
      if (!t.id || !ID_RE.test(t.id)) err(p, `잘못된 템플릿 id: '${t.id}' (영문자로 시작, 영문·숫자·_만)`);
      else if (tplIds.has(t.id)) err(p, `중복 템플릿 id: '${t.id}'`);
      else tplIds.add(t.id);
      if (typeof t.template !== 'string' || !t.template.trim()) err(p, 'template이 비어 있음');
      else checkTemplateRefs(stripStyle(t.template), p + '.template', allIds, err);
      if (t.when != null && String(t.when).trim()) {
        checkExpr(t.when, p + '.when', allIds, err, { allowRand: false });
        if (sawUnconditional) warn(p, '조건 없는 템플릿보다 뒤에 있어 영원히 안 뜸 — 위로 올리세요');
      } else if (sawUnconditional) {
        warn(p, '조건 없는 템플릿이 이미 위에 있어 영원히 안 뜸');
      } else {
        sawUnconditional = true;
      }
    });
    // 어떤 조건도 안 맞을 때 그릴 게 없으면 상태창이 통째로 사라진다
    if (conds.length && !sawUnconditional && !(typeof ui.template === 'string' && ui.template.trim()))
      warn('$.statusUI.templates', '전부 조건부입니다 — 어느 조건도 안 맞는 순간엔 상태창이 안 보입니다. 조건 없는 템플릿을 맨 뒤에 하나 두세요');
    // 갈림길이 있는 봇의 템플릿 모드 — {choices}가 없으면 유저는 무슨 선택지가 있는지 알 길이 없다
    // (그룹 모드는 자동으로 붙으므로 해당 없음)
    {
      const hasChoiceEvents = [...(rules.events || []), ...(rules.randomEvents?.table || [])]
        .some((e) => Array.isArray(e.choices) && e.choices.length);
      const hasSlot = (typeof ui.template === 'string' && ui.template.includes('{choices}'))
        || conds.some((t) => String(t.template || '').includes('{choices}'));
      if (hasChoiceEvents && !hasSlot)
        warn('$.statusUI.template', '갈림길(choices) 이벤트가 있는데 템플릿 어디에도 {choices}가 없습니다 — 선택의 순간이 와도 유저는 선택지를 볼 수 없습니다');
    }
  }
  // 배치 — 탭·팝업은 두 장부터 의미가 있다. 한 장이면 조용히 쌓기로 되돌아가므로 알려 준다.
  if (ui.layout != null) {
    if (!['stack', 'tabs', 'accordion', 'popover'].includes(ui.layout))
      err('$.statusUI.layout', `layout은 stack|tabs|accordion|popover (현재: '${ui.layout}')`);
    else if (ui.mode === 'template')
      warn('$.statusUI.layout', '템플릿 모드에서는 배치를 제작자가 정하므로 layout이 무시됩니다');
    else if (['tabs', 'popover'].includes(ui.layout)) {
      const shown = (ui.groups || []).filter((g) => (g.visibility ?? 'show') !== 'hidden');
      if (shown.length < 2)
        warn('$.statusUI.layout', `${ui.layout}는 보이는 그룹이 둘 이상일 때 동작합니다 (현재 ${shown.length}개) — 지금은 그냥 쌓입니다`);
      if (shown.some((g) => !g.label))
        warn('$.statusUI.layout', '이름 없는 그룹이 있습니다 — 탭·버튼에 "그룹 N"으로 나옵니다');
    }
  }
  // 변화 로그 표시 (v0.72) — 값이 틀리면 조용히 기본값(collapsed)으로 그려지므로 알려 준다
  if (ui.changeLog != null && !['open', 'collapsed', 'off'].includes(ui.changeLog))
    err('$.statusUI.changeLog', `changeLog는 open|collapsed|off (현재: '${ui.changeLog}')`);
  (ui.groups || []).forEach((g, i) => {
    if (g.visibility != null && !['show', 'collapsed', 'hidden'].includes(g.visibility))
      err(`$.statusUI.groups[${i}]`, `visibility는 show|collapsed|hidden (현재: '${g.visibility}')`);
    if (g.showWhen != null) checkExpr(g.showWhen, `$.statusUI.groups[${i}].showWhen`, allIds, err, { allowRand: false });
    (g.items || []).forEach((it, j) => {
      const p = `$.statusUI.groups[${i}].items[${j}]`;
      if (!allIds.has(it.var)) err(p, `표시 대상 '${it.var}'이 정의되지 않음`);
      if (it.showWhen != null) checkExpr(it.showWhen, p + '.showWhen', allIds, err, { allowRand: false });
      if (it.bar?.max != null) checkExpr(String(it.bar.max), p + '.bar.max', allIds, err, { allowRand: false });
      if (it.color != null) checkExpr(it.color, p + '.color', allIds, err, { allowRand: false });
    });
  });

  // ── directives (상태 지시문) ──
  const dirIds = new Set();
  (schema.directives || []).forEach((d, i) => {
    const p = `$.directives[${i}]`;
    if (!d.id) err(p, '지시문 id 필요');
    else if (dirIds.has(d.id)) err(p, `중복 지시문 id: '${d.id}'`);
    else dirIds.add(d.id);
    checkExpr(d.when, p + '.when', allIds, err, { allowRand: false });
    if (typeof d.text !== 'string' || !d.text.trim()) err(p, '지시문 내용(text) 필요');
    else {
      checkTemplateRefs(d.text, p + '.text', allIds, err);
      // 지시문이 보조 담당 변수를 본문에서 직접 다루라고 지시 — 지시문은 메인 모델 전용이라
      // 그 규칙을 정작 상태를 갱신하는 보조 AI가 못 읽는다 (실측: day_gate가 day_advance
      // 세우기를 지시문에 적어 날짜가 계속 튐). {자리표시자}는 표시용이라 제외하고,
      // stage처럼 산문에 자연히 나오는 일반 영단어 id는 오탐이 커서 '_' 든 id만 본다.
      const bare = d.text.replace(/\{[^{}]*\}/g, '');
      const hit = (up.allow || []).map((a) => a.id)
        .filter((x) => typeof x === 'string' && x.includes('_'))
        .find((x) => new RegExp(`\\b${x}\\b`).test(bare));
      if (hit) {
        warn(p, `지시문 '${d.id}'가 보조 AI 담당 변수 '${hit}'를 직접 조작하라고 지시하는 것으로 보입니다 — `
          + '지시문은 메인 모델 전용이라, 상태를 갱신하는 보조 AI는 이 규칙을 영영 못 읽습니다. '
          + `그 규칙은 '${hit}'의 desc(설명)나 updater.guide로 옮기세요`);
      }
    }
  });

  // ── setup ──
  const setup = schema.setup;
  if (setup) {
    const presetIds = new Set();
    (setup.presets || []).forEach((p, i) => {
      const path = `$.setup.presets[${i}]`;
      if (!p.id) err(path, '프리셋 id 필요');
      else if (presetIds.has(p.id)) err(path, `중복 프리셋 id: '${p.id}'`);
      else presetIds.add(p.id);
      if (!p.label) warn(path, 'label 없음 — id가 버튼에 표시됨');
      // startAt — 이 프리셋으로 시작할 때의 작중 시각 (시간 체계 전용)
      if (p.startAt != null) {
        if (typeof p.startAt !== 'string') err(path, 'startAt은 "YYYY-MM-DD HH:mm" 문자열이어야 함');
        else if (!tcfg) warn(path, 'startAt(시작 시점)은 시간 체계(time)를 켠 봇에서만 적용됩니다 — 지금은 무시됩니다');
        else if (!parseStart(p.startAt, tcfg.calendar))
          err(path, `startAt '${p.startAt}'을 시작 시점으로 읽을 수 없음 — "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm" 형식의 실재하는 날짜여야 함`);
      }
      for (const [id, val] of Object.entries(p.set || {})) {
        const v = varById[id];
        if (!v) { err(path, `set 대상 '${id}'이 vars에 없음`); continue; }
        if ((v.type === 'int' || v.type === 'float') && typeof val !== 'number') err(path, `'${id}'는 숫자여야 함`);
        if (v.type === 'enum' && !v.enum?.includes(val)) err(path, `'${id}' 값 '${val}'이 enum 목록에 없음`);
        if (v.type === 'bool' && typeof val !== 'boolean') err(path, `'${id}'는 true/false여야 함`);
        if (v.type === 'list' && !Array.isArray(val)) err(path, `'${id}'는 배열이어야 함`);
      }
    });
    if (setup.ai) {
      (setup.ai.vars || []).forEach((id, i) => {
        if (!ids.has(id)) err(`$.setup.ai.vars[${i}]`, `'${id}'이 vars에 없음`);
      });
      if (setup.ai.enabled && setup.ai.vars && setup.ai.vars.length === 0)
        warn('$.setup.ai.vars', '빈 배열 — AI가 아무 변수도 설정할 수 없음');
    }
  }

  // ── actions ──
  const actionIds = new Set();
  (schema.actions || []).forEach((a, i) => {
    const p = `$.actions[${i}]`;
    if (!a.id || !ID_RE.test(a.id)) err(p, `잘못된 액션 id: '${a.id}'`);
    else if (actionIds.has(a.id)) err(p, `중복 액션 id: '${a.id}'`);
    else actionIds.add(a.id);
    if (a.mode && !['oneshot', 'hold'].includes(a.mode)) err(p, `mode는 oneshot|hold (현재: '${a.mode}')`);
    if (a.when != null) checkExpr(a.when, p + '.when', allIds, err, { allowRand: false });
    (a.effects || []).forEach((r, j) => checkSet(r, `${p}.effects[${j}]`));
    if (a.cooldown != null && (typeof a.cooldown !== 'number' || a.cooldown < 0)) err(p, 'cooldown은 0 이상');
    checkRef(a, p);
  });

  // ── checks (판정 — "완벽 주사위") ──
  // 결과(roll/total/grade)는 변수가 아니라 meta에 남으므로 updater.allow에 올릴 수 있는
  // 형태 자체가 없다 — "판정 결과 변수 allow 금지"는 검증이 아니라 구조로 달성된다.
  {
    const seen = new Set();
    (Array.isArray(schema.checks) ? schema.checks : []).forEach((c, i) => {
      const p = `$.checks[${i}]`;
      if (!c.id || !ID_RE.test(c.id)) err(p, `잘못된 판정 id: '${c.id}'`);
      else if (seen.has(c.id)) err(p, `중복 판정 id: '${c.id}'`);
      else {
        seen.add(c.id);
        if (allIds.has(c.id)) err(p, `판정 id '${c.id}'가 변수/파생과 겹침 — 다른 이름을 쓸 것`);
      }
      if (!c.label) warn(p, 'label 없음 — [판정] 줄과 상태창에 id가 그대로 표시됨');
      // roll은 rand가 허용되는 유일한 굴림 자리. mod/vs/등급 조건에는 금지 (완벽 주사위 — 굴림은 한 번)
      checkExpr(c.roll, p + '.roll', allIds, err, { allowRand: true });
      if (c.mod != null) checkExpr(String(c.mod), p + '.mod', allIds, err, { allowRand: false });
      if (c.vs != null && typeof c.vs !== 'number') checkExpr(String(c.vs), p + '.vs', allIds, err, { allowRand: false });
      const gradeIds = new Set([...allIds, 'roll', 'mod', 'total', ...(c.vs != null ? ['vs'] : [])]);
      const grades = Array.isArray(c.grades) ? c.grades : [];
      if (!grades.length) err(p, 'grades(등급) 1개 이상 필요');
      let sawCatchAll = false;
      grades.forEach((g, gi) => {
        const gp = `${p}.grades[${gi}]`;
        if (!g.label) err(gp, '등급 label 필요');
        if (sawCatchAll) warn(gp, '조건 없는 등급(기본 결과)보다 뒤에 있어 영원히 안 나옴 — 위로 올리세요');
        if (!g.when) sawCatchAll = true;
        else checkExpr(g.when, gp + '.when', gradeIds, err, { allowRand: false });
        (g.effects || []).forEach((r, j) => checkSet(r, `${gp}.effects[${j}]`, gradeIds));
        if (g.inject != null && typeof g.inject !== 'string') err(gp, 'inject는 문자열');
      });
      if (grades.length && !sawCatchAll)
        warn(p, '조건 없는 등급이 없습니다 — 어느 조건도 안 맞으면 판정이 등급 없이 끝납니다. 맨 뒤에 기본 등급(예: 실패)을 두세요');
      if (c.vs == null && grades.some((g) => g.when && /\bvs\b/.test(g.when)))
        err(p, '등급 조건이 vs를 쓰는데 판정에 vs(목표치)가 없음');
    });
    // 판정이 있는 스키마에서 roll/mod/total/vs 이름의 변수는 등급식 안에서 판정값에 가려진다
    if (seen.size) {
      for (const shadowed of ['roll', 'mod', 'total', 'vs']) {
        if (allIds.has(shadowed))
          warn('$.checks', `변수/파생 '${shadowed}'는 판정 등급식 안에서 판정값에 가려집니다 — 헷갈리지 않게 다른 이름을 권합니다`);
      }
    }
  }

  // ── assets (에셋 팩 — 이미지 태그 자동화) ─────────────────
  // 없으면 아무것도 안 바뀐다. 설계: docs/design-에셋-슬롯.md
  if (schema.assets != null) {
    const A = schema.assets;
    if (typeof A !== 'object' || Array.isArray(A)) err('$.assets', 'assets는 객체여야 함');
    else {
      if (A.by != null && !['aux', 'aux_flow', 'main'].includes(A.by))
        err('$.assets.by', "by는 'aux'(맨 앞 1장), 'aux_flow'(서사 위치 여러 장) 또는 'main'");
      // v0.94 — 활성 모듈의 ⚙simcore-pack 매니페스트(팩 정의)를 런타임 병합할지 (옵트인)
      if (A.moduleManifests != null && typeof A.moduleManifests !== 'boolean')
        err('$.assets.moduleManifests', 'moduleManifests는 true/false');
      if (!Array.isArray(A.packs)) err('$.assets.packs', 'packs 배열이 필요함');
      const packIds = new Set();
      const claim = new Map(); // 인물 → 먼저 담당을 선언한 팩 id (조용한 덮어쓰기 금지)
      (Array.isArray(A.packs) ? A.packs : []).forEach((pk, i) => {
        const p = `$.assets.packs[${i}]`;
        if (!pk || typeof pk !== 'object') { err(p, '팩은 객체여야 함'); return; }
        if (!pk.id || !ID_RE.test(pk.id)) err(p, `잘못된 팩 id: '${pk.id}' (영문자/숫자/_, 영문자 시작)`);
        else if (packIds.has(pk.id)) err(p, `중복된 팩 id: '${pk.id}'`);
        else packIds.add(pk.id);
        if (pk.sep != null && typeof pk.sep !== 'string') err(p + '.sep', 'sep(구분자)는 문자열이어야 함');
        if (typeof pk.format !== 'string' || !pk.format.includes('{'))
          err(p + '.format', 'format 필요 — {name} 또는 {칸id} 자리표시자를 포함한 출력 문자열');
        if (!pk.source) warn(p, 'source(출처)가 없습니다 — 모듈을 뗀 뒤 어느 팩이 고아인지 알 수 없게 됩니다');
        // 빈 when은 "항상 열림" — packOpen과 같은 해석. 임포터가 "비워 둬라"를 ""로 내는 게 정상이다
        if (pk.when != null && String(pk.when).trim() !== '') checkExpr(pk.when, p + '.when', allIds, err, { allowRand: false });
        if (pk.usage != null && typeof pk.usage !== 'string') err(p + '.usage', 'usage(쓰임새)는 문자열이어야 함');
        else if (pk.usage && pk.usage.length > 200) warn(p + '.usage', '쓰임새가 200자를 넘습니다 — 매 턴 지시문에 실리는 한 줄이니 짧게 쓰세요');
        if (pk.chars != null && (!Array.isArray(pk.chars) || pk.chars.some((c) => typeof c !== 'string')))
          err(p + '.chars', 'chars는 문자열 배열이어야 함');

        const slots = Array.isArray(pk.slots) ? pk.slots : [];
        if (!slots.length) err(p + '.slots', '칸(slots)이 최소 1개 필요');
        const slotIds = new Set();
        slots.forEach((s, si) => {
          const sp = `${p}.slots[${si}]`;
          if (!s || !s.id || !ID_RE.test(s.id)) { err(sp, `잘못된 칸 id: '${s && s.id}'`); return; }
          if (slotIds.has(s.id)) err(sp, `중복된 칸 id: '${s.id}'`);
          slotIds.add(s.id);
          if (!Array.isArray(s.values) || !s.values.length || s.values.some((v) => typeof v !== 'string' || !v.trim()))
            err(sp + '.values', '값 목록(values)은 비어있지 않은 문자열 배열이어야 함');
          else if (s.fallback != null && !s.values.includes(s.fallback))
            warn(sp, `fallback '${s.fallback}'이 values 목록에 없습니다 — 폴백도 실물 이름 규칙을 따라야 대조를 통과합니다`);
          // 필수 칸의 폴백은 마지막 방어선 (v0.75) — 보조가 이 칸을 빠뜨리면 조합 자체가
          // 성립하지 않아 이미지가 통째로 사라진다. optional 칸은 사다리가 빼고 다시 시도하므로
          // 해당 없고, who는 폴백 대상이 아니다(다른 인물이 나올 수는 없다).
          if (s.id !== 'who' && !s.optional && s.fallback == null && Array.isArray(s.values) && s.values.length)
            warn(sp, `필수 칸 '${s.id}'에 fallback이 없습니다 — 보조 AI가 이 칸을 빠뜨리거나 없는 조합을 고르면 이미지가 통째로 사라집니다`);
        });

        // format 자리표시자 — {name} 또는 이 팩의 칸 id만
        if (typeof pk.format === 'string') {
          for (const m of pk.format.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
            if (m[1] !== 'name' && !slotIds.has(m[1]))
              err(p + '.format', `'{${m[1]}}'는 이 팩의 칸 id도 {name}도 아닙니다`);
          }
        }

        // 라우팅 — 담당 인물 선언 + 팩끼리 겹침은 먼저 선언한 쪽 우선.
        // 단, 게이트(when)가 서로 다른 팩의 겹침은 의도된 변형(성인/임신 팩 패턴)이라
        // 경고하지 않는다 — 정상 설계에 경고를 내면 아무도 그 설계를 안 쓴다 (v0.52 원칙).
        // v0.87.3부터 **필수 칸 구성이 다른 팩의 겹침도 정상 설계다** (감정 팩 + 성행위 팩 —
        // 채운 칸이 팩을 고른다, assets.js 구조 라우팅). 경고는 앞 팩의 필수 칸이 이 팩
        // 필수 칸의 부분집합이라 정조합을 앞 팩이 반드시 먼저 채가는 경우에만 낸다.
        const whoVals = slots.find((s) => s && s.id === 'who')?.values || [];
        const owns = [...(Array.isArray(pk.chars) ? pk.chars : []), ...whoVals];
        if (!owns.length) warn(p, '담당 인물이 없습니다 (who 칸도 chars도 없음) — aux 모드에서 이 팩으로 라우팅되지 않습니다');
        // ⚠ 겹침은 **먼저 담당하는 팩 단위로 한 줄** (v0.79). 인물마다 한 줄씩 내면
        //   명단이 큰 봇에서 같은 문장이 그 인원수만큼 쏟아져 다른 오류를 덮는다
        //   (실측: 145명 명단을 두 팩에 넣자 똑같은 경고가 145줄 — 낱말 경고가 147줄
        //   쏟아졌던 v0.44.1과 같은 병이다). 겹친 팩 쌍이 몇인지가 정보고, 누구인지는
        //   앞 셋이면 찾아갈 수 있다.
        const reqIds = slots.filter((s) => s && s.id !== 'who' && !s.optional).map((s) => s.id);
        const shadow = new Map(); // 먼저 담당하는 팩 id → 이 팩과 겹친 인물들
        const coexist = new Set(); // 구조가 달라 공존하는 앞 팩 id (usage 권고용, v0.88)
        for (const c of owns) {
          const prev = claim.get(c) || [];
          const same = prev.find((x) => x.id !== pk.id && (x.when ?? '') === (pk.when ?? '')
            && x.req.every((id) => reqIds.includes(id)));
          if (same) {
            if (!shadow.has(same.id)) shadow.set(same.id, []);
            shadow.get(same.id).push(c);
          } else {
            // 구조가 다른 인물 공유 = 채운 칸이 팩을 고르는 공존 (v0.87.3). 보조가 어느
            // field set을 쓸지 고르려면 판단 기준이 필요하다 — 쓰임새(usage) 없이 두 세트를
            // 받으면 헷갈린다 (실기 지적). 어느 한쪽이라도 비어 있으면 짚어 준다.
            const other = prev.find((x) => x.id !== pk.id && (x.when ?? '') === (pk.when ?? ''));
            if (other && (!pk.usage || !other.usage)) coexist.add(other.id);
          }
          prev.push({ id: pk.id, when: pk.when ?? '', req: reqIds, usage: pk.usage || '' });
          claim.set(c, prev);
        }
        for (const prevId of coexist) {
          warn(p, `팩 '${prevId}'와 인물을 나눠 쓰는 구조 공존입니다 — 두 팩 모두 쓰임새(usage)를 `
            + '적어야 보조 AI가 장면에 맞는 field set을 고릅니다 (예: "성행위 장면에서만")');
        }
        for (const [prevId, names] of shadow) {
          const head = names.slice(0, 3).map((n) => `'${n}'`).join(', ');
          warn(p, names.length === 1
            ? `인물 ${head}는 팩 '${prevId}'가 먼저 담당합니다 — 필수 칸 구성이 겹쳐 먼저 선언된 팩이 우선하고, `
              + `이 팩은 앞 팩에 없는 이미지의 예비·어휘 확장으로만 쓰입니다`
            : `인물 ${names.length}명이 팩 '${prevId}'와 겹칩니다 — 필수 칸 구성이 겹쳐 먼저 선언된 쪽이 담당하고, `
              + `이 팩은 앞 팩에 없는 이미지의 예비·어휘 확장으로만 쓰입니다 (${head}${names.length > 3 ? ` 외 ${names.length - 3}명` : ''})`);
        }
      });
    }
  }

  // ── party (편성표 — 게임 패널 1호) ─────────────────────────
  // 슬롯 = enum 변수, 보유 = list 변수, 탭 = 여러 편성/시설 (칸코레 모델, v0.56).
  // 설계: docs/design-편성표.md
  if (schema.party != null) {
    const P = schema.party;
    if (typeof P !== 'object' || Array.isArray(P)) err('$.party', 'party는 객체여야 함');
    else {
      const varById = {};
      for (const v of vars) if (v && v.id) varById[v.id] = v;
      const actionIds = new Set((Array.isArray(schema.actions) ? schema.actions : []).map((a) => a && a.id));
      const hasTabs = Array.isArray(P.tabs) && P.tabs.length > 0;
      // 축약형(slots/actions/items 직접)과 tabs를 섞으면 어느 쪽이 이기는지 아무도 모른다 — 막는다
      if (hasTabs && (Array.isArray(P.slots) && P.slots.length || Array.isArray(P.actions) && P.actions.length
        || Array.isArray(P.items) && P.items.length || typeof P.template === 'string' && P.template.trim())) {
        err('$.party', 'tabs와 최상위 slots/actions/items/template을 같이 쓸 수 없음 — 전부 tabs 안으로 옮기세요');
      }
      // 정규화된 탭 목록으로 한 번에 검사 (단일 탭 축약형 = 탭 하나)
      const tabs = hasTabs
        ? P.tabs.map((t, i) => ({ t, p: `$.party.tabs[${i}]` }))
        : [{ t: { slots: P.slots, actions: P.actions, items: P.items, template: P.template, fab: P.fab, roster: undefined, points: P.points }, p: '$.party' }];

      const seen = new Set();   // 슬롯 변수 — 탭을 가로질러 한 번만 (한 인물 = 한 자리 계산의 전제)
      const tabIds = new Set();
      let anySlot = false, anyContent = false;
      for (const { t, p } of tabs) {
        if (!t || typeof t !== 'object') { err(p, '탭은 객체여야 함'); continue; }
        if (hasTabs && t.id != null) {
          if (!ID_RE.test(t.id)) err(p, `잘못된 탭 id: '${t.id}'`);
          else if (tabIds.has(t.id)) err(p, `중복된 탭 id: '${t.id}'`);
          else tabIds.add(t.id);
        }
        // 탭 표시 조건 (v0.59) — 거짓이면 탭이 통째로 숨는다. 인물별 스킬트리 탭을
        // has(deployed, '이름')으로 걸면 편성된 인물의 탭만 목록에 남는다.
        if (hasTabs && t.when != null) checkExpr(t.when, `${p}.when`, allIds, err, { allowRand: false });
        const slots = Array.isArray(t.slots) ? t.slots : [];
        const acts = Array.isArray(t.actions) ? t.actions : [];
        const items = Array.isArray(t.items) ? t.items : [];
        // 대장 템플릿 (v0.89) — 상태창과 같은 자리표시자 검사를 여기서도 돈다.
        // 오타 난 변수는 렌더에서 {이름} 리터럴로 남아 유저 화면에 그대로 보인다 — 미리 잡는다.
        const tpl = typeof t.template === 'string' && t.template.trim() ? t.template : null;
        if (t.template != null && typeof t.template !== 'string') err(`${p}.template`, 'template은 문자열이어야 함');
        if (tpl) {
          const stripStyle = (s) => String(s).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
          checkTemplateRefs(stripStyle(tpl), `${p}.template`, allIds, err);
        }
        // 탭별 플로팅 버튼 (v0.89) — 우상단 버튼에 들어가는 글리프라 길면 잘려 보인다
        if (t.fab != null) {
          if (typeof t.fab !== 'string' || !t.fab.trim()) err(`${p}.fab`, 'fab(플로팅 버튼)은 아이콘 글리프 문자열이어야 함');
          else if (t.fab.trim().length > 8) err(`${p}.fab`, 'fab은 이모지 한두 글자만 — 긴 글은 버튼에 안 들어갑니다');
          else if (!hasTabs) warn(`${p}.fab`, 'fab은 tabs 구조에서만 씁니다 — 축약형(탭 하나)은 편성표 버튼이 이미 그 탭을 엽니다');
        }
        if (!slots.length && !acts.length && !items.length && !tpl) {
          err(p, '슬롯도 액션도 없는 탭 — slots(편성)·actions(시설 버튼)·items(업그레이드)·template(대장) 중 하나는 필요합니다');
          continue;
        }
        anyContent = true;
        slots.forEach((s, i) => {
          const sp = `${p}.slots[${i}]`;
          if (!s || typeof s !== 'object') { err(sp, '슬롯은 객체여야 함'); return; }
          const def = varById[s.var];
          if (!def) { err(sp, `슬롯 변수 '${s.var}'가 vars에 없음`); return; }
          if (def.type !== 'enum') {
            err(sp, `슬롯 변수 '${s.var}'는 enum 타입이어야 함 (현재: ${def.type}) — 후보 목록이 enum 값 목록입니다`);
            return;
          }
          if (seen.has(s.var)) err(sp, `슬롯 변수 '${s.var}' 중복 — 탭이 달라도 슬롯마다 다른 변수를 쓰세요`);
          seen.add(s.var);
          anySlot = true;
          // 빈값(empty)이 그 슬롯 enum에 없으면 한 번 앉힌 뒤 비울 방법이 없다
          if (P.empty != null && Array.isArray(def.enum) && !def.enum.includes(P.empty)) {
            err(sp, `빈값 '${P.empty}'이 '${s.var}'의 enum 목록에 없음 — 슬롯을 비울 수 없게 됩니다`);
          }
        });
        // 탭의 버튼은 기존 액션을 가리킨다 — 액션이 이미 이벤트·규칙·판정 배선이므로
        acts.forEach((id, i) => {
          if (!actionIds.has(id)) err(`${p}.actions[${i}]`, `'${id}'는 actions에 없는 액션 id — [액션] 탭에서 먼저 만드세요`);
        });
        // 탭별 보유 목록 (수복 후보 따로 등) — 없으면 공용 roster
        if (t.roster != null && t.roster !== P.roster) {
          const r = varById[t.roster];
          if (!r) err(`${p}.roster`, `보유 목록 '${t.roster}'가 vars에 없음`);
          else if (r.type !== 'list') err(`${p}.roster`, `보유 목록 '${t.roster}'는 list 타입이어야 함 (현재: ${r.type})`);
        }
        // 업그레이드 항목 (v0.58) — 스킬트리·시설 레벨·특성(max 1). 항목 = int 변수 하나.
        const tabPoints = t.points ?? P.points;
        if (tabPoints != null) {
          const pv = varById[tabPoints];
          if (!pv) err(`${p}.points`, `포인트 변수 '${tabPoints}'가 vars에 없음`);
          else if (pv.type !== 'int' && pv.type !== 'float') err(`${p}.points`, `포인트 변수 '${tabPoints}'는 숫자 타입이어야 함 (현재: ${pv.type})`);
        }
        items.forEach((it, i) => {
          const ip = `${p}.items[${i}]`;
          if (!it || typeof it !== 'object') { err(ip, '항목은 객체여야 함'); return; }
          const def = varById[it.var];
          if (!def) { err(ip, `항목 변수 '${it.var}'가 vars에 없음`); return; }
          if (def.type !== 'int') { err(ip, `항목 변수 '${it.var}'는 int 타입이어야 함 (현재: ${def.type}) — 레벨은 정수입니다`); return; }
          if (seen.has(it.var)) err(ip, `'${it.var}'가 다른 슬롯/항목과 겹침 — 변수 하나는 한 자리에만`);
          seen.add(it.var);
          if (it.max != null && (typeof it.max !== 'number' || it.max < 1)) err(ip, 'max는 1 이상 숫자');
          if (it.max == null && def.max == null) {
            warn(ip, `'${it.var}'에 max가 없습니다 (변수에도 상한 없음) — 무한히 찍을 수 있게 됩니다. 의도가 아니면 max를 정하세요`);
          }
          if (it.cost != null) {
            if (typeof it.cost === 'string') checkExpr(it.cost, ip + '.cost', allIds, err, { allowRand: false });
            else if (typeof it.cost !== 'number' || it.cost < 0) err(ip + '.cost', 'cost는 0 이상 숫자 또는 표현식');
            const costly = typeof it.cost !== 'number' || it.cost > 0;
            if (costly && tabPoints == null) {
              err(ip, `비용이 있는데 포인트 변수(points)가 없습니다 — 탭이나 party에 points를 정하세요`);
            }
          }
          if (it.requires != null) checkExpr(it.requires, ip + '.requires', allIds, err, { allowRand: false });
        });
      }
      if (!anyContent) err('$.party', '슬롯 또는 액션이 있는 탭이 최소 1개 필요');
      // 모든 탭에 표시 조건이 걸리면 전부 거짓인 순간 편성표가 텅 비어 보인다 — 상시 탭 하나를 권한다
      if (hasTabs && P.tabs.length && P.tabs.every((t) => t && t.when != null)) {
        warn('$.party.tabs', '모든 탭에 표시 조건(when)이 있습니다 — 전부 거짓이면 편성표가 비어 보입니다. '
          + '조건 없는 탭(기본 편성 등)을 하나 두는 것을 권합니다');
      }
      // 'deployed'는 편성 가상 목록이 쓰는 이름 — 같은 id의 변수/파생이 있으면 그쪽이 가려서
      // has(deployed, ...)가 편성을 안 보게 된다 (시간 노출 이름 충돌과 같은 종류의 사고)
      if (varById.deployed || (Array.isArray(schema.derived) && schema.derived.some((d) => d && d.id === 'deployed'))) {
        warn('$.party', "'deployed'라는 변수/파생이 이미 있습니다 — 편성 가상 목록(deployed)이 가려져 "
          + 'has(deployed, ...)가 편성 슬롯을 읽지 않습니다. 다른 id를 권합니다');
      }

      if (P.empty != null && typeof P.empty !== 'string') err('$.party.empty', 'empty(빈값)는 문자열이어야 함');
      if (P.roster != null) {
        const r = varById[P.roster];
        if (!r) err('$.party.roster', `보유 목록 '${P.roster}'가 vars에 없음`);
        else if (r.type !== 'list') err('$.party.roster', `보유 목록 '${P.roster}'는 list 타입이어야 함 (현재: ${r.type})`);
      }
      for (const [k, name] of [['label', '이름'], ['icon', '아이콘'], ['note', '설명'], ['css', 'CSS']]) {
        if (P[k] != null && typeof P[k] !== 'string') err(`$.party.${k}`, `${name}(${k})은 문자열이어야 함`);
      }
      // 탭 표시 방식 (v0.58.1) — 탭이 적으면 탭 바, 인물이 많으면 셀렉트+검색. 제작자가 고른다.
      if (P.nav != null && !['tabs', 'select'].includes(P.nav)) {
        err('$.party.nav', "nav는 'tabs'(탭 바) 또는 'select'(셀렉트+검색)");
      }
      // 초상 (v0.57) — 이름 → 에셋 이름. 오타는 이미지가 조용히 안 뜨는 사고가 되므로 여기서 잡는다
      if (P.portraits != null) {
        if (typeof P.portraits !== 'object' || Array.isArray(P.portraits)) {
          err('$.party.portraits', 'portraits는 { "이름": "에셋이름" } 객체여야 함');
        } else {
          const allNames = new Set();
          for (const { t } of tabs) {
            for (const s of (Array.isArray(t?.slots) ? t.slots : [])) {
              const def = varById[s?.var];
              for (const nm of (def?.enum || [])) allNames.add(nm);
            }
          }
          for (const [nm, asset] of Object.entries(P.portraits)) {
            if (typeof asset !== 'string' || !asset.trim()) err('$.party.portraits', `'${nm}'의 에셋 이름이 비어 있음`);
            if (allNames.size && !allNames.has(nm)) {
              warn('$.party.portraits', `'${nm}'은 어느 슬롯 후보에도 없는 이름입니다 — 오타이거나 명단에서 빠진 인물입니다`);
            }
          }
        }
      }
      if (P.empty == null && anySlot) {
        warn('$.party', 'empty(빈값)가 없습니다 — 슬롯을 비울 수 없고, 인물을 옮기면 맞교환만 됩니다. '
          + '각 슬롯 enum에 "없음" 같은 값을 넣고 empty로 지정하는 것을 권합니다');
      }
    }
  }

  // ── calendar (달력 패널 — 게임 패널 2호, v0.61) ─────────────
  // 월 그리드 + 기념일 마킹 + 일정 등록(list 변수 + @기한 규약). 시간 체계 위에서만 선다.
  if (schema.calendar != null) {
    const C = schema.calendar;
    if (typeof C !== 'object' || Array.isArray(C)) err('$.calendar', 'calendar는 객체여야 함');
    else {
      const ct = timeConfig(schema);
      if (!ct) {
        err('$.calendar', '달력 패널은 시간 체계(time)가 켜져 있어야 합니다 — 시계 없는 달력은 그릴 날짜가 없습니다. [시간] 탭에서 먼저 켜세요');
      }
      for (const [k, name] of [['label', '이름'], ['icon', '아이콘'], ['css', 'CSS']]) {
        if (C[k] != null && typeof C[k] !== 'string') err(`$.calendar.${k}`, `${name}(${k})은 문자열이어야 함`);
      }
      if (C.list != null) {
        const lv = vars.find((v) => v && v.id === C.list);
        if (!lv) err('$.calendar.list', `일정 목록 '${C.list}'가 vars에 없음`);
        else if (lv.type !== 'list') err('$.calendar.list', `일정 목록 '${C.list}'는 list 타입이어야 함 (현재: ${lv.type})`);
        else if (!(schema.rules?.onTurn || []).some((r) => r && r.list === C.list && r.expire)) {
          warn('$.calendar.list', `'${C.list}'에 만료 규칙이 없습니다 — 지난 일정이 저절로 안 지워집니다. `
            + `onTurn에 { "list": "${C.list}", "expire": "elapsed" }를 권합니다`);
        }
      }
      if (C.marks != null) {
        if (!Array.isArray(C.marks)) err('$.calendar.marks', 'marks는 배열이어야 함');
        else C.marks.forEach((mk, i) => {
          const p = `$.calendar.marks[${i}]`;
          if (!mk || typeof mk !== 'object') { err(p, '기념일은 객체여야 함'); return; }
          if (!mk.label || typeof mk.label !== 'string' || !mk.label.trim()) err(p, '기념일 label 필요');
          if (mk.month == null && mk.dom == null && mk.weekday == null) {
            err(p, '언제인지가 없습니다 — month(월)·dom(일)·weekday(요일) 중 하나는 필요합니다 '
              + '(month+dom=매년, dom만=매달, weekday만=매주)');
          }
          if (mk.month != null && (!Number.isInteger(mk.month) || mk.month < 1 || mk.month > 12)) err(p, 'month는 1~12 정수');
          const maxDom = ct?.calendar === 'flat30' ? 30 : 31;
          if (mk.dom != null && (!Number.isInteger(mk.dom) || mk.dom < 1 || mk.dom > maxDom)) err(p, `dom은 1~${maxDom} 정수`);
          // 존재하지 않는 날짜(2월 30일 등)는 영영 안 오는 기념일이다 — 윤년 2/29는 허용
          if (ct && mk.month != null && mk.dom != null) {
            const cap = ct.calendar === 'flat30' ? 30 : [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mk.month - 1];
            if (mk.dom > cap) err(p, `${mk.month}월 ${mk.dom}일은 없는 날짜입니다`);
          }
          if (ct && mk.weekday != null && !ct.weekdays.includes(mk.weekday)) {
            err(p, `'${mk.weekday}'는 요일 이름이 아닙니다 — 이 봇의 요일: ${ct.weekdays.join(', ')}`);
          }
          if (mk.note != null && typeof mk.note !== 'string') err(p, 'note는 문자열');
        });
      }
    }
  }

  // ── board (커뮤니티 보드 v0.95 — 옵트인, 설계 docs/design-얼헌-개조.md §P4) ──
  // 세계 안의 미니 게시판. 상태는 스냅샷에, 턴 갱신은 기존 보조 호출에 얹힌다.
  if (schema.board != null) {
    const B = schema.board;
    if (typeof B !== 'object' || Array.isArray(B)) err('$.board', 'board는 객체여야 함');
    else {
      for (const [k, name] of [['label', '이름'], ['topics', '관심사'], ['guide', '생성 지침'], ['css', 'CSS']]) {
        if (B[k] != null && typeof B[k] !== 'string') err(`$.board.${k}`, `${name}(${k})은 문자열이어야 함`);
      }
      if (!B.label || !String(B.label).trim()) warn('$.board.label', '보드 이름이 없습니다 — 패널 제목이 "게시판"이 됩니다');
      if (B.icon != null && (typeof B.icon !== 'string' || B.icon.length > 8)) {
        err('$.board.icon', '아이콘은 이모지 한두 글자 (8자 이내)');
      }
      if (B.postsPerTurn != null && (!Number.isInteger(B.postsPerTurn) || B.postsPerTurn < 0 || B.postsPerTurn > 4)) {
        err('$.board.postsPerTurn', '턴당 새 글은 0~4 정수');
      }
      if (B.maxPosts != null && (!Number.isInteger(B.maxPosts) || B.maxPosts < 4 || B.maxPosts > 40)) {
        err('$.board.maxPosts', '보존 글 수는 4~40 정수');
      }
      if (B.mainInject != null && typeof B.mainInject !== 'boolean') err('$.board.mainInject', 'mainInject는 true/false');
      if (B.when != null) {
        if (typeof B.when !== 'string') err('$.board.when', 'when은 표현식 문자열이어야 함');
        else if (B.when.trim()) checkExpr(B.when, '$.board.when', allIds, err, { allowRand: false });
      }
      if (!B.topics && !B.guide) {
        warn('$.board', '관심사(topics)도 생성 지침(guide)도 없습니다 — 보조가 아무 얘기나 지어냅니다. 게시판이 무엇에 대해 떠드는지 적어 주세요');
      }
      // 보드는 보조 호출에 얹혀 갱신된다 — 보조가 아예 안 도는 봇이면 영영 빈 게시판이다
      if (!(schema.updater?.allow?.length) && !schema.suggest && !(schema.assets?.packs?.length)) {
        warn('$.board', '이 봇은 보드 외에 보조 AI가 할 일이 없습니다 — 보드 갱신만을 위해 매 턴 보조가 호출됩니다 (의도한 것인지 확인)');
      }
    }
  }

  // ── shop (상점 v0.96 — 옵트인. 로어북 상점의 뇌절·가격 계산을 구조로 잡는다) ──
  if (schema.shop != null) {
    const SH = schema.shop;
    if (typeof SH !== 'object' || Array.isArray(SH)) err('$.shop', 'shop은 객체여야 함');
    else {
      for (const [k, name] of [['label', '이름'], ['guide', '입고 지침'], ['css', 'CSS']]) {
        if (SH[k] != null && typeof SH[k] !== 'string') err(`$.shop.${k}`, `${name}(${k})은 문자열이어야 함`);
      }
      if (SH.icon != null && (typeof SH.icon !== 'string' || SH.icon.length > 8)) err('$.shop.icon', '아이콘은 이모지 한두 글자 (8자 이내)');
      // 지갑 — 숫자 변수 필수
      const wallet = vars.find((v) => v && v.id === SH.currency);
      if (!SH.currency || typeof SH.currency !== 'string') err('$.shop.currency', '지갑 변수(currency)가 필요합니다');
      else if (!wallet) err('$.shop.currency', `지갑 변수 '${SH.currency}'가 vars에 없음`);
      else if (wallet.type !== 'int' && wallet.type !== 'float') err('$.shop.currency', `지갑 '${SH.currency}'는 숫자 타입이어야 함 (현재: ${wallet.type})`);
      // 구매품이 들어갈 목록 — list 변수 필수
      const bagVar = (id, path, req) => {
        if (id == null) { if (req) err(path, '목록 변수가 필요합니다'); return; }
        const v = vars.find((x) => x && x.id === id);
        if (!v) err(path, `목록 변수 '${id}'가 vars에 없음`);
        else if (v.type !== 'list') err(path, `'${id}'는 list 타입이어야 함 (현재: ${v.type})`);
      };
      bagVar(SH.buyTo, '$.shop.buyTo', true);
      bagVar(SH.sellFrom, '$.shop.sellFrom', false);
      if (SH.categories != null && (!Array.isArray(SH.categories) || !SH.categories.length || SH.categories.length > 8
        || SH.categories.some((c) => typeof c !== 'string'))) {
        err('$.shop.categories', '카테고리는 문자열 1~8개 배열');
      }
      if (SH.grades != null && (!Array.isArray(SH.grades) || !SH.grades.length || SH.grades.some((g) => typeof g !== 'string'))) {
        err('$.shop.grades', '등급 어휘는 문자열 배열');
      }
      if (SH.bands != null) {
        if (typeof SH.bands !== 'object' || Array.isArray(SH.bands)) err('$.shop.bands', 'bands는 { 등급: [최소, 최대] } 객체');
        else for (const [g, band] of Object.entries(SH.bands)) {
          if (!Array.isArray(band) || band.length !== 2 || !band.every((n) => typeof n === 'number' && n >= 0)
            || band[0] > band[1]) err(`$.shop.bands.${g}`, '밴드는 [최소, 최대] (0 이상, 최소 ≤ 최대)');
          if (SH.grades && !SH.grades.includes(g)) warn(`$.shop.bands.${g}`, `밴드의 등급 '${g}'가 grades 목록에 없습니다 — 영영 안 쓰입니다`);
        }
        if (SH.grades) for (const g of SH.grades) {
          if (!SH.bands[g]) warn('$.shop.bands', `등급 '${g}'에 가격 밴드가 없습니다 — 그 등급은 가격 상한 없이 들어옵니다`);
        }
      }
      if (SH.sellRate != null && (typeof SH.sellRate !== 'number' || SH.sellRate <= 0 || SH.sellRate > 1)) {
        err('$.shop.sellRate', '매입률은 0 초과 1 이하 숫자 (감정가 대비 지급 비율)');
      }
      if (SH.maxStock != null && (!Number.isInteger(SH.maxStock) || SH.maxStock < 4 || SH.maxStock > 30)) {
        err('$.shop.maxStock', '진열 상한은 4~30 정수');
      }
      if (SH.when != null) {
        if (typeof SH.when !== 'string') err('$.shop.when', 'when은 표현식 문자열이어야 함');
        else if (SH.when.trim()) checkExpr(SH.when, '$.shop.when', allIds, err, { allowRand: false });
      }
      if (!SH.guide) warn('$.shop', '입고 지침(guide)이 없습니다 — 무엇을 파는 상점인지, 가격 감각을 적어 주세요 (뇌절 방지의 절반은 지침입니다)');
      if (!SH.grades || !SH.bands) warn('$.shop', '등급 어휘(grades)와 가격 밴드(bands)가 없으면 진열가를 시스템이 강제할 수 없습니다 — 로어북 상점의 뇌절이 재현됩니다');
      // 환전 (v0.97) — 상점 통화 ↔ 다른 지갑, 환율·수수료는 시스템 계산
      if (SH.exchange != null) {
        const EX = SH.exchange;
        if (typeof EX !== 'object' || Array.isArray(EX)) err('$.shop.exchange', 'exchange는 { var, rate, spread?, label? } 객체');
        else {
          const xv = (schema.vars || []).find((v) => v.id === EX.var);
          if (!EX.var || typeof EX.var !== 'string') err('$.shop.exchange.var', '상대 지갑 변수(var)가 필요합니다');
          else if (!xv) err('$.shop.exchange.var', `상대 지갑 '${EX.var}'가 vars에 없음`);
          else if (xv.type !== 'int' && xv.type !== 'float') err('$.shop.exchange.var', `상대 지갑 '${EX.var}'는 숫자 타입이어야 함 (현재: ${xv.type})`);
          else if (EX.var === SH.currency) err('$.shop.exchange.var', '상대 지갑이 상점 통화와 같습니다 — 환전이 성립하지 않아요');
          if (typeof EX.rate !== 'number' || !isFinite(EX.rate) || EX.rate <= 0) {
            err('$.shop.exchange.rate', '환율(rate)은 양수 — 통화 1이 상대 지갑으로 얼마인가');
          }
          if (EX.spread != null && (typeof EX.spread !== 'number' || EX.spread < 0 || EX.spread > 0.9)) {
            err('$.shop.exchange.spread', '수수료(spread)는 0~0.9 — 살 때 rate×(1+s), 팔 때 rate×(1-s)');
          }
        }
      }
    }
  }

  // ── scenario (시나리오레이터 v0.90 — 설계 docs/design-시나리오레이터.md) ──
  // 이야기의 척추: 선형 acts, 조건식 해금, minTurns 페이스 바닥.
  // 은닉이 요점이라 검증도 그 축이다 — 영영 안 열리는 막·모델에게 새어 나갈 이름 충돌을 잡는다.
  if (schema.scenario != null) {
    const S = schema.scenario;
    if (typeof S !== 'object' || Array.isArray(S)) err('$.scenario', 'scenario는 객체여야 함');
    else {
      if (S.label != null && typeof S.label !== 'string') err('$.scenario.label', 'label은 문자열이어야 함');
      // 예약 이름 충돌 — scn_idx·scn_turns는 세이브 예약 키, scn_act·scn_label은 노출 이름.
      // 같은 id의 변수/파생이 있으면 조건식이 시나리오가 아니라 그 변수를 읽는다 (시간 노출 충돌과 같은 사고).
      for (const rn of ['scn_idx', 'scn_turns', 'scn_act', 'scn_label']) {
        if (ids.has(rn) || derived.some((d) => d && d.id === rn)) {
          err('$.scenario', `'${rn}'는 시나리오가 쓰는 예약 이름입니다 — 그 변수/파생의 id를 바꾸세요`);
        }
      }
      const acts = Array.isArray(S.acts) ? S.acts : null;
      if (!acts || !acts.length) err('$.scenario.acts', '막(acts)이 최소 1개 필요합니다');
      else {
        const actIds = new Set();
        const INTENSITY_KEYS = ['잠복', '전개', '고조', '절정', '해소'];
        acts.forEach((a, i) => {
          const p = `$.scenario.acts[${i}]`;
          if (!a || typeof a !== 'object') { err(p, '막은 객체여야 함'); return; }
          if (a.id != null && !ID_RE.test(a.id)) err(p, `잘못된 막 id: '${a.id}' (영문자로 시작, 영문·숫자·_만)`);
          const aid = a.id || `act${i + 1}`;
          if (actIds.has(aid)) err(p, `중복 막 id: '${aid}'`);
          actIds.add(aid);
          if (a.label != null && typeof a.label !== 'string') err(p, 'label은 문자열이어야 함');
          // 해금식 — 첫 막은 즉시 시작이라 무시되고, 중간 막에 없으면 그 뒤가 전부 죽는다
          if (i === 0 && a.unlock != null) {
            warn(p, '첫 막의 unlock은 무시됩니다 — 첫 막은 즉시 시작합니다');
          }
          if (i > 0) {
            if (typeof a.unlock !== 'string' || !a.unlock.trim()) {
              err(p, `'${aid}' 막에 해금 조건(unlock)이 없습니다 — 이 막부터 뒤가 영영 안 열립니다`);
            } else {
              // rand() 금지 — 전환은 결정적이어야 진단·리롤·세이브가 어긋나지 않는다.
              // 우연에 걸고 싶으면 랜덤 이벤트가 세운 변수를 읽게 하라 (2단 구조 그대로).
              checkExpr(a.unlock, p + '.unlock', allIds, err, { allowRand: false });
            }
          }
          if (a.minTurns != null && (!Number.isInteger(a.minTurns) || a.minTurns < 0)) {
            err(p, 'minTurns는 0 이상의 정수여야 함');
          }
          if (i === 0 && a.minTurns != null) warn(p, '첫 막의 minTurns는 무시됩니다 — 들어오는 전환이 없습니다');
          if (a.direct != null) {
            if (typeof a.direct !== 'string') err(p, 'direct(연출 지시)는 문자열이어야 함');
            else checkTemplateRefs(a.direct, p + '.direct', allIds, err);
          }
          if (a.secret != null) {
            if (typeof a.secret !== 'string') err(p, 'secret(내막)은 문자열이어야 함');
            else checkTemplateRefs(a.secret, p + '.secret', allIds, err);
          }
          if (!String(a.direct || '').trim() && !a.intensity) {
            warn(p, `'${aid}' 막에 direct도 intensity도 없습니다 — 이 막이 열려도 모델에게 가는 연출 지시가 없습니다`);
          }
          if (a.intensity != null && !INTENSITY_KEYS.includes(a.intensity)) {
            err(p, `intensity는 ${INTENSITY_KEYS.join('/')} 중 하나 (현재: '${a.intensity}')`);
          }
          if (a.onEnter != null) {
            if (!Array.isArray(a.onEnter)) err(p, 'onEnter는 효과 배열이어야 함');
            else a.onEnter.forEach((r, j) => checkSet(r, `${p}.onEnter[${j}]`));
          }
          if (a.notify != null && typeof a.notify !== 'string') err(p, 'notify는 문자열이어야 함');
        });
        // 해금 변수의 기록 기준 (v0.93.1) — 해금이 읽는 변수를 보조 AI가 움직인다면(allow),
        // 그 변수의 desc가 곧 페이스 손잡이다: 보조 AI는 계약표의 desc를 보고 "언제 움직일지"를
        // 정한다 (판단은 조건식+minTurns 몫, AI는 기록만). desc가 비면 AI가 감으로 움직여
        // 막 페이스가 운에 맡겨진다. 이벤트·판정이 세우는 변수(allow 밖)는 대상이 아니다 — 오탐 0.
        const allowIds = new Set((schema.updater?.allow || []).map((x) => x && x.id).filter(Boolean));
        const descWarned = new Set();
        acts.forEach((a, i) => {
          if (i === 0 || typeof a.unlock !== 'string') return;
          // 문자열 리터럴 안의 단어를 변수로 오인하지 않게 벗겨 낸다 (stage == "friend" 류)
          const bare = a.unlock.replace(/"[^"]*"|'[^']*'/g, '');
          for (const m of bare.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
            const id = m[0];
            if (descWarned.has(id) || !allowIds.has(id)) continue;
            const v = (schema.vars || []).find((x) => x && x.id === id);
            if (!v || String(v.desc || '').trim()) continue;
            descWarned.add(id);
            warn(`$.scenario.acts[${i}].unlock`,
              `해금이 읽는 '${id}'는 보조 AI 담당인데 desc가 없습니다 — 보조 AI는 desc를 보고 언제 움직일지 정합니다. 변수 탭에서 기록 기준(예: "서사에서 실제로 확보했을 때만 +1")을 적어 주세요`);
          }
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function checkExpr(src, path, knownIds, err, { allowRand }) {
  if (typeof src !== 'string' || !src.trim()) { err(path, '표현식 필요'); return; }
  try {
    compile(src); // 문법 검사
    for (const name of referencedVars(src)) {
      if (!knownIds.has(name)) err(path, `알 수 없는 변수 '${name}'`);
    }
    if (!allowRand && /\brand\s*\(/.test(src)) err(path, '이 위치에서는 rand() 사용 불가');
  } catch (e) {
    if (e instanceof ExprError) err(path, `표현식 오류: ${e.message}`);
    else throw e;
  }
}

// 수식이 아니라 렌더러가 채워 넣는 자리 — 변수가 아니므로 참조 검사에서 빼야 한다.
// uid = 이 상태창이 그려진 메시지의 꼬리표. 템플릿에서 라디오 id·name에 섞어 쓴다.
// lastcheck = 마지막 판정 한 줄 (판정 전에는 빈 문자열). choices = 걸린 갈림길의 선택지 목록.
// scenario = 시나리오 진행 칩(현재 막 라벨 + i/N막, v0.93 — 시나리오가 없으면 빈 문자열).
const RESERVED_SLOTS = new Set(['commands', 'uid', 'lastcheck', 'choices', 'scenario']);

// {id} / {expr ? a : b} 템플릿 참조 검사
function checkTemplateRefs(tpl, path, knownIds, err) {
  const re = /\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(tpl))) {
    // 리수 CBS({{...}})는 우리 문법이 아니다 — renderTemplate과 같은 기준으로 건너뛴다 (v0.76).
    // 예전엔 여기서 하드 오류가 나 `{{img::지도}}` 하나만 있어도 설치가 거부됐다 (렌더는 멀쩡했다).
    if (tpl[m.index - 1] === '{' && tpl[m.index + m[0].length] === '}') continue;
    const inner = m[1].trim().replace(/:tags$/, ''); // {id:tags} 필터 접미사 제거 후 검사
    if (RESERVED_SLOTS.has(inner)) continue;
    try {
      compile(inner);
      for (const name of referencedVars(inner)) {
        if (!knownIds.has(name)) err(path, `템플릿의 알 수 없는 변수 '${name}'`);
      }
    } catch (e) {
      err(path, `템플릿 '{${inner}}' 해석 불가: ${e.message}`);
    }
  }
}

module.exports = { validateSchema, varFreeWork };
