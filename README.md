# SimCore — RisuAI 시뮬 엔진 플러그인

봇에 숫자로 굴러가는 상태를 붙이는 RisuAI 플러그인. 스키마 하나로 변수·파생·규칙·이벤트·상태창을
정의하면, 메인 모델에는 상태 블록을, 보조 모델에는 갱신 지시를 내보낸다.

## 리포 구성

| 경로 | 내용 | 상태 |
|---|---|---|
| `simcore.plugin.js` | 빌드 산출물 (리수에 임포트하는 파일) | v0.38.2 |
| `.claude/skills/simcore/` | 개발·유지보수 레퍼런스 스킬 (Claude용) | ✅ |
| `core/` | 소스 모듈 | ⚠ **미이관 — cowork 환경에서 포팅 필요** |
| `build.js` | 번들 빌드 스크립트 (`node build.js → dist/simcore.plugin.js`) | ⚠ 미이관 |
| `테스트/` | `test-*.js` — 전부 돌려 `N passed, 0 failed` 확인 | ⚠ 미이관 |

## ⚠ 이관 TODO (cowork 세션에서 할 것)

이 리포는 회사 노트북에 있던 번들(v0.38.2)과 스킬로 시드한 상태다.
cowork 환경에만 있는 `core/*` 소스, `build.js`, 테스트를 이 리포에 커밋해서
**소스-번들 이중 구조를 끝내는 것**이 이 리포의 존재 이유다.

이관 후 체크리스트:
- [ ] `core/*`, `build.js`, 테스트 커밋
- [ ] `node build.js` 산출물이 현재 `simcore.plugin.js`(v0.38.2)와 일치하는지 diff — 로컬 직수정분이 소스에 빠져 있으면 여기서 드러난다
- [ ] 스킬 `SKILL.md`의 `E:\0.리수봇\...` 경로를 리포 기준 상대 경로로 갱신 (집 PC 전용 경로임)

## 작업 환경별 워크플로

- **집 PC** (`E:\0.리수봇\simcore\`): 이 리포를 clone해서 갈아탈 것. 기존 E:\ 트리는 이관 완료 후 참조용으로만
- **회사 노트북**: `C:\claude\simcore` clone
- **cowork / claude.ai**: GitHub 커넥터로 이 리포를 열면 소스·스킬 자동 로드
