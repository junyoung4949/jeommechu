import { parseMenuId, shareHtml } from './shareHtml.mjs'

/**
 * CloudFront `/share/*` 동작이 가리키는 Lambda (Function URL, payload v2.0).
 *
 * CloudFront Functions 로는 못 한다 — 네트워크 호출이 막혀 있어 메뉴 정보를 가져올 수 없다.
 * Lambda@Edge 도 가능하지만 us-east-1 고정에 버전 복제까지 필요해서, 평범한 리전 Lambda 를
 * Function URL 로 열고 CloudFront 오리진으로 붙이는 쪽이 배포·수정이 훨씬 간단하다.
 *
 * 환경변수
 *   API_BASE  Supabase Edge Function 주소 (예: https://xxx.supabase.co/functions/v1/api)
 *   SITE_URL  배포된 앱 origin (예: https://jeommechu.example.com)
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
