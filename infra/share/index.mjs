import { parseMenuId, shareHtml } from './shareHtml.mjs'

/**
 * CloudFront `/share/*` 동작이 도달하는 Lambda.
 *
 *   CloudFront  →  API Gateway (HTTP API)  →  이 함수
 *
 * CloudFront Functions 로는 못 한다 — 네트워크 호출이 막혀 있어 메뉴 정보를 가져올 수 없다.
 *
 * 앞단이 Function URL 이 아니라 API Gateway 인 이유: 이 AWS 계정은 Function URL 호출이
 * 차단돼 있다(퍼블릭·OAC 모두 403. IAM 서명 직접 호출은 200 이라 코드 문제는 아니다).
 * 둘은 페이로드 형식이 v2.0 으로 같아서 이 핸들러는 그대로 쓴다 — `event.rawPath` 동일.
 *
 * 환경변수
 *   API_BASE  Supabase Edge Function 주소 (예: https://xxx.supabase.co/functions/v1/api)
 *   SITE_URL  배포된 앱 origin (예: https://d2n9xddk1fbwmp.cloudfront.net)
 */
const API_BASE = (process.env.API_BASE ?? '').replace(/\/+$/, '')
const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/+$/, '')

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // 크롤러가 반복해서 긁어도 매번 API 를 때리지 않도록 짧게 캐시한다.
  'Cache-Control': 'public, max-age=300',
}

/** 미리보기를 만들 수 없을 때는 홈으로 보낸다. 빈 페이지를 보여주는 것보다 낫다. */
function redirectHome() {
  return { statusCode: 302, headers: { Location: `${SITE_URL}/` }, body: '' }
}

export async function handler(event) {
  if (!API_BASE || !SITE_URL) {
    console.error('[share] API_BASE / SITE_URL 환경변수가 비어 있습니다.')
    return { statusCode: 500, headers: HTML_HEADERS, body: '<!doctype html><title>설정 오류</title>' }
  }

  const menuId = parseMenuId(event.rawPath ?? '')
  if (menuId === null) return redirectHome()

  try {
    const res = await fetch(`${API_BASE}/menus/${menuId}`)
    // 없는 메뉴(404)든 장애(5xx)든 미리보기를 만들 수 없는 건 같다.
    if (!res.ok) return redirectHome()

    const menu = await res.json()
    return { statusCode: 200, headers: HTML_HEADERS, body: shareHtml(menu, SITE_URL) }
  } catch (err) {
    // 공유 링크가 죽는 것보다 홈이라도 열리는 게 낫다.
    console.error('[share] 메뉴 조회 실패', menuId, err)
    return redirectHome()
  }
}
