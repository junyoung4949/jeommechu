# API 서버 (Supabase Edge Function)

`/api/*` 요청을 받는 서버입니다. 클라이언트와 별개로 동작하지만 **이 리포에 소스를 둡니다.**

## 왜 클라이언트 리포에 있나

원래는 Supabase 안에만 있었습니다. 즉 **git 어디에도 없었고**, 잘못 배포해도 되돌릴 방법이
없었습니다. 코드를 읽으려면 대시보드에 들어가야 했고요.

서버를 따로 뗄 만큼 크지 않으니, 배포 산출물을 함께 두는 `infra/` 관례(`share/` 의 Lambda,
`cloudfront/` 의 Function)를 그대로 따릅니다.

| 파일 | 역할 |
|---|---|
| `index.ts` | 라우터 + 공개 엔드포인트 |
| `admin.ts` | 관리자 전용 엔드포인트 |
| `http.ts` | 응답·쿠키·CORS·에러코드 헬퍼 |

## 관리자 엔드포인트

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/admin/menus` | 관리자 목록 (사진·등록자·카테고리·이형어·성적을 한 응답에) |
| `GET` | `/admin/stats` | 메뉴별 추천/채택/넘김 집계 |
| `PATCH` | `/menus/{id}` | 이름·카테고리·예산·인원·설명·사진 수정 |
| `DELETE` | `/menus/{id}` | 메뉴 삭제 |
| `POST` | `/menus/{id}/aliases` | 이형어 추가 |
| `DELETE` | `/menus/{id}/aliases/{alias}` | 이형어 해제 |
| `POST` `PATCH` `DELETE` | `/categories[/{id}]` | 카테고리 추가·이름변경·삭제 |

전부 `requireManager()` 를 통과해야 합니다 — 비로그인 `401`, 매니저 아님 `403`.

권한은 `profiles.is_manager` 로 켭니다:

```sql
update profiles set is_manager = true where user_no = 13;
```

### ⚠️ 문지기가 RLS 가 아니라 코드에 있습니다

DB 에는 이미 `is_manager()` 기반 RLS 정책이 깔려 있습니다(`menus` 수정·삭제,
`menu_aliases`·`categories`·`menu_categories`). **그런데 이 함수는 service role 키로 붙어
RLS 를 통째로 우회합니다.** 서버를 거치는 한 그 정책들은 잠들어 있습니다.

그래서 검사를 `admin.ts` 의 `requireManager()` 한 줄로 눈에 보이게 뒀습니다. RLS 는
그대로 둡니다 — 나중에 anon 키로 DB 에 직접 붙는 경로가 생기면 두 번째 자물쇠로 일합니다.

### ⚠️ 메뉴를 지우면 추천 기록이 함께 사라집니다

```
recommendations_menu_id_fkey  FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
```

김밥(추천 42건)을 지우면 그 42건이 같이 없어지고 **과거 통계가 소급해서 바뀝니다.**
되돌릴 수 없어서 `DELETE /menus/{id}` 는 본문에 `confirmCascade: true` 가 없으면
`CASCADE_NOT_CONFIRMED` 로 거절하고 몇 건이 사라지는지 알려줍니다.

이형어는 `menus` 와 외래키로 묶여 있지 않고 `canonical` 문자열로만 연결돼 있어서,
메뉴 삭제 시 코드가 직접 지웁니다. 안 지우면 어디에도 안 걸리는 이형어가 남아 나중에
그 이름으로 등록하려는 사람을 계속 막습니다.

> 기록을 지키려면 소프트 삭제(`menus.deleted_at`)로 바꿔야 합니다. 그러면 `recommend_menu`
> 를 비롯해 메뉴를 읽는 모든 곳에 제외 조건이 필요합니다.

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
