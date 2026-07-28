// 스키마 검증 — 제작자 경험의 절반. 오류는 위치(path)와 함께 전부 수집해서 돌려준다.

const { compile, referencedVars, ExprError } = require('./expr');

const VAR_TYPES = ['int', 'float', 'text', 'bool', 'enum', 'list'];
const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const RESERVED = new Set(['true', 'false', 'and', 'or', 'not',
  'round', 'floor', 'ceil', 'abs', 'min', 'max', 'clamp', 'rand', 'count', 'has', 'sum']);

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
  if (!vars.length) err('$.vars', '변수가 하나도 정의되지 않음');
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
    if (v.id === 'commands') {
      warn(p, `'commands'는 상태창 자리표시자 {commands}가 쓰는 이름입니다 — 변수 id를 바꾸세요`);
    }
    if (v.cmd != null) {
      if (typeof v.cmd !== 'string' || !v.cmd.trim()) err(p, 'cmd는 비어있지 않은 문자열이어야 함');
      else if (/[\s\/-]/.test(v.cmd)) err(p, `cmd '${v.cmd}'에 공백·'/'·'-'는 쓸 수 없음`);
      else if (cmdNames.has(v.cmd)) err(p, `중복된 cmd: '${v.cmd}'`);
      else cmdNames.add(v.cmd);
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
  for (let i = 0; i < derived.length; i++) {
    const d = derived[i], p = `$.derived[${i}]`;
    if (!d.id || !ID_RE.test(d.id)) { err(p, `잘못된 id: '${d.id}'`); continue; }
    if (allIds.has(d.id)) err(p, `중복된 id: '${d.id}'`);
    allIds.add(d.id);
    checkExpr(d.expr, p + '.expr', allIds, err, { allowRand: false });
  }

  const listIds = new Set(vars.filter((v) => v.type === 'list').map((v) => v.id));
  const checkSet = (rule, p) => {
    // 목록 효과 { list, add, remove, expire }
    if (rule.list !== undefined) {
      if (!listIds.has(rule.list)) err(p, `list 효과 대상 '${rule.list}'이 목록(list) 변수가 아님`);
      if (rule.add != null && !Array.isArray(rule.add)) err(p, 'add는 배열이어야 함');
      if (rule.remove != null && !Array.isArray(rule.remove)) err(p, 'remove는 배열이어야 함');
      if (rule.expire != null) {
        if (typeof rule.expire !== 'string') err(p, 'expire는 수식 문자열이어야 함 (예: "day")');
        else checkExpr(rule.expire, p + '.expire', allIds, err, { allowRand: false });
      }
      if (rule.add == null && rule.remove == null && rule.expire == null)
        warn(p, 'add/remove/expire가 모두 없는 list 효과');
      return;
    }
    if (!ids.has(rule.set)) err(p, `set 대상 '${rule.set}'이 vars에 없음 (derived는 set 불가)`);
    else if (listIds.has(rule.set)) err(p, `목록 '${rule.set}'은 수식 set 불가 — list 효과(add/remove)를 사용`);
    checkExpr(rule.expr, p + '.expr', allIds, err, { allowRand: true });
  };

  // ── rules ──
  const rules = schema.rules || {};
  (rules.onTurn || []).forEach((r, i) => checkSet(r, `$.rules.onTurn[${i}]`));
  const eventIds = new Set();
  (rules.events || []).forEach((e, i) => {
    const p = `$.rules.events[${i}]`;
    if (!e.id) err(p, '이벤트 id 필요');
    else if (eventIds.has(e.id)) err(p, `중복 이벤트 id: '${e.id}'`);
    else eventIds.add(e.id);
    checkExpr(e.when, p + '.when', allIds, err, { allowRand: false });
    (e.effects || []).forEach((r, j) => checkSet(r, `${p}.effects[${j}]`));
    if (e.notify != null && typeof e.notify !== 'string') err(p, 'notify는 문자열');
  });
  const re = rules.randomEvents;
  if (re) {
    if (typeof re.chancePerTurn !== 'number' || re.chancePerTurn < 0 || re.chancePerTurn > 1)
      err('$.rules.randomEvents.chancePerTurn', '0~1 사이 숫자 필요');
    (re.table || []).forEach((e, i) => {
      const p = `$.rules.randomEvents.table[${i}]`;
      if (!e.id) err(p, '이벤트 id 필요');
      else if (eventIds.has(e.id)) err(p, `중복 이벤트 id: '${e.id}'`);
      else eventIds.add(e.id);
      if (e.weight != null && (typeof e.weight !== 'number' || e.weight <= 0)) err(p, 'weight는 양수');
      if (e.when != null) checkExpr(e.when, p + '.when', allIds, err, { allowRand: false });
      (e.effects || []).forEach((r, j) => checkSet(r, `${p}.effects[${j}]`));
    });
  }

  // ── updater ──
  const up = schema.updater || {};
  if (up.contextTurns != null
      && (typeof up.contextTurns !== 'number' || !Number.isInteger(up.contextTurns)
          || up.contextTurns < 1 || up.contextTurns > 5))
    err('$.updater.contextTurns', '보조모델에 보낼 최근 대화 턴 수는 1~5 사이 정수여야 함');
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
  // 진짜 문제는 **똑같은 낱말**이다 — 어느 쪽을 열지 가릴 방법이 없어 둘이 늘 함께 열린다.
  {
    const seenKey = new Map();
    for (const a of (up.allow || [])) {
      if (!a.mentions) continue;
      const v = varById[a.id];
      const keys = (a.mentions === true ? [v?.label] : [].concat(a.mentions))
        .filter((k) => typeof k === 'string' && k.trim());
      for (const k of keys) {
        const key = k.trim().toLowerCase();
        if (seenKey.has(key) && seenKey.get(key) !== a.id) {
          warn('$.updater.allow', `'${k}'를 ${seenKey.get(key)}와 ${a.id}가 함께 씁니다`
            + ' — 갈릴 방법이 없어 늘 같이 열립니다. 한쪽을 다르게 적으세요');
        } else seenKey.set(key, a.id);
      }
    }
  }

  // ── promptState / statusUI ──
  if (schema.promptState?.template) {
    checkTemplateRefs(schema.promptState.template, '$.promptState.template', allIds, err);
  }
  if (typeof schema.promptState?.eventPriority === 'string') {
    checkTemplateRefs(schema.promptState.eventPriority, '$.promptState.eventPriority', allIds, err);
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
    else checkTemplateRefs(d.text, p + '.text', allIds, err);
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
  });

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
const RESERVED_SLOTS = new Set(['commands', 'uid']);

// {id} / {expr ? a : b} 템플릿 참조 검사
function checkTemplateRefs(tpl, path, knownIds, err) {
  const re = /\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(tpl))) {
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

module.exports = { validateSchema };
