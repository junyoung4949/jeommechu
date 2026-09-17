import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { kakaoLogin, googleLogin } from '../api/auth'
import { oauthRedirectUri } from '../lib/oauth'

interface Props {
  provider: 'kakao' | 'google'
  onSuccess: (token: string) => void
}

export default function OAuthCallback({ provider, onSuccess }: Props) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const code = searchParams.get('code')
    if (!code) {
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
      .catch(() => {
        navigate('/', { replace: true })
      })
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p style={{ color: '#888', fontSize: 15 }}>로그인 처리 중...</p>
    </div>
  )
}
