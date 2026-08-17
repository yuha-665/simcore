-- ══════════════════════════════════════════════════════════════════
-- 챕터 요약 (보조모델) — 모듈 Lua 트리거
-- ══════════════════════════════════════════════════════════════════
-- 메인 모델이 응답 끝에 쓰던 [CHAPTER SUMMARY]를 보조모델 호출로 분리한 것.
-- 응답이 붙은 뒤 axLLM(보조모델)으로 3~5문장 요약을 받아 메시지 끝에 ⬥ 줄로 덧붙인다.
-- 번호 잇기·타임스탬프 추출은 코드가 한다 — 모델에게 숫자 잇기를 맡기면 언젠가 틀린다.
--
-- 설치:
--  · 압축 정규식이 있는 그 모듈에 트리거 스크립트(Lua)로 추가
--  · 모듈 트리거의 lowLevelAccess 플래그 켜기 (또는 캐릭터 low level access 체크)
--  · 리수 설정에 보조(auxiliary) 모델 지정
--  · 메인 프롬프트의 CHAPTER SUMMARY 지시 블록은 제거 (이중 생성 방지).
--    Part 1(씬 타임스탬프) 지시는 본문 소재이므로 남긴다.
--
-- 궁합:
--  · 압축 정규식(최근 N개 외 본문 삭제)은 그대로 동작. 요약 생성이 실패한 메시지는
--    ⬥가 없어 정규식이 매치를 못 하고 본문이 그대로 전송된다 — 우아한 강등.
--  · 심코어 병행 시 보조모델이 턴당 2회 호출된다 (상태 델타 1 + 요약 1).
--    요약 호출은 이번 응답 본문 + 직전 요약 한 줄만 보내는 작은 호출이다.
--  · 심코어 상태창 마커 등 다른 손이 같은 메시지를 고칠 수 있어, 쓰기 직전에
--    메시지를 다시 읽고 그 사이 본문이 바뀌었으면(리롤 등) 조용히 포기한다.
--
-- 리롤: onOutput이 다시 돌아 요약도 새로 생성된다. 번호는 이전 메시지들에서 읽으므로
-- 안 꼬인다. 기존 채팅에 메인 모델이 써 둔 ⬥ 줄과도 번호가 자연스럽게 이어진다.

local MARK = '⬥'
-- 씬 타임스탬프 추출 패턴 — Part 1이 본문에 넣는 형식이 다르면 여기만 고친다.
-- 기본: ⏱️[...] 꼴의 마지막 것. 못 찾으면 직전 요약의 타임스탬프를 잇는다.
local TS_PATTERN = '⏱️%[(.-)%]'

local RULES = [==[
You compress one roleplay response into a chapter summary.
Output exactly two lines and nothing else:
EVENTS: 3-5 sentences, past tense, third person, in English. State actions and outcomes only. No adverbs that color tone (highly, deeply, instantly, briskly, shamelessly). No interpretive adjectives describing mood (satisfied, annoyed, lazy, productive, eager). Observable behavior is fine (she fell asleep, he stopped mid-sentence). If the response ends mid-thought or unresolved, end the summary unresolved — do not force a clean closing line.
NOTES: only things worth preserving — newly revealed truths, items acquired or lost, secrets learned, promises made or broken, decisive irreversible moments. Short bullet-style, comma-separated, factual. No emotional changes, no relationship developments, no atmospheric details. If nothing qualifies, write exactly: none
Output the two lines directly — no preamble, no reasoning, no tags.
]==]

-- 추론형 보조모델은 답 앞에 생각(<Thoughts>…)을 뱉고, 그 안에 EVENTS:/NOTES: 초안이 섞이기도
-- 한다 (실사고: 사고 과정이 통째로 ※ Notes에 실림). 마지막 EVENTS: 이후만 정답으로 본다.
local function lastAnswer(s)
  local pos, p = nil, 1
  while true do
    local q = s:find('EVENTS:', p, true)
    if q == nil then break end
    pos = q; p = q + 1
  end
  return pos and s:sub(pos) or nil
