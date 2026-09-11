# GitHub + Cloudflare 전환 준비와 주소 개인정보 제거

- 작업 시각: 2026-09-12 02:05 ~ 02:25 KST
- 작업 도구: Claude Code (계획·최종 점검 Fable, 구현 Sonnet 서브에이전트 2개 병렬, 검증 Opus 서브에이전트 1개)
- 관련 요청: 025, 026

## 1. 요청 번호와 요청 요약

- 요청 025: 코덱스와 클로드 양쪽에서 수정·배포할 수 있고 접근 가능한 도메인에 사이트를 만들어 달라. 지금까지 내용을 모두 반영.
- 요청 026: 옛 주소에 개인 아이디(rkdtjdwns1312 등)가 들어가 개인정보가 노출됐으니 새 사이트 이름에는 그런 표현이 없게 해 달라.

## 2. 계획 (Fable)

- 조사: 옛 사이트 공개 API(GET)로 데이터 이관이 가능한지, 이 PC의 도구 상황(npm 없음, 코덱스 번들에 pnpm 있음, gh 없음, GitHub git 자격은 있음).
- 구조 결정: **GitHub 비공개 저장소 = 공용 원본**, **Cloudflare Workers Builds = push마다 자동 배포**, **D1 = 데이터베이스**. 이유: (1) 코드가 이미 Cloudflare Workers 형식이라 변경이 거의 없다. (2) 코덱스는 샌드박스 사용자로 실행돼 이 PC의 로그인 정보를 쓸 수 없으므로 "push하면 배포"가 양쪽 모두에 맞는다. (3) 무료 플랜으로 충분(요청·저장 용량 소규모). (4) 주소는 `https://kokkiri.<사용자가 정한 하위도메인>.workers.dev`라 개인 아이디를 넣지 않을 수 있다(요청 026).
- 검토한 대안: Claude 아티팩트(정적 전용이라 서버·DB 불가, 코덱스가 편집 불가), Firebase(서버 코드 재작성 필요, 이전에 배포 실패), Codex Sites 유지(클로드가 배포 불가). 모두 제외.
- 분담: Sonnet A = Cloudflare 설정·정적 이미지 분리·CI·README. Sonnet B = 옛 사이트 데이터 내보내기 스크립트와 마이그레이션 0004, 테스트 갱신. 서로 다른 파일만 다루도록 나눔.

## 3. 수행 내용과 변경 파일 (Sonnet 2개 + Fable)

- Sonnet A: `wrangler.jsonc`(Worker 이름 kokkiri, D1 바인딩 DB·database_id 자리표시자·migrations_dir drizzle, assets ./public, observability), `package.json`(wrangler devDependency, test/deploy/dev 스크립트), `.gitignore`, `.github/workflows/test.yml`(Node 24로 check-login.mjs), `public/mascot-play.png`·`public/mascot-rest.png`(정적 자산), `dist/server/images.js`를 빈 스텁으로(4.1MB → 133B; 무료 플랜 Worker 3MB 한도 대비), `build-images.cjs` 삭제, `README.md`(초보자용 7단계 설정 안내).
- Sonnet B: `scripts/export-old-site.mjs`(옛 사이트 공개 GET API에서 공지·대진표·단일 대진표를 받아 SQL 생성, 재실행 가능), `drizzle/0004_seed_posts_from_codex_site.sql`(INSERT OR IGNORE 4문: schedules 1, board_posts 3 = 공지 2 + legacy-schedule 1), `check-login.mjs` 마이그레이션 목록에 0004 추가.
- Fable: git 원격 재정리(`origin` → `codex-sites`로 이름 변경, `origin` = `https://github.com/rkdtjdwns1312-wq/kokkiri-site.git` 추가), `dist/`의 중복 PNG 제거(public/과 바이트 동일 확인 후, git은 이동으로 인식), README 2단계에 요청 026 반영(하위도메인은 모임 이름으로, 개인 아이디 금지, 변경 방법, GitHub 계정명은 비공개 저장소에만), `CLAUDE.md` 2·3·5·7절과 `AGENTS.md`를 새 Git·배포 구조로 갱신, `메인.md` 갱신.
- 커밋: `9e9afac` "Prepare hosting on GitHub + Cloudflare Workers with D1" (02:19 KST, 12파일, Co-Authored-By: Claude Fable 5.1). main은 codex-sites/main보다 7커밋 앞섬. GitHub push는 저장소가 아직 없어 미수행.

