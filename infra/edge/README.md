# API 서버 (Supabase Edge Function)

`/api/*` 요청을 받는 서버입니다. 클라이언트와 별개로 동작하지만 **이 리포에 소스를 둡니다.**

## 왜 클라이언트 리포에 있나

원래는 Supabase 안에만 있었습니다. 즉 **git 어디에도 없었고**, 잘못 배포해도 되돌릴 방법이
없었습니다. 코드를 읽으려면 대시보드에 들어가야 했고요.

서버를 따로 뗄 만큼 크지 않으니, 배포 산출물을 함께 두는 `infra/` 관례(`share/` 의 Lambda,
`cloudfront/` 의 Function)를 그대로 따릅니다.

| 파일 | 역할 |
|---|---|
| `index.ts` | 라우터 + 모든 엔드포인트 |
| `http.ts` | 응답·쿠키·CORS·에러코드 헬퍼 |

## 배포

```
Supabase 프로젝트  pwfevsslxkituyfktmqe
Function slug      api
공개 주소          https://pwfevsslxkituyfktmqe.supabase.co/functions/v1/api/*
```

`verify_jwt` 는 **false** 입니다. `categories` / `recommend` / `auth.*` 는 인증이 없거나
선택이라, 게이트웨이에 맡기지 않고 라우트별로 직접 검사합니다. **배포할 때 이 값을 켜면
비로그인 사용자가 전부 막힙니다.**

> ⚠️ 이 디렉터리를 고쳤으면 **Supabase 에 따로 올려야 합니다.** 프론트 워크플로
> (`.github/workflows/deploy.yml`)는 S3 만 건드립니다. 리포의 사본이 원본이므로
> 대시보드에서 직접 고치지 마세요 — 다음 배포 때 덮어써지고 변경 이력도 안 남습니다.

## 소셜 로그인 redirect_uri

OAuth 는 `redirect_uri` 를 **두 번** 씁니다. 인가 요청 때(브라우저), 그리고 인가 코드를
토큰으로 바꿀 때(서버). 공급자는 두 값이 **바이트 단위로 같을 것**을 요구합니다.

그런데 그 값을 정하는 건 브라우저의 origin 이라 서버가 미리 알 수 없습니다. 그래서
클라이언트가 본문에 `redirectUri` 를 실어 보내고, 서버는 **허용 목록으로 검증만** 합니다.

```
KAKAO_REDIRECT_URIS  = https://jeommechu.co.kr/oauth/kakao,http://localhost:5173/oauth/kakao
GOOGLE_REDIRECT_URIS = https://jeommechu.co.kr/oauth/google,http://localhost:5173/oauth/google
```

공급자 콘솔(카카오 개발자 / Google Cloud)에도 **같은 주소들이 등록돼 있어야** 합니다.
콘솔 등록은 ①만 통제하므로, 거기 있다고 해서 ②가 통과하는 게 아닙니다.

### ⚠️ 비교는 완전 일치여야 합니다

`startsWith` 로 바꾸면 `https://jeommechu.co.kr.evil.com/oauth/kakao` 가 통과합니다.
클라이언트가 보낸 값을 그대로 토큰 교환에 넣는 자리라 느슨하면 안 됩니다.

### ⚠️ 이름이 복수형인 건 값이 목록이라는 뜻입니다

한 번 이런 일이 있었습니다 — 단수형 `KAKAO_REDIRECT_URI` 에 쉼표로 두 주소를 넣었는데,
그때 코드는 값을 **통째로** 공급자에게 보냈습니다. 그래서 `redirect_uri` 가
`https://a.com/cb,http://b.com/cb` 가 되어 **프로덕션 로그인까지 멈췄습니다.**

지금은 `allowedRedirectUris()` 가 쉼표로 쪼갭니다. 반대로 주소를 **하나만** 넣으면
나머지 환경의 로그인이 조용히 막히니, 환경을 늘릴 때마다 이 값도 같이 늘려야 합니다.

> 단수형(`*_REDIRECT_URI`)은 더 이상 읽지 않습니다. 대시보드에 남아 있어도 무시됩니다.

### ⚠️ 교환 실패 사유를 버리지 마세요

예전에는 이랬습니다:

```ts
if (!res.ok) return null;   // 공급자가 보낸 실패 사유를 여기서 버림
```

그리고 원인이 무엇이든 `INVALID_AUTH_CODE`("인가 코드가 유효하지 않습니다") 하나로
응답했습니다. 실제 원인이 `redirect_uri` 불일치였는데 **코드를 의심하게 만드는 문구**라
진단이 한참 늦어졌습니다.

지금은 실패 본문을 `console.error` 로 남기고, 허용 목록에서 걸린 경우는
`REDIRECT_URI_NOT_ALLOWED` 로 따로 구분합니다.

## 확인

```bash
B=https://pwfevsslxkituyfktmqe.supabase.co/functions/v1/api
curl -s -o /dev/null -w "%{http_code}\n" "$B/categories"   # 200
curl -s -o /dev/null -w "%{http_code}\n" "$B/menus/99999"  # 404

# 허용 목록이 살아 있는지 (REDIRECT_URI_NOT_ALLOWED 가 나와야 한다)
curl -s -X POST "$B/auth/kakao" -H 'content-type: application/json' \
  -d '{"code":"dummy","redirectUri":"https://jeommechu.co.kr.evil.com/oauth/kakao"}'
```

로그는 Supabase 대시보드 > Edge Functions > api > Logs 에서 봅니다.
`[api]` 접두사가 붙은 항목이 우리가 남긴 것입니다.
