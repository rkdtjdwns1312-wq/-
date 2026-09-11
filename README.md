# 콕끼리 배드민턴 홈페이지

콕끼리 배드민턴 모임의 회원용 홈페이지와 운영진 전용 화면 코드입니다. 공지사항, 대진표, 시드(등급) 현황을 보여주고, 대진표 경기 결과를 입력하면 점수(랭킹 포인트)가 자동으로 계산됩니다.

이 저장소를 **main** 브랜치에 올리면(push) **Cloudflare Workers**가 자동으로 홈페이지를 다시 배포합니다. 빌드(컴파일) 과정이 따로 없어서, 저장소 안의 파일이 곧 실제로 서비스되는 내용입니다.

## 처음 한 번만 하는 설정

아래 순서대로 딱 한 번만 하면 됩니다. 버튼 이름을 그대로 적어두었으니 화면에서 똑같은 글자를 찾아 누르면 됩니다.

### 1. GitHub에서 새 저장소 만들기

1. [github.com](https://github.com)에 로그인합니다.
2. 오른쪽 위 `+` 버튼을 누르고 `New repository`를 선택합니다.
3. Repository name에 `kokkiri-site`를 입력합니다.
4. `Private`를 선택합니다.
5. README, .gitignore 등 추가 항목은 **체크하지 않고** 그대로 `Create repository`를 누릅니다.
6. 만들어진 저장소 주소(`https://github.com/<내 계정>/kokkiri-site.git`)를 클로드(또는 코덱스)에게 알려주면, 지금까지 만든 코드를 그 주소로 올려줍니다.

### 2. Cloudflare 가입/로그인

1. [dash.cloudflare.com](https://dash.cloudflare.com)에 접속해 가입하거나 로그인합니다.
2. 요금제는 무료 플랜을 선택합니다.
3. workers.dev 하위 도메인 이름을 정하라고 하면 **모임 이름으로** 정합니다(예: `kokkiri-badminton`). 이 이름이 홈페이지 주소에 그대로 들어가므로(`https://kokkiri.kokkiri-badminton.workers.dev`), **개인 아이디나 이름은 넣지 않습니다.** 나중에 바꾸려면 `Workers & Pages` → 오른쪽 `Account details`의 하위 도메인 옆 `Change`를 누르면 됩니다.
4. GitHub 계정 이름은 저장소가 비공개(Private)라 회원들에게 보이지 않습니다. 홈페이지 주소에는 Worker 이름(`kokkiri`)과 위에서 정한 하위 도메인만 들어갑니다.

### 3. D1 데이터베이스 만들기

1. 왼쪽 메뉴에서 `Storage & Databases`를 누릅니다.
2. `D1 SQL Database`를 누릅니다.
3. `Create Database`를 누릅니다.
4. 이름에 `kokkiri`를 입력하고 만듭니다.
5. 만들어진 뒤 화면에 나오는 `Database ID`를 복사합니다.
6. 이 값을 클로드(또는 코덱스)에게 알려주면 `wrangler.jsonc` 파일에 넣고, 그 변경을 GitHub에 다시 push까지 해 줍니다. **이 값이 들어간 상태로 push가 끝난 뒤에 4단계를 진행하세요.** (기본값인 `여기에-...-붙여넣기` 상태로 배포하면 첫 배포가 실패합니다.)

### 4. GitHub 저장소를 Cloudflare에 연결

1. 왼쪽 메뉴에서 `Compute (Workers)` → `Workers & Pages`를 누릅니다.
2. `Create`를 누릅니다.
3. `Workers` 탭에서 `Import a repository`(또는 `Connect to Git`)를 누릅니다.
4. GitHub 연결을 승인합니다.
5. `kokkiri-site` 저장소를 선택합니다.
6. 프로젝트 이름에 `kokkiri`를 입력합니다.
7. Build settings에서 Build command는 **비워 둡니다**.
8. Deploy command 칸에 아래 내용을 그대로 붙여넣습니다.

   ```
   npx wrangler d1 migrations apply DB --remote && npx wrangler deploy
   ```

9. `Create and deploy`를 누릅니다.

### 5. 비밀값 넣기

기존에 쓰던 운영진 전용 주소와 운영진 비밀번호를 여기에도 넣어줘야 예전과 똑같이 접속할 수 있습니다. 이 값들은 문서나 코드에 절대 적지 않습니다.

1. `Workers & Pages` → `kokkiri`를 누릅니다.
2. `Settings` → `Variables and Secrets`로 이동합니다.
3. `Add`를 누르고 Type을 `Secret`으로 선택합니다.
4. 이름에 `EDITOR_KEY`를 입력하고, 값에는 운영진 전용 주소의 뒷부분 값을 넣습니다. (기존 운영진 링크를 그대로 쓰려면, 지금 쓰던 주소에서 `operate-` 뒤에 오는 문자열을 그대로 넣으면 됩니다.) 저장합니다.
5. 다시 `Add`를 눌러 이름 `OPERATOR_PASSWORD`, 값에는 운영진 화면의 `운영진권한` 버튼을 누를 때 입력하는 비밀번호를 넣고 저장합니다.
6. `Deploy`를 눌러 다시 배포합니다.

### 6. 확인

1. `Workers & Pages` → `kokkiri` 화면 위쪽에 있는 주소(`https://kokkiri.<내가 정한 하위도메인>.workers.dev`)를 눌러 엽니다.
2. 홈 화면이 정상적으로 뜨는지 확인합니다.
3. 운영진 화면은 `그 주소/operate-<EDITOR_KEY 값>`으로 들어가거나, 회원 홈 오른쪽 아래의 `운영진권한` 버튼을 눌러 비밀번호를 입력하면 됩니다.

### 7. (선택) 나중에 내 도메인 연결하기

나중에 직접 가진 도메인을 연결하고 싶다면 `Settings` → `Domains & Routes` → `Add` → `Custom domain`을 누르면 됩니다.

## 그 다음부터는

코덱스든 클로드든 이 저장소의 **main** 브랜치에 push하면, 1~2분 안에 자동으로 새 버전이 배포됩니다. 따로 버튼을 누를 필요가 없습니다.

배포가 잘 됐는지는 `Workers & Pages` → `kokkiri` → `Deployments`에서 확인할 수 있습니다.

## 폴더 구조

- `dist/server/` — 실제 서비스되는 서버 코드
- `drizzle/` — 데이터베이스 구조를 바꾸는 마이그레이션 파일들 (`0000_...`, `0001_...` 순서로 자동 적용됨)
- `public/` — 마스코트 이미지 등 정적 파일
- `check-login.mjs` — 로그인/점수 계산 등을 확인하는 테스트 스크립트
- `scripts/export-old-site.mjs` — 옛 사이트의 공개 읽기 API에서 데이터를 받아 `drizzle/0004_*.sql`을 다시 만들어 주는 스크립트 (이미 한 번 실행해 둔 결과가 저장소에 들어 있습니다)
- `package.json` — 테스트/배포 명령과 wrangler 버전
- `.github/workflows/test.yml` — push할 때마다 GitHub에서 테스트를 자동 실행
- `wrangler.jsonc` — Cloudflare Workers 배포 설정

## 로컬 테스트

터미널에서 다음을 실행하면 됩니다. (Node.js 24 이상 필요)

```
node check-login.mjs
```

이 컴퓨터에는 Node가 기본 PATH에 등록되어 있지 않아서, 코덱스가 쓰는 번들 Node(`C:\Users\just\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`)로 실행합니다.

## 옛 사이트(Codex Sites)와의 관계

옛 주소 `https://kokkiri-badminton-draw.rkdtjdwns1312.chatgpt.site`는 새 주소가 잘 작동하는지 확인될 때까지 그대로 남겨두고, 확인 후에 회원들에게 새 주소를 알립니다. 옛 사이트에 있던 공지사항과 대진표는 마이그레이션 파일 `drizzle/0004_*.sql`을 통해 새 데이터베이스로 옮겨집니다.

## 주의

대진표 결과 정산(점수 반영)은 대진표 하나당 **딱 한 번만** 할 수 있고, 한 번 하면 **되돌릴 수 없습니다**. 실제 운영 중인 데이터로 테스트 정산을 하지 마세요.