## 4. 검증 결과 (Opus 서브에이전트, 조건부 통과)

- 확인: wrangler.jsonc 주석 제거 후 유효 JSON·키 유효, `env.DB` 바인딩 일치, package.json 유효, images.js 스텁으로 `images[path]` 분기 안전, PNG SHA-256 public↔dist 동일, HTML 참조 경로 일치, YAML 유효, export 스크립트는 GET만·페이지네이션·payload 제외 필드·따옴표 이스케이프·스키마 컬럼 일치, **0004 SQL을 옛 사이트에서 재생성해 라인 단위 완전 일치(4/4)**, 마이그레이션 0000~0004 적용 후 board_posts 3·schedules 1과 worker 엔드포인트 200 응답, `check-login.mjs` PASS, 비밀값 grep 0건, 서버 번들 61KB, nodejs_compat 불필요.
- Opus가 수정한 것 3건: `.gitignore`에 `.dev.vars` 추가(로컬 비밀 파일 커밋 방지), README 3단계에 "database_id를 넣고 push한 뒤 4단계 진행" 경고, README 폴더 구조의 모순 문구 수정.
- 보고만: package-lock.json 없음(wrangler 버전 미고정), Codex Sites 잔재 파일 보존, 0000·0001의 CREATE TABLE에 IF NOT EXISTS 없음(재시도 시 위험 낮음), `wrangler deploy --dry-run`은 npm 부재로 미실행.
- 첫 배포 실패 위험 순위: ① database_id 자리표시자 미교체, ② 비대화형 마이그레이션 확인 프롬프트(CI에서는 자동 승인 예상), ③ lockfile 부재.

## 5. 최종 점검 (Fable)

- wrangler.jsonc·README·0004 SQL을 직접 읽어 확인. Opus 지적 중 중복 PNG 제거는 반영, 나머지 보고 사항은 메인.md에 남김. 테스트 PASS 재확인 후 커밋.
- 요청 026: 새 주소 형식상 개인 아이디가 들어갈 자리는 사용자가 정하는 하위도메인뿐이며 README에 명시. GitHub 계정명은 비공개 저장소 주소에만 쓰임.

## 6. 미완료 사항과 다음 단계

- 사용자: GitHub 비공개 저장소 `kokkiri-site` 생성 → 주소 전달. Cloudflare 가입(하위도메인은 모임 이름) → D1 `kokkiri` 생성 → Database ID 전달 → 에이전트가 wrangler.jsonc 수정·push → Workers & Pages에서 저장소 연결(Deploy command 지정) → Secrets 2개 입력 → 새 주소 확인.
- 에이전트: 저장소 주소를 받으면 `git push -u origin main`(계정·이름이 다르면 `git remote set-url origin`), Database ID를 받으면 wrangler.jsonc 교체 커밋·push. 첫 배포 로그에서 마이그레이션 적용 확인. 확인 후 메인.md '현재 상태'를 배포 완료로 갱신하고 회원 안내 문구 준비.
- 전환 직전에 옛 사이트에 새 글이 있으면 export 스크립트를 재실행해 0004를 갱신(원격 D1에 0004 적용 전까지만).

## 7. Git 동기화·배포 결과

- 로컬 커밋 9e9afac 완료. GitHub push 미완(저장소 미생성). Cloudflare 배포 미완(계정 미설정). 옛 Codex Sites는 옛 버전 그대로.

## 핵심 명령

코덱스와 클로드 양쪽에서 배포할 수 있도록 GitHub + Cloudflare 구조로 전환을 준비하고, 새 주소에 개인 아이디가 들어가지 않게 한다.
