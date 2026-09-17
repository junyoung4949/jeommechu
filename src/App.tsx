import { useState, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Header from './components/Header/Header'
import LoginModal from './components/LoginModal/LoginModal'
import MainPage from './pages/MainPage'
import MenuCreatePage from './pages/MenuCreatePage'
import MenuDetailPage from './pages/MenuDetailPage'
import OAuthCallback from './pages/OAuthCallback'
import AdminPage from './pages/AdminPage'
import { getMe, logout, type MeResponse } from './api/auth'
import { hasSessionHint } from './api/client'

/** /admin 에 들어왔지만 아직 볼 수 없을 때의 안내. 화면 하나짜리라 여기 둔다. */
function AdminGate({ children, onLoginClick }: { children: ReactNode; onLoginClick?: () => void }) {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        color: '#8a897f',
        fontSize: 15,
      }}
    >
      <p style={{ margin: 0 }}>{children}</p>
      {onLoginClick && (
        <button
          onClick={onLoginClick}
          style={{
            font: 'inherit',
            fontWeight: 600,
            fontSize: 14,
            color: '#fff',
            background: 'var(--color-primary)',
            border: 0,
            borderRadius: 8,
            padding: '9px 18px',
            cursor: 'pointer',
          }}
        >
          로그인
        </button>
      )}
    </main>
  )
}

export default function App() {
  const [showLogin, setShowLogin] = useState(false)
  /** 소셜 로그인이 콜백에서 실패했을 때의 문구. 모달을 다시 열면서 함께 넘긴다. */
  const [loginError, setLoginError] = useState('')
  // 로그인 여부와 프로필(닉네임·사진)을 한 상태로 다룬다. null 이면 비로그인.
  const [me, setMe] = useState<MeResponse | null>(null)
  /**
   * "아직 모름"과 "비로그인"은 다르다.
   * 이 구분이 없으면 /admin 을 새로고침했을 때 getMe 가 돌아오기 전에 권한 없음 화면이
   * 번쩍 떴다가 바뀐다. 세션 흔적이 없으면 물어볼 것도 없으니 처음부터 false 다.
   */
  const [meLoading, setMeLoading] = useState(hasSessionHint())

  useEffect(() => {
    // 로그인 흔적이 없으면 서버에 물어볼 것도 없다.
    // 첫 방문자에게 401 두 번(=/auth/me, /auth/refresh)을 던지지 않기 위한 분기다.
    if (!hasSessionHint()) {
      setMe(null)
      return
    }
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setMeLoading(false))
  }, [])

  /** 모달을 닫을 때 에러 문구도 함께 비운다. 남겨두면 다음에 열 때 옛 문구가 뜬다. */
  function closeLogin() {
    setShowLogin(false)
    setLoginError('')
  }

  /**
   * 소셜 로그인이 콜백 화면에서 실패했을 때. 콜백은 곧바로 홈으로 이동하므로,
   * 홈이 그려질 때 모달이 이 문구와 함께 열려 있게 된다.
   */
  function handleLoginFailure(message: string) {
    setLoginError(message)
    setShowLogin(true)
  }

  function handleLoginSuccess(_token: string) {
    closeLogin()
    // 토큰만 받은 상태라 프로필은 아직 모른다. 실패해도 로그인 자체는 유효하다.
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
  }

  async function handleLogout() {
    await logout().catch(() => {})
    setMe(null)
  }

  /** 헤더 + 로그인 모달을 공유하는 공통 레이아웃. */
  const shell = (page: ReactNode) => (
    <>
      <Header
        onLoginClick={() => setShowLogin(true)}
        me={me}
        onLogout={handleLogout}
        onMeChange={setMe}
      />
      {page}
      {showLogin && (
        <LoginModal
          initialError={loginError}
          onClose={closeLogin}
          onSuccess={handleLoginSuccess}
        />
      )}
    </>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/oauth/kakao"
          element={
            <OAuthCallback
              provider="kakao"
              onSuccess={handleLoginSuccess}
              onError={handleLoginFailure}
            />
          }
        />
        <Route
          path="/oauth/google"
          element={
            <OAuthCallback
              provider="google"
              onSuccess={handleLoginSuccess}
              onError={handleLoginFailure}
            />
          }
        />
        <Route
          path="/menus/new"
          element={shell(
            <MenuCreatePage
              isLoggedIn={me !== null}
              onLoginClick={() => setShowLogin(true)}
            />,
          )}
        />
        {/* 공유 링크가 닿는 곳. /menus/new 보다 뒤에 두지만, react-router 는
            정적 세그먼트를 동적(:id)보다 먼저 매칭하므로 순서와 무관하게 안전하다. */}
        <Route path="/menus/:id" element={shell(<MenuDetailPage />)} />
        {/*
          화면을 감추는 것은 편의일 뿐이다 — 주소를 직접 쳐서 들어와도 서버가 매 요청을
          401/403 으로 막는다. 여기서 막는 건 "쓸 수 없는 화면을 보여주지 않기" 위해서다.
        */}
        <Route
          path="/admin"
          element={shell(
            meLoading
              ? <AdminGate>확인 중...</AdminGate>
              : !me
                ? <AdminGate onLoginClick={() => setShowLogin(true)}>
                    관리자 화면입니다. 로그인해 주세요.
                  </AdminGate>
                : !me.isManager
                  ? <AdminGate>관리자만 볼 수 있는 화면입니다.</AdminGate>
                  : <AdminPage />,
          )}
        />
        <Route
          path="*"
          element={shell(<MainPage onLoginClick={() => setShowLogin(true)} />)}
        />
      </Routes>
    </BrowserRouter>
  )
}
