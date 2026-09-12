# 공유 링크 미리보기 (OG 태그)

카카오톡에 링크를 보냈을 때 **메뉴 사진·이름이 카드로 뜨게** 하는 부분입니다.

## 왜 서버가 필요한가

메신저 크롤러는 **JS 를 실행하지 않습니다.** 우리는 SPA 라 `index.html` 하나뿐이고,
그 안의 OG 태그는 모든 메뉴에 대해 동일합니다. 그래서 `/menus/17` 링크를 보내면
어떤 메뉴든 같은 미리보기가 뜹니다.

`/share/17` 은 **서버가 메뉴별 OG 태그를 박은 HTML** 을 돌려줍니다.
크롤러는 거기서 태그를 읽고, 사람은 곧바로 `/menus/17` 로 넘어갑니다.

## 왜 Supabase 가 아니라 여기인가

Supabase Edge Function 은 `*.supabase.co` 에서 **HTML 을 서빙할 수 없습니다.**
`Content-Type: text/html` 을 보내도 게이트웨이가 `text/plain` + `nosniff` 로 덮어씁니다
(피싱 방지). Pro 플랜 + 커스텀 도메인에서만 허용됩니다.

애초에 공유 링크는 앱 도메인이어야 자연스럽기도 합니다.

## 구성

| 파일 | 역할 |
|---|---|
| `shareHtml.mjs` | HTML 생성. 의존성 없는 순수 함수 |
| `index.mjs` | AWS Lambda 핸들러 (Function URL, payload v2.0) |
| `vitePlugin.mjs` | 개발 서버용. **같은 `shareHtml()`** 을 쓴다 |

개발과 배포가 같은 생성기를 쓰므로, 로컬에서 확인한 HTML 이 곧 배포 결과입니다.

## AWS 설정

### 1. Lambda 생성

- 런타임: Node.js 20 이상 (전역 `fetch` 필요)
- 핸들러: `index.handler`
- 업로드: `shareHtml.mjs` + `index.mjs`
- **Function URL 활성화** (인증 `NONE` — 공개 페이지입니다)

환경변수 두 개:

```
API_BASE = https://pwfevsslxkituyfktmqe.supabase.co/functions/v1/api
SITE_URL = https://<배포된 앱 도메인>
```

> `SITE_URL` 을 빠뜨리면 500 을 돌려줍니다. 잘못된 링크가 퍼지는 것보다 낫습니다.

### 2. CloudFront 동작(Behavior) 추가

기존 S3 오리진은 그대로 두고, Lambda Function URL 을 **오리진으로 추가**한 뒤:

| 항목 | 값 |
|---|---|
| 경로 패턴 | `/share/*` |
| 오리진 | Lambda Function URL |
| 뷰어 프로토콜 | Redirect HTTP to HTTPS |
| 허용 메서드 | GET, HEAD |
| 캐시 정책 | CachingOptimized (Lambda 가 `max-age=300` 을 줍니다) |

**우선순위를 기본 동작보다 위에 두세요.** 아래로 가면 S3 가 먼저 먹어 404 가 납니다.

### 3. SPA 라우팅 (기본 동작)

`/menus/17` 같은 클라이언트 라우트가 새로고침에도 열리려면 403/404 를 `/index.html`
(200)로 돌려주는 오류 응답 설정이 필요합니다. 이건 공유 기능과 무관하게 필요한 설정입니다.

## 확인

배포 후 [카카오 디버거](https://developers.kakao.com/tool/debugger/sharing)에
`https://<도메인>/share/1` 을 넣어 카드가 뜨는지 봅니다.
캐시가 남아 있으면 디버거에서 "초기화"를 누르세요.

로컬에서는 개발 서버가 같은 경로를 처리합니다:

```bash
curl http://localhost:5173/share/1
```

## 주의

메뉴 이름·설명은 **사용자 입력**이라 `escapeHtml()` 로 이스케이프합니다.
`shareHtml()` 을 고칠 때 값을 그대로 끼워 넣지 마세요 — `"><script>` 같은 이름으로
페이지가 깨집니다.
