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
| `index.mjs` | Lambda 핸들러 (페이로드 형식 v2.0) |
| `vitePlugin.mjs` | 개발 서버용. **같은 `shareHtml()`** 을 쓴다 |

개발과 배포가 같은 생성기를 쓰므로, 로컬에서 확인한 HTML 이 곧 배포 결과입니다.

```
CloudFront  /share/*  →  API Gateway (HTTP API)  →  Lambda  →  GET /menus/{id}
```

### ⚠️ Function URL 이 아니라 API Gateway 인 이유

원래는 Lambda Function URL 을 CloudFront 오리진으로 붙이려 했으나, **이 AWS 계정에서는
Function URL 호출이 차단됩니다.** 퍼블릭(`AuthType=NONE`)도, CloudFront OAC(`AWS_IAM`)도
모두 403 이었습니다. 조직 SCP 제약으로 보입니다.

진단 근거: IAM 자격으로 **직접 서명 호출하면 200** 이 나왔습니다 — Lambda 코드와 URL 계층은
정상이고 인가 단계에서만 막힌다는 뜻입니다.

API Gateway HTTP API 는 Function URL 과 **페이로드 형식이 같아서(v2.0)** 핸들러 코드를
고치지 않고 그대로 씁니다. `event.rawPath` 를 읽는 부분이 동일하게 동작합니다.

## 현재 배포된 리소스

| 리소스 | 값 |
|---|---|
| CloudFront 배포 | `E2SSO86KP6P9W8` — `d2n9xddk1fbwmp.cloudfront.net` |
| S3 버킷 (SPA) | `jeommechu` (OAC `E31Z06UFU1TCKR`) |
| Lambda | `jeommechu-share` (nodejs22.x, ap-northeast-2) |
| API Gateway | `vets1dkswc` — `vets1dkswc.execute-api.ap-northeast-2.amazonaws.com` |
| CloudFront Function | `jeommechu-api-rewrite`, `jeommechu-spa-routing` |

Lambda 환경변수:

```
API_BASE = https://pwfevsslxkituyfktmqe.supabase.co/functions/v1/api
SITE_URL = https://d2n9xddk1fbwmp.cloudfront.net
```

> `SITE_URL` 이 비면 500 을 돌려줍니다. 잘못된 링크가 퍼지는 것보다 낫습니다.

## CloudFront 동작(Behavior)

| 순서 | 경로 | 오리진 | 함수 | 캐시 정책 |
|---|---|---|---|---|
| 1 | `/api/*` | Supabase | `jeommechu-api-rewrite` (viewer-request) | CachingDisabled |
| 2 | `/share/*` | API Gateway | — | CachingOptimized |
| 기본 | `*` | S3 | `jeommechu-spa-routing` (viewer-request) | CachingOptimized |

`/api/*` 는 **AllViewerExceptHostHeader** 오리진 요청 정책을 씁니다. 쿠키·헤더·쿼리스트링을
그대로 넘겨야 로그인이 동작합니다.

### ⚠️ CustomErrorResponses 를 쓰지 않습니다

SPA 라우팅을 `403/404 → /index.html` 커스텀 오류 응답으로 처리하면 **배포 전체에 적용되어
`/api/*` 의 진짜 404 까지 index.html 로 바뀝니다.** 클라이언트가 `NOT_FOUND` 를 구분하지
못하게 됩니다(실제로 한 번 그렇게 깨졌습니다).

그래서 기본 동작에만 `jeommechu-spa-routing` 함수를 붙여 **확장자 없는 경로만**
`/index.html` 로 재작성합니다. `/api/*` 와 `/share/*` 는 각자의 동작이라 영향이 없습니다.

## 재배포

```bash
# 프론트
npm run build
aws s3 sync dist/ s3://jeommechu/ --exclude "images/*"
aws cloudfront create-invalidation --distribution-id E2SSO86KP6P9W8 --paths "/*"

# Lambda (infra/share 수정 시)
cd infra/share && zip -j /tmp/share.zip index.mjs shareHtml.mjs
aws lambda update-function-code --function-name jeommechu-share --zip-file fileb:///tmp/share.zip
```

> `aws s3 sync` 에 `--delete` 를 붙이지 마세요. 버킷의 `images/` 는 별개 자산입니다.

## 확인

```bash
S=https://d2n9xddk1fbwmp.cloudfront.net
curl -s "$S/share/1" | grep -E "og:(title|image|url)"   # OG 태그
curl -s -o /dev/null -w "%{http_code}\n" "$S/share/99999"  # 302 (홈으로)
curl -s -o /dev/null -w "%{http_code}\n" "$S/api/menus/99999"  # 404 여야 함
```

카카오 카드는 [카카오 디버거](https://developers.kakao.com/tool/debugger/sharing)에
`$S/share/1` 을 넣어 확인합니다. 캐시가 남아 있으면 "초기화"를 누르세요.

로컬에서는 개발 서버가 같은 경로를 처리합니다:

```bash
curl http://localhost:5173/share/1
```

## 주의

메뉴 이름·설명은 **사용자 입력**이라 `escapeHtml()` 로 이스케이프합니다.
`shareHtml()` 을 고칠 때 값을 그대로 끼워 넣지 마세요 — `"><script>` 같은 이름으로
페이지가 깨집니다.
