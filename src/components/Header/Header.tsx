import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Avatar from '../Avatar/Avatar'
import type { MeResponse } from '../../api/auth'
import styles from './Header.module.css'

interface Props {
  onLoginClick: () => void
  me: MeResponse | null
  onLogout: () => void
}

/**
 * 드롭다운은 **입구**만 맡는다.
 *
 * 프로필 사진 등록·변경·삭제는 예전에 여기 있었지만 마이페이지로 옮겼다 —
 * 같은 기능이 두 군데 있으면 둘 다 고쳐야 하고, 닉네임·탈퇴까지 얹을 자리도 없었다.
 */
export default function Header({ onLoginClick, me, onLogout }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onCreatePage = pathname === '/menus/new'
  const onAdminPage = pathname === '/admin'
  const onMyPage = pathname === '/me'

  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭·Esc 로 닫는다.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function go(path: string) {
    setOpen(false)
    navigate(path)
  }

  return (
    <header className={styles.header}>
      <button className={styles.logo} onClick={() => navigate('/')}>
        점메추
      </button>
      <div className={styles.actions}>
        {!onCreatePage && (
          <button className={styles.textBtn} onClick={() => navigate('/menus/new')}>
            메뉴 등록
          </button>
        )}
        {me ? (
          <div className={styles.profile} ref={menuRef}>
            <button
              className={styles.avatarBtn}
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="내 계정"
            >
              <Avatar nickname={me.nickname} imageUrl={me.profileImageUrl} size={36} />
            </button>

            {open && (
              <div className={styles.menu} role="menu">
                {/* 머리 부분을 눌러도 마이페이지로 간다 — 항목을 하나 더 늘리지 않으려고. */}
                <button className={styles.menuHead} onClick={() => go('/me')} role="menuitem">
                  <Avatar nickname={me.nickname} imageUrl={me.profileImageUrl} size={48} />
                  <span className={styles.menuIdentity}>
                    <strong className={styles.menuNickname}>{me.nickname}</strong>
                    {me.email && <span className={styles.menuEmail}>{me.email}</span>}
                  </span>
                </button>

                {!onMyPage && (
                  <button className={styles.menuItem} onClick={() => go('/me')} role="menuitem">
                    마이페이지
                  </button>
                )}

                {/* 매니저에게만 보인다. 감추는 건 편의일 뿐 — 주소를 직접 쳐도 서버가 막는다. */}
                {me.isManager && !onAdminPage && (
                  <button className={styles.menuItem} onClick={() => go('/admin')} role="menuitem">
                    관리자
                  </button>
                )}

                <button
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={onLogout}
                  role="menuitem"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className={styles.loginBtn} onClick={onLoginClick}>
            로그인
          </button>
        )}
      </div>
    </header>
  )
}
