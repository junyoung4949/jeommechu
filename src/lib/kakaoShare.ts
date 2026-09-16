/**
 * 카카오톡 공유 (JavaScript SDK).
 *
 * ## 왜 sendScrap 이 아니라 sendDefault 인가
 *
 * `sendScrap` 은 URL 만 넘기면 카카오가 그 페이지를 긁어 OG 태그로 카드를 만든다. 편해 보이지만
 * 카드 내용이 **크롤러가 언제 다녀갔는지**에 달린다. 카카오는 스크랩 결과를 캐시하므로,
 * 메뉴 사진이 바뀌어도 한동안 옛 카드가 나간다.
 *
 * 우리는 추천 결과로 메뉴 데이터를 이미 손에 들고 있다. 직접 조립하면 그런 의존이 사라진다.
 *
 * `/share/{id}` 의 OG 태그는 그대로 둔다 — 카카오 카드에서 링크를 복사해 슬랙·문자로 옮겼을 때
 * 여전히 그쪽이 쓰인다. 두 경로는 경쟁이 아니라 각자의 담당이 있다.
 */

import { budgetLabel, type Menu } from '../api/recommend'

/**
 * 버전과 integrity 는 짝이다. 버전만 올리면 브라우저가 스크립트를 **조용히 거부**한다
 * (콘솔에만 뜨고 onerror 도 늦게 온다). 반드시 같이 바꾼다.
 * 값 출처: https://developers.kakao.com/docs/ko/javascript/download
 */
const SDK_VERSION = '2.8.3'
const SDK_INTEGRITY = 'sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy'
const SDK_SRC = `https://t1.kakaocdn.net/kakao_js_sdk/${SDK_VERSION}/kakao.min.js`

interface KakaoLink {
  mobileWebUrl: string
  webUrl: string
}

/** 실제로 쓰는 것만 선언한다. SDK 전체 타입을 흉내 내면 버전이 오를 때마다 거짓말이 된다. */
interface KakaoSdk {
  init(javascriptKey: string): void
  isInitialized(): boolean
  Share: {
    sendDefault(settings: {
      objectType: 'feed'
      content: {
        title: string
        description: string
        imageUrl: string
        link: KakaoLink
      }
      buttons?: { title: string; link: KakaoLink }[]
    }): void
  }
}

declare global {
  interface Window {
    Kakao?: KakaoSdk
  }
}

/**
 * 진행 중인 로드를 붙잡아 둔다. 공유 버튼을 연타해도 `<script>` 가 하나만 들어간다.
 * 실패했을 때는 비워서 다음 클릭이 다시 시도할 수 있게 한다 — 실패한 약속을 캐시하면
 * 일시적인 네트워크 오류 한 번에 공유 기능이 세션 내내 죽는다.
 */
let loading: Promise<KakaoSdk> | null = null

function loadSdk(): Promise<KakaoSdk> {
  if (window.Kakao) return Promise.resolve(window.Kakao)
  if (loading) return loading

  loading = new Promise<KakaoSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.integrity = SDK_INTEGRITY
    script.crossOrigin = 'anonymous'
    script.async = true

    script.onload = () => {
      if (window.Kakao) resolve(window.Kakao)
      else reject(new Error('카카오 SDK 를 불러왔지만 window.Kakao 가 없습니다'))
    }
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error('카카오 SDK 를 불러오지 못했습니다'))
    }

    document.head.appendChild(script)
  })

  return loading
}

/**
 * 로그인에 쓰는 `VITE_KAKAO_CLIENT_ID`(REST API 키)와 **다른 키**다.
 * 카카오 앱 관리 > 앱 키 > JavaScript 키.
 */
function javascriptKey(): string {
  return (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) ?? ''
}

async function ready(): Promise<KakaoSdk> {
  const key = javascriptKey()
  if (!key) throw new Error('VITE_KAKAO_JS_KEY 가 설정되지 않았습니다')

  const kakao = await loadSdk()
  // init 을 두 번 부르면 SDK 가 예외를 던진다.
  if (!kakao.isInitialized()) kakao.init(key)
  return kakao
}

/** 공유용 정식 주소. 크롤러용 OG 페이지를 거쳐 `/menus/{id}` 로 넘어간다. */
export function menuShareUrl(menu: Menu): string {
  return `${window.location.origin}/share/${menu.id}`
}

function peopleLabel(menu: Menu): string {
  return menu.minPeople === menu.maxPeople
    ? `${menu.minPeople}명`
    : `${menu.minPeople}~${menu.maxPeople}명`
}

/** 카카오는 절대 URL 만 받는다. 상대 경로가 섞여 들어오면 이미지 없는 카드가 나간다. */
function absoluteImageUrl(imageUrl: string): string {
  return /^https?:\/\//.test(imageUrl) ? imageUrl : new URL(imageUrl, window.location.origin).href
}

/**
 * 카카오톡 공유창을 연다.
 *
 * 실패(키 미설정·SDK 로드 실패·도메인 미등록)는 그대로 던진다. 호출부가 링크 복사로
 * 안내할 수 있어야 하므로 여기서 삼키지 않는다.
 */
export async function shareMenuToKakao(menu: Menu): Promise<void> {
  const kakao = await ready()

  const url = menuShareUrl(menu)
  const link: KakaoLink = { mobileWebUrl: url, webUrl: url }
  const home = `${window.location.origin}/`

  const description = [
    budgetLabel(menu.budgetTier),
    peopleLabel(menu),
    menu.categories.map((c) => c.name).join(', '),
  ]
    .filter(Boolean)
    .join(' · ')

  kakao.Share.sendDefault({
    objectType: 'feed',
    content: {
      title: `오늘 점심은 ${menu.name} 어때요?`,
      description,
      imageUrl: absoluteImageUrl(menu.imageUrl),
      link,
    },
    buttons: [
      { title: '메뉴 보기', link },
      { title: '나도 추천받기', link: { mobileWebUrl: home, webUrl: home } },
    ],
  })
}