end

-- 본문에서 기존 ⬥ 블록을 뗀다 (재실행·기존 메인 모델 요약 대비)
local function stripSummary(s)
  local p = s:find(MARK .. ' Episode', 1, true)
  if p then return (s:sub(1, p - 1):gsub('%s+$', '')) end
  return s
end

onOutput = async(function(id)
  local chat = getFullChat(id)
  if chat == nil or #chat == 0 then return end
  local n = #chat
  if chat[n].role ~= 'char' then return end
  local body = stripSummary(chat[n].data or '')
  if body == '' then return end

  -- 직전 요약에서 번호·타임스탬프를 잇는다 (없으면 Episode 1 - Chapter 1부터)
  local ep, ch, prevLine, prevTs = 1, 0, nil, nil
  for i = n - 1, 1, -1 do
    local d = chat[i].data or ''
    local s = d:find(MARK .. ' Episode', 1, true)
    if s then
      prevLine = d:sub(s):match('[^\n]+')
      local e2, c2 = prevLine:match('Episode%s+(%d+).-Chapter%s+(%d+)')
      if e2 then ep, ch = tonumber(e2), tonumber(c2) end
      prevTs = prevLine:match(TS_PATTERN)
      break
    end
  end

  -- 이번 응답의 마지막 씬 타임스탬프 → 없으면 직전 요약 것을 잇는다
  local ts = nil
  for cap in body:gmatch(TS_PATTERN) do ts = cap end
  ts = ts or prevTs or '----'

  local res = axLLM(id, {
    { role = 'system', content = RULES },
    { role = 'user', content = (prevLine and ('Previous chapter (context only, do not re-summarize): '
        .. prevLine .. '\n\n') or '') .. 'Response to summarize:\n' .. body },
  })
  if res == nil or not res.success or type(res.result) ~= 'string' then
    log('[챕터요약] 보조 호출 실패 — 이 메시지는 요약 없이 둔다: ' .. tostring(res and res.result))
    return
  end
  local tail = lastAnswer(res.result)
  if tail == nil then
    log('[챕터요약] 응답에 EVENTS: 가 없음 — 스킵: ' .. res.result:sub(1, 120))
    return
  end
  local events = tail:match('EVENTS:%s*(.-)%s*NOTES:') or tail:match('EVENTS:%s*(.-)%s*$')
  local notes = tail:match('NOTES:%s*(.-)%s*$')
  if events == nil or events == '' then
    log('[챕터요약] 응답 형식이 어긋남 — 스킵: ' .. res.result:sub(1, 120))
    return
  end
  events = events:gsub('%s+', ' ')
  -- NOTES는 한 줄 규격 — 뒤에 군더더기가 붙어도 첫 줄만 취한다
  if notes then notes = notes:match('[^\n]+') end

  local block = MARK .. ' Episode ' .. ep .. ' - Current Chapter ' .. (ch + 1)
    .. ' | ⏱️[' .. ts .. ']: ' .. events
  if notes and notes ~= '' and notes:lower() ~= 'none' then
    block = block .. '\n※ Notes: ' .. notes:gsub('%s+', ' ')
  end

  -- 보조 호출 동안 다른 손(심코어 마커 부착 등)이 메시지를 고쳤을 수 있다 —
  -- 쓰기 직전에 다시 읽고, 본문 자체가 바뀌었으면(리롤) 새 출력의 onOutput에 맡긴다.
  local fresh = getFullChat(id)
  if fresh == nil or #fresh < n or fresh[n].role ~= 'char' then return end
  local freshData = fresh[n].data or ''
  if stripSummary(freshData):sub(1, #body) ~= body then
    log('[챕터요약] 쓰기 직전 본문이 바뀜(리롤?) — 이번 요약은 버린다')
    return
  end
  setChat(id, n - 1, stripSummary(freshData) .. '\n\n' .. block)
end)
