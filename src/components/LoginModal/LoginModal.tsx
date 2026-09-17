import { useState } from 'react'
import { login, register } from '../../api/auth'
import { oauthRedirectUri } from '../../lib/oauth'
import styles from './LoginModal.module.css'

interface Props {
  onClose: () => void
  onSuccess: (token: string) => void
}

type Mode = 'login' | 'register'

export default function LoginModal({ onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const { accessToken } = await login(email, password)
        onSuccess(accessToken)
      } else {
        await register(email, password)
        const { accessToken } = await login(email, password)
        onSuccess(accessToken)
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (mode === 'login' ? '이메일 또는 비밀번호가 올바르지 않아요' : '회원가입에 실패했어요')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // scope 에 openid 가 없으면 provider 가 id_token 을 내려주지 않는다.
  // 서버는 code → id_token 교환 후 id_token 으로 세션을 만들므로, 빠지면 로그인이 실패한다.
  // (카카오는 콘솔에서 "OpenID Connect 활성화"도 켜야 한다.)
  function handleKakao() {
    const kakaoClientId = import.meta.env.VITE_KAKAO_CLIENT_ID as string
    const redirectUri = oauthRedirectUri('kakao')
    // profile_nickname 이 없으면 id_token 에 닉네임 claim 이 없어
    // 서버가 이메일 앞부분으로 닉네임을 만들어 버린다.
    // profile_image 는 id_token 의 picture claim → 가입 시 프로필 사진으로 승계된다.
    // 둘 다 카카오 콘솔에서 동의항목을 켜 두어야 한다.
    const scope = 'openid profile_nickname profile_image'
    window.location.href =
      `https://kauth.kakao.com/oauth/authorize` +
      `?client_id=${kakaoClientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}`
  }

  function handleGoogle() {
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
    const redirectUri = oauthRedirectUri('google')
    const scope = 'openid email profile'
    window.location.href =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${googleClientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}`
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.title}>{mode === 'login' ? '로그인' : '회원가입'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>이메일</label>
          <input
            className={styles.input}
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className={styles.label}>비밀번호</label>
          <input
            className={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        <div className={styles.dividerRow}>
          <div className={styles.dividerLine} />
          <span className={styles.dividerText}>또는</span>
          <div className={styles.dividerLine} />
        </div>

        <button className={`${styles.socialBtn} ${styles.kakao}`} onClick={handleKakao}>
          <span className={styles.socialIcon}>K</span>
          카카오로 계속하기
        </button>
        <button className={`${styles.socialBtn} ${styles.google}`} onClick={handleGoogle}>
          <span className={styles.socialIcon}>G</span>
          구글로 계속하기
        </button>

        <p className={styles.switchText}>
          {mode === 'login' ? (
            <>
              계정이 없으신가요?{' '}
              <button className={styles.switchBtn} onClick={() => setMode('register')}>
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{' '}
              <button className={styles.switchBtn} onClick={() => setMode('login')}>
                로그인
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
