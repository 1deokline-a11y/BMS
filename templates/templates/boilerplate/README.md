# AJW App Hub — 표준 앱 템플릿

이 폴더를 복제해서 **내 앱**을 만드세요. 내 노트북에서 개발한 뒤, 맥미니의
**부서 폴더**(`/Users/ajworld/Apps/dev/<부서>/<내이름>/<앱>/`)에 올리면 약 1분 내
자동으로 앱허브에 등록·기동되어 **나만 쓰는 테스트(dev_live)** 상태가 됩니다.

> 전체 개발 지침은 `/Users/ajworld/Apps/dev/개발자지침.md` 를 먼저 읽으세요.

## 사용법

1. 이 폴더를 통째로 복사해 이름을 바꾼다 (예: `sales-dashboard`).
   - **폴더명은 소문자 영문/숫자/하이픈**만 (서브도메인·컨테이너 이름이 됨. 대문자·공백 금지).
2. `service.yml` 의 `title`·`description` 을 채운다. (대시보드 카드에 그대로 표시됨)
3. `.owner` 파일에 **내 실제 포털 이메일**을 적는다.
   - ⚠️ **플레이스홀더(`your-email@ajw.co.kr`)를 그대로 두지 말 것.** 그대로 두면 앱 이름이
     깨지고 내가 내 앱에 접근하지 못합니다.
4. `server.mjs` 의 `renderHome()` 안에 내 앱 화면/로직을 만든다.
   - 다른 언어/프레임워크도 OK. 아래 "계약"만 지키면 됨.
5. 완성된 폴더를 **내 부서 폴더**에 업로드한다:
   `/Users/ajworld/Apps/dev/<부서>/<내이름>/<앱폴더>/`
   - 부서 슬러그: `sales`(영업본부) · `marketing`(마케팅팀) · `qm`(품질기술팀) ·
     `general-affairs`(총무팀). (SCM 담당자는 지침 참고)
6. **끝.** 약 1분 내 자동 감지되어 앱허브에 나타난다. 결과 로그: `logs/onboard/<앱>.log`.
   - 지금 바로 반영하고 싶으면 (선택) 업로드 후 `touch .deploy`.

## 계약 (지켜야 작동)

- **Dockerfile** 로 컨테이너 빌드 가능.
- 앱은 **포트 3000 에서 listen** (이 템플릿의 `server.mjs` 가 이미 그렇게 함. nginx 등 다른
  서버를 쓰면 반드시 `listen 3000` 으로).
- **`/health`** 가 200 응답 (헬스체크).
- 미로그인 시 **포털 OAuth 로 리다이렉트**, `/auth/callback` 에서 토큰 교환.
- 허브가 주입하는 환경변수 사용: `PORT`, `PORTAL_PUBLIC_URL`, `PORTAL_INTERNAL_URL`,
  `APP_PUBLIC_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SESSION_SECRET`
  (이 템플릿의 `server.mjs` 가 이미 다 처리함).

## 데이터 (공유 DB)

- **DB 는 환경변수 `DATABASE_URL` 로 접속**하세요 (사내 공유 postgres). 로컬 파일 DB(sqlite 등) 금지.
- 앱을 처음 올리면 온보딩이 **앱 전용 DB·계정을 자동 생성**하고, 접속정보를 내 앱 폴더의
  **`.db-credentials`** 파일로 남깁니다. 그 파일의 `DATABASE_URL`(사내망 LAN)을 노트북 로컬
  환경변수에 넣고 개발하면 **운영과 같은 DB** 를 씁니다(데이터 일치).
- `.db-credentials` 는 비밀 → **커밋 금지**. `data/`·`*.db`·`node_modules/`·`.git/` 는 업로드 제외.

## 공개 범위

- 처음엔 **나(owner) + 관리자만** 보임 (dev_live).
- 전 직원에게 공개하려면 관리자가 별도로 **internal_live 로 전환**한다.

## 기존 앱 수정

- 내 폴더의 코드를 고쳐 **같은 위치에 덮어쓰기** → 약 1분 내 자동 재빌드·반영.
- 폴더명(=앱 이름)은 바꾸지 말 것.
