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
| `admin.ts` | 관리자 엔드포인트 + 메뉴 수정·삭제 |
| `me.ts` | 마이페이지 — 내 계정과 내가 등록한 메뉴 |
| `http.ts` | 응답·쿠키·CORS·에러코드 헬퍼 |

## 관리자 엔드포인트

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/admin/menus` | 관리자 목록 (사진·등록자·카테고리·이형어·성적을 한 응답에) |
| `GET` | `/admin/stats` | 기간별 집계 — 메뉴별 성적 · 일별 추이 · 신규 가입자 활동 |
| `PATCH` | `/menus/{id}` | 이름·카테고리·예산·인원·설명·사진 수정 |
| `DELETE` | `/menus/{id}` | 메뉴 삭제 |
| `POST` | `/menus/{id}/aliases` | 이형어 추가 |
| `DELETE` | `/menus/{id}/aliases/{alias}` | 이형어 해제 |
| `POST` `PATCH` `DELETE` | `/categories[/{id}]` | 카테고리 추가·이름변경·삭제 |

카테고리·이형어·`/admin/*` 는 `requireManager()` 를 통과해야 합니다 — 비로그인 `401`,
매니저 아님 `403`. **`PATCH`·`DELETE /menus/{id}` 만 예외로 등록자 본인에게도 열려 있습니다**
(`requireOwner()`). 자기가 올린 메뉴를 고치는 데 관리자를 거칠 이유가 없기 때문입니다.
등록자가 탈퇴해 `created_by` 가 `null` 이 된 메뉴는 주인이 없으므로 매니저만 건드릴 수 있습니다.

## 마이페이지 엔드포인트 (`me.ts`)

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/auth/me/menus` | 내가 등록한 메뉴 + 성적 + 순위 |
| `PATCH` | `/auth/me` | 닉네임 변경 (2~12자, 중복은 `NICKNAME_TAKEN` 409) |
| `DELETE` | `/auth/me` | 탈퇴 |

### `GET /auth/me/menus`

```json
{ "minResponses": 5,
  "avgChosenRate": 0.2206,
  "menus": [ { "id": 12, "name": "김밥", "imageUrl": "...", "categories": [...],
               "budgetTier": "UNDER_5000", "minPeople": 1, "maxPeople": 2,
               "description": null, "createdAt": "...",
               "stats": { "recommended": 43, "chosen": 4, "skipped": 5, "noResponse": 34 },
               "rank": { "position": 1, "total": 6 },
               "lastRecommendedAt": "..." } ] }
```

**순위는 추천 수가 아니라 응답 수로 자릅니다.** 추천을 10번 받았어도 아무도 버튼을 안
눌렀다면 그 메뉴에 대해 아는 게 없습니다 — 실제로 추천 10회에 응답 2회인 메뉴가 있습니다.
`minResponses`(현재 5) 미만이면 `rank` 가 `null` 이고 화면은 "집계 중"으로 표시합니다.
분모도 기준을 넘긴 메뉴만 셉니다(`total`). 기록이 쌓이면 이 상수만 올리면 되고,
클라이언트는 응답에 실려 오는 값을 그대로 쓰므로 함께 배포할 필요가 없습니다.

채택률은 `chosen / (chosen + skipped)` 입니다. 무응답이 전체 기록의 3/4 라 분모에 넣으면
모든 메뉴가 10% 아래로 깔려 순서가 잡히지 않습니다(관리자 화면의 '응답 중 채택률'과 같은 정의).
동점은 같은 등수로 묶습니다.

### ⚠️ 탈퇴하면 그 사람의 추천 기록도 사라집니다

```
recommendations_user_id_fkey  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
menus_created_by_fkey         FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
```

등록한 **메뉴는 남고** 등록자 표시만 끊깁니다. 하지만 그 사람이 **받았던 추천 기록은
함께 지워지므로** 메뉴들의 성적이 소급해서 줄어듭니다. 되돌릴 수 없어 화면에서 닉네임을
다시 입력받아 확인한 뒤 호출합니다.

> 기록을 익명으로 남기려면 `recommendations.user_id` 를 `ON DELETE SET NULL` 로 바꿔야
> 합니다. 그러면 비로그인 기록(`user_id is null`)과 구분되지 않는 점을 함께 고려해야 합니다.

### `GET /admin/stats?from=&to=`

`from`·`to` 는 `YYYY-MM-DD` 이고 **양 끝을 포함**합니다. 둘 다 생략할 수 있으며, 생략하면
그쪽 방향으로 제한이 없습니다(= 전체 기간). 집계는 `admin_stats_range` 함수가 합니다.

**경계는 KST 로 자릅니다.** UTC 로 자르면 한국 시간 오전 9시 이전의 활동이 전날로 밀려,
관리자가 화면에서 고른 날짜와 숫자가 어긋납니다. 하루 단위 버킷도 같은 기준입니다.

```json
{ "range": {...},
  "total":   { "recommended": 224, "chosen": 15, "skipped": 47, "noResponse": 162,
               "loggedIn": 189, "anonymous": 35 },
  "perMenu": [...],
  "daily":   [ { "day": "2026-09-10", ...counts, "loggedIn": 110, "anonymous": 0, "signups": 0 } ],
  "hourly":  [ { "hour": 0, ...counts } ],   // 0~23시(KST), 빈 시간도 0으로 24칸 전부
  "weekday": [ { "dow": 1, ...counts } ],    // 1=월 … 7=일 (isodow), 7칸 전부
  "users":   { "signups": 1, "totalUsers": 3, "activated": 0, "returning": 0,
               "avgActiveDays": 0, "rows": [...] } }
```

**`loggedIn + anonymous === recommended` 가 항상 성립합니다.** 비로그인을 `uid is not null` 이
아니라 **`user_id is null`** 로 세기 때문입니다. 두 컬럼이 다 채워진 행이 생겨도 합이 어긋나지
않아, 화면에서 막대 하나로 쌓아도 됩니다.

`users` 는 **그 기간에 가입한 사람들**과 그들의 활동입니다. 활동은 `created_at >= 가입일`
조건으로 셉니다 — 로그인 시 `claim_anonymous_history` 가 비로그인 이력을 계정으로 옮기기
때문에, 조건이 없으면 가입 전 활동까지 신규 회원의 성적으로 잡혀 활성도가 부풀려집니다.

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
