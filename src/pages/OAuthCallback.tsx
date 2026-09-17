import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { kakaoLogin, googleLogin } from '../api/auth'
import { oauthRedirectUri } from '../lib/oauth'

interface Props {
  provider: 'kakao' | 'google'
  onSuccess: (token: string) => void
  /**
   * 실패를 호출부에 알린다. 호출부는 홈으로 돌아온 뒤 로그인 모달을 다시 열어 문구를 보여준다.
   *
   * 이 화면에 머무르며 보여주지 않는 이유: `/oauth/kakao` 에서 새로고침하면 **이미 써버린
   * 인가 코드**로 재시도해 또 실패한다(인가 코드는 일회용이다). 그리고 실패 직후 사용자가
   * 원하는 건 재시도인데, 모달이 열려 있으면 다른 방법(구글·이메일)으로 갈아타기도 쉽다.
   */
  onError: (message: string) => void
}

/**
 * 서버 에러코드를 사용자용 문구로 옮긴다.
 *
 * 서버 메시지를 그대로 쓰지 않는다 — "유효하지 않은 인가 코드입니다",
 * "허용되지 않은 redirect_uri 입니다" 는 개발자용 표현이라 사용자에게는 암호에 가깝다.
 * 원인 추적에 필요한 값은 이미 서버 로그에 남는다.
 */
function userMessage(code: string | undefined): string {
  switch (code) {
    case 'INVALID_AUTH_CODE':
      // 대개 코드가 만료됐거나 이미 한 번 쓰였다.
      return '로그인 정보가 만료됐어요. 다시 시도해주세요.'
    case 'REDIRECT_URI_NOT_ALLOWED':
      // 설정 문제라 사용자가 할 수 있는 일이 없다. 원인은 숨기고 재시도만 안내한다.
      return '지금은 로그인할 수 없어요. 잠시 후 다시 시도해주세요.'
    default:
      return '로그인에 실패했어요. 다시 시도해주세요.'
  }
}

export default function OAuthCallback({ provider, onSuccess, onError }: Props) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const code = searchParams.get('code')
    if (!code) {
      // 사용자가 동의 화면에서 취소하면 code 없이 error=access_denied 로 돌아온다.
      // **취소는 실패가 아니다.** 자기가 취소해놓고 "로그인에 실패했어요"를 보면
      // 뭘 잘못한 것처럼 느낀다. 조용히 홈으로 돌려보낸다.
      navigate('/', { replace: true })
      return
    }

    const loginFn = provider === 'kakao' ? kakaoLogin : googleLogin

    // 인가 요청 때와 **같은 함수**로 만든다. 값이 한 글자라도 다르면 교환이 거절된다.
    loginFn(code, oauthRedirectUri(provider))
      .then(({ accessToken }) => {
        onSuccess(accessToken)
        navigate('/', { replace: true })
      })
      .catch((err: unknown) => {
        const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
        onError(userMessage(code))
        navigate('/', { replace: true })
      })
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p style={{ color: '#888', fontSize: 15 }}>로그인 처리 중...</p>
    </div>
  )
}
