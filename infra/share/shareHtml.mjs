/**
 * 공유 링크 미리보기(OG) 페이지 생성기.
 *
 * 카카오톡·슬랙 같은 메신저의 크롤러는 **JS 를 실행하지 않는다.** SPA 는 index.html 하나뿐이라
 * 모든 메뉴가 같은 미리보기를 갖게 되므로, 메뉴마다 다른 카드를 보여주려면 서버가 HTML 을
 * 만들어 줘야 한다. 크롤러는 여기서 태그를 읽고, 사람은 곧바로 실제 화면으로 넘어간다.
 *
 * 의존성이 없는 순수 함수다 — Lambda 와 Vite 개발 서버가 같은 파일을 그대로 쓴다.
 * (개발과 배포가 다른 HTML 을 내보내면 로컬에서 검증한 의미가 없다.)
 */

/** 클라이언트의 BUDGET_BUCKETS 와 같은 문구. */
const BUDGET_LABELS = {
  UNDER_5000: '5천원 미만',
  W5000_10000: '5천원대',
  W10000_15000: '1만원대',
  W15000_20000: '1만5천원대',
  OVER_20000: '2만원 이상',
}

/**
 * 메뉴 이름과 설명은 **사용자가 입력한 값**이다. 그대로 끼워 넣으면 `"><script>` 같은 이름으로
 * 페이지 마크업을 깨뜨릴 수 있다. 속성값 안에서도 안전하도록 따옴표까지 바꾼다.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * @param {object} menu      GET /menus/{id} 응답
 * @param {string} siteUrl   배포된 앱의 origin (끝에 / 없이)
 */
export function shareHtml(menu, siteUrl) {
  const target = `${siteUrl}/menus/${menu.id}`
  const title = `오늘 점심은 ${menu.name} 어때요?`
  const description = [
    menu.description,
    BUDGET_LABELS[menu.budgetTier],
    `${menu.minPeople}~${menu.maxPeople}명`,
  ]
    .filter(Boolean)
    .join(' · ')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="점메추">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(menu.imageUrl)}">
<meta property="og:url" content="${escapeHtml(target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(menu.imageUrl)}">
<link rel="canonical" href="${escapeHtml(target)}">
</head>
<body>
<p><a href="${escapeHtml(target)}">${escapeHtml(menu.name)} 보러 가기</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body>
</html>`
}

/**
 * 경로에서 메뉴 id 를 뽑는다. `/share/17` → 17, 그 외 → null.
 * 숫자만 받는다 — `/share/../x` 같은 값이 그대로 API 경로에 붙지 않게 한다.
 */
export function parseMenuId(pathname) {
  const match = /^\/share\/(\d+)\/?$/.exec(pathname)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
