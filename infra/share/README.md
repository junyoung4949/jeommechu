# 공유 링크 미리보기 (OG 태그)

카카오톡에 링크를 보냈을 때 **메뉴 사진·이름이 카드로 뜨게** 하는 부분입니다.

> **공유 경로가 둘입니다.** 앱의 공유 버튼은 카카오 JS SDK 로 카드를 **직접 조립**하므로
> OG 태그를 쓰지 않습니다(`src/lib/kakaoShare.ts`). 여기 문서의 `/share/{id}` 는 그 밖의
> 모든 경우 — 링크를 복사해 슬랙·문자로 옮겼을 때 — 를 담당합니다. 둘은 경쟁이 아니라
> 각자의 담당이 있습니다. SDK 쪽 콘솔 설정은 [아래](#카카오-개발자-콘솔--도메인-등록처가-두-군데입니다)를 보세요.

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

CloudFront Function 소스는 `../cloudfront/` 에 있습니다. 이 파일들은 **빌드에 포함되지
않고** AWS 에 따로 올라갑니다. 리포의 사본이 원본이므로, 콘솔에서 직접 고치지 마세요 —
다음 배포 때 덮어써지고 변경 이력도 남지 않습니다.

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
| 도메인 | `jeommechu.co.kr` (가비아 등록, 네임서버는 Route53) |
| Route53 호스팅 영역 | `Z029092732WN8GJ05JJ75` |
| ACM 인증서 | `us-east-1` / `64aa0db9-3278-44e8-8523-d2b2e733b529` — `jeommechu.co.kr` + `*.jeommechu.co.kr` |
| CloudFront 배포 | `E2SSO86KP6P9W8` — `d2n9xddk1fbwmp.cloudfront.net` (Alias: `jeommechu.co.kr`, `www.jeommechu.co.kr`) |
| S3 버킷 (SPA) | `jeommechu` (OAC `E31Z06UFU1TCKR`) |
| Lambda | `jeommechu-share` (nodejs22.x, ap-northeast-2) |
| API Gateway | `vets1dkswc` — `vets1dkswc.execute-api.ap-northeast-2.amazonaws.com` |
| CloudFront Function | `jeommechu-api-rewrite`, `jeommechu-spa-routing` |

Lambda 환경변수:

```
API_BASE = https://pwfevsslxkituyfktmqe.supabase.co/functions/v1/api
SITE_URL = https://jeommechu.co.kr
```

> `SITE_URL` 이 비면 500 을 돌려줍니다. 잘못된 링크가 퍼지는 것보다 낫습니다.

### ⚠️ 도메인을 바꾸면 `SITE_URL` 도 바꿔야 합니다

이 값이 OG 태그의 `og:url` 과 사람용 리다이렉트 주소가 됩니다. 안 바꾸면 **공유 링크만
옛 도메인으로 계속 퍼집니다.** 사이트는 멀쩡해 보이니 눈치채기 어렵습니다.

## 도메인 (jeommechu.co.kr)

가비아에서 산 도메인이지만 **네임서버는 Route53 으로 넘겼습니다.**

`jeommechu.co.kr` 같은 apex 도메인은 DNS 표준상 `CNAME` 을 쓸 수 없고, CloudFront 는
EC2 와 달리 **고정 IP 가 없어 `A` 레코드에 IP 를 박을 수도 없습니다.** Route53 의
Alias 레코드만 이 둘을 동시에 만족합니다(가비아 기본 DNS 로는 불가능).

| 레코드 | 값 |
|---|---|
| `jeommechu.co.kr` A·AAAA | Alias → CloudFront 배포 |
| `www.jeommechu.co.kr` A·AAAA | Alias → CloudFront 배포 |
| `_5cfa...jeommechu.co.kr` CNAME | ACM DNS 검증용 — **지우지 마세요** |

마지막 레코드를 지우면 인증서 **자동 갱신이 실패합니다.** 만료될 때까지는 아무 일도
안 일어나서, 문제가 몇 달 뒤에 드러납니다.

### ⚠️ `www` 는 apex 로 301 리다이렉트합니다 — 소셜 로그인 때문입니다

`jeommechu-spa-routing` 함수가 `www.jeommechu.co.kr` 요청을 `jeommechu.co.kr` 로 보냅니다.
SEO 때문만이 아니라 **로그인이 실제로 깨지기 때문**입니다.

클라이언트는 `redirect_uri` 를 `window.location.origin` 으로 만드는데
(`src/components/LoginModal/LoginModal.tsx`), 서버(Supabase Edge Function `api`)는
`KAKAO_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` 환경변수 **하나**로 토큰을 교환합니다.
값이 하나뿐이라 apex 와 www 를 동시에 만족시킬 수 없습니다. www 로 로그인하면

```
인가 요청:  redirect_uri = https://www.jeommechu.co.kr/oauth/kakao
토큰 교환:  redirect_uri = $KAKAO_REDIRECT_URI          ← 불일치
```

가 되어 공급자가 교환을 거절하고, 서버는 이를 `INVALID_AUTH_CODE` 400 으로 돌려줍니다.
**에러 메시지가 "인가 코드가 유효하지 않다" 라서 도메인 문제로 보이지 않습니다.**

리다이렉트는 기본 동작에만 걸려 있습니다. `/api/*` 는 일부러 건드리지 않습니다 —
POST 를 301 하면 메서드가 바뀔 수 있고, 어차피 진입 시점에 apex 로 넘어가므로
API 요청도 apex 에서 납니다.

> 같은 이유로 **로컬(`localhost:5173`)에서는 소셜 로그인이 안 됩니다.** 환경변수가
> 배포 도메인 하나를 가리키기 때문입니다. 풀려면 클라이언트가 `redirect_uri` 를 보내고
> 서버가 화이트리스트로 검증하는 구조로 바꿔야 합니다.

### ⚠️ ACM 인증서는 `us-east-1` 이어야 합니다

CloudFront 는 버지니아 북부 리전의 인증서만 봅니다. 서울(`ap-northeast-2`)에 만들면
발급은 되지만 CloudFront 인증서 목록에 **아예 뜨지 않습니다.**

## 카카오 개발자 콘솔 — 도메인 등록처가 두 군데입니다

카카오톡 공유(`src/lib/kakaoShare.ts`)를 쓰려면 콘솔에 도메인을 등록해야 하는데,
**등록하는 곳이 두 군데이고 서로 다른 것을 통제합니다.** 이름이 비슷해서 한쪽만 하고
다 했다고 생각하기 쉽습니다.

| 콘솔 메뉴 | 통제하는 것 | 여기가 비면 |
|---|---|---|
| 앱 키 > JavaScript 키 > **JavaScript SDK 도메인** | 이 origin 에서 SDK 를 **실행**해도 되는가 | 공유창 자체가 안 열림 |
| **제품 링크 관리 > 웹 도메인** | 메시지 **안에 들어가는 링크**가 유효한가 | 카드는 멀쩡히 가는데 링크가 죽음 |

### ⚠️ 두 번째가 비었을 때의 증상이 고약합니다

SDK 실행은 첫 번째 관문만 통과하면 되므로 **공유창도 열리고, 카드도 정상적으로
전송됩니다.** 사진·제목·설명까지 다 맞게 나옵니다. 그런데:

- 버튼이 **하나도 안 보입니다.** 직접 넣은 버튼은 물론, 아무것도 지정하지 않았을 때
  자동으로 붙는 기본 "자세히 보기" 버튼까지 사라집니다
- 카드 본문을 눌러도 아무 데도 가지 않습니다

어디에도 오류가 뜨지 않아서, 코드나 템플릿 구조를 의심하게 됩니다. 실제로는 콘솔
설정 문제입니다.

카카오 답변 원문: *"외부 링크는 제품 링크 관리에 등록된 도메인만 허용되며, 등록되지
않은 도메인이 포함된 링크는 **기본 값으로 대체** 됩니다."*
([devtalk](https://devtalk.kakao.com/t/kakao-share-senddefault-weburl-mobileweburl-link/149598))

### ⚠️ 카카오는 `www` 와 apex 를 **다른 도메인**으로 봅니다

실제로 이것 때문에 한 번 막혔습니다. 콘솔에는 `www.jeommechu.co.kr` 만 등록돼
있었는데, 앱은 apex 에서 돌기 때문에(`www` 로 들어와도 301 로 튕김) 링크는 이렇게
만들어집니다:

```
https://jeommechu.co.kr/share/16     ← apex. 등록 안 됨
```

그래서 카카오가 **URL 전체를 기본 웹 도메인 루트로 갈아끼웠고**, 버튼을 누르면
`https://www.jeommechu.co.kr` 로 갔습니다. 경로(`/share/16`)가 날아간 게 아니라
주소가 통째로 바뀐 것입니다.

> 착지한 주소가 곧 **기본 웹 도메인**입니다. 대체가 일어났는지, 기본값이 무엇으로
> 잡혀 있는지를 한 번에 알려주는 단서라 기억해 둘 만합니다.

**`jeommechu.co.kr` 과 `www.jeommechu.co.kr` 을 둘 다 등록하고, 기본 웹 도메인을
apex 로 지정하세요.** 둘 다 등록하는 게 맞는 이유는 안전빵이어서가 아니라 **두
도메인 모두 실제로 콘텐츠를 서빙하기 때문**입니다 — `/share/*` 는 별도 동작이라
`www` → apex 301 이 걸리지 않습니다(아래 "CloudFront 동작" 참고).

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.jeommechu.co.kr/
# 301 → https://jeommechu.co.kr/      (기본 동작: 함수가 붙어 있음)
curl -s -o /dev/null -w "%{http_code}\n" https://www.jeommechu.co.kr/share/16
# 200                                  (별도 동작: 함수 없음)
```

### 등록할 때

- **경로는 못 넣습니다.** 도메인만 등록되고 경로는 잘립니다. 정상입니다 — 도메인을
  등록하면 그 아래 경로(`/share/16` 등)는 전부 허용됩니다
- **이미 보낸 카드는 안 고쳐집니다.** 링크는 전송 시점에 박히므로, 설정을 고친 뒤
  **새로 공유해서** 확인해야 합니다

## CloudFront 동작(Behavior)

| 순서 | 경로 | 오리진 | 함수 | 캐시 정책 |
|---|---|---|---|---|
| 1 | `/api/*` | Supabase | `jeommechu-api-rewrite` (viewer-request) | CachingDisabled |
| 2 | `/share/*` | API Gateway | — | CachingOptimized |
| 기본 | `*` | S3 | `jeommechu-spa-routing` (viewer-request) — www→apex 301 + SPA 라우팅 | CachingOptimized |

동작 하나에는 viewer-request 함수를 **하나만** 붙일 수 있습니다. 그래서 www 리다이렉트를
별도 함수로 만들지 않고 `jeommechu-spa-routing` 안에 합쳤습니다.

`/api/*` 는 **AllViewerExceptHostHeader** 오리진 요청 정책을 씁니다. 쿠키·헤더·쿼리스트링을
그대로 넘겨야 로그인이 동작합니다.

### ⚠️ CustomErrorResponses 를 쓰지 않습니다

SPA 라우팅을 `403/404 → /index.html` 커스텀 오류 응답으로 처리하면 **배포 전체에 적용되어
`/api/*` 의 진짜 404 까지 index.html 로 바뀝니다.** 클라이언트가 `NOT_FOUND` 를 구분하지
못하게 됩니다(실제로 한 번 그렇게 깨졌습니다).

그래서 기본 동작에만 `jeommechu-spa-routing` 함수를 붙여 **확장자 없는 경로만**
`/index.html` 로 재작성합니다. `/api/*` 와 `/share/*` 는 각자의 동작이라 영향이 없습니다.

## 재배포

**프론트는 자동입니다.** `master` 에 올라가면 `.github/workflows/deploy.yml` 이 빌드 →
S3 업로드 → 캐시 무효화까지 합니다. AWS 자격증명은 OIDC 로 그때그때 발급받으므로
액세스 키는 어디에도 저장돼 있지 않습니다(역할: `jeommechu-github-deploy`).

### ⚠️ OIDC 신뢰정책의 `sub` 는 문서에 나오는 형식이 아닙니다

GitHub 이 실제로 내려보내는 `sub` 클레임에는 **소유자·리포지토리의 숫자 ID 가 박혀 있습니다.**

```
repo:junyoung4949@131241164/jeommechu@1358390721:ref:refs/heads/master
```

AWS·GitHub 문서 예제의 `repo:<owner>/<repo>:ref:refs/heads/<branch>` 로 신뢰정책을 쓰면
`Not authorized to perform sts:AssumeRoleWithWebIdentity` 로 거절당합니다. **오류 메시지가
권한 문제처럼 보여서** 정책 내용이 아니라 IAM 권한을 의심하게 됩니다.

신뢰정책에는 두 형식을 모두 넣어 뒀습니다. GitHub 이 형식을 되돌려도 배포가 멈추지 않습니다.

막히면 추측하지 말고 CloudTrail 에서 실제 값을 읽으세요:

```bash
aws cloudtrail lookup-events --region ap-northeast-2 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 1 --query 'Events[].CloudTrailEvent' --output text
```

`userIdentity.principalId` 끝부분이 곧 `sub` 입니다.

아래는 **인프라 수정 시의 수동 절차**입니다. 이쪽은 자동화하지 않았습니다 — 거의 안 바뀌는
데다 잘못 배포하면 사이트 전체가 죽습니다.

```bash
# 프론트를 손으로 올려야 할 때 (워크플로가 막혔을 때만)
npm run build
aws s3 sync dist/ s3://jeommechu/ --exclude "images/*"
aws cloudfront create-invalidation --distribution-id E2SSO86KP6P9W8 --paths "/*"

# Lambda (infra/share 수정 시)
cd infra/share && zip -j /tmp/share.zip index.mjs shareHtml.mjs
aws lambda update-function-code --function-name jeommechu-share --zip-file fileb:///tmp/share.zip

# CloudFront Function (infra/cloudfront 수정 시)
F=jeommechu-spa-routing   # 또는 jeommechu-api-rewrite
E=$(aws cloudfront describe-function --name $F --stage DEVELOPMENT --query ETag --output text)
aws cloudfront update-function --name $F --if-match "$E" \
  --function-config '{"Comment":"","Runtime":"cloudfront-js-2.0"}' \
  --function-code fileb://infra/cloudfront/spa-routing.js
# 배포 전에 반드시 테스트한다 (아래 "확인" 참고)
E=$(aws cloudfront describe-function --name $F --stage DEVELOPMENT --query ETag --output text)
aws cloudfront publish-function --name $F --if-match "$E"
```

`publish-function` 이 끝나면 연결된 배포에 자동 전파됩니다(1~2분). 무효화는 필요 없습니다 —
viewer-request 함수는 캐시보다 앞에서 돕니다.

> `aws s3 sync` 에 `--delete` 를 붙이지 마세요. 버킷의 `images/` 는 별개 자산입니다.

> ⚠️ **ETag 는 매 수정마다 바뀝니다.** `update-function` 뒤에 다시 조회해야
> `publish-function` 이 통과합니다. 위 순서를 지키세요.

## 확인

```bash
S=https://jeommechu.co.kr
curl -s "$S/share/1" | grep -E "og:(title|image|url)"   # OG 태그
curl -s -o /dev/null -w "%{http_code}\n" "$S/share/99999"  # 302 (홈으로)
curl -s -o /dev/null -w "%{http_code}\n" "$S/api/menus/99999"  # 404 여야 함
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.jeommechu.co.kr/  # 301 → apex
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
