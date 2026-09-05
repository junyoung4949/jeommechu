import { useState, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Header from './components/Header/Header'
import LoginModal from './components/LoginModal/LoginModal'
import MainPage from './pages/MainPage'
import MenuCreatePage from './pages/MenuCreatePage'
import OAuthCallback from './pages/OAuthCallback'
import { getMe, logout, type MeResponse } from './api/auth'
import { hasSessionHint } from './api/client'

export default function App() {
  const [showLogin, setShowLogin] = useState(false)
  // 로그인 여부와 프로필(닉네임·사진)을 한 상태로 다룬다. null 이면 비로그인.
  const [me, setMe] = useState<MeResponse | null>(null)

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
  }, [])

  function handleLoginSuccess(_token: string) {
    setShowLogin(false)
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
          onClose={() => setShowLogin(false)}
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
          element={<OAuthCallback provider="kakao" onSuccess={handleLoginSuccess} />}
        />
        <Route
          path="/oauth/google"
          element={<OAuthCallback provider="google" onSuccess={handleLoginSuccess} />}
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
        <Route
          path="*"
          element={shell(<MainPage onLoginClick={() => setShowLogin(true)} />)}
        />
      </Routes>
    </BrowserRouter>
  )
}
