import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Avatar from '../Avatar/Avatar'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  deleteProfileImage,
  uploadProfileImage,
  type MeResponse,
} from '../../api/auth'
import styles from './Header.module.css'

interface Props {
  onLoginClick: () => void
  me: MeResponse | null
  onLogout: () => void
  /** 프로필 사진이 바뀌면 새 사용자 정보를 위로 올려보낸다. */
  onMeChange: (me: MeResponse) => void
}

export default function Header({ onLoginClick, me, onLogout, onMeChange }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onCreatePage = pathname === '/menus/new'

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  // 메뉴를 닫으면 지난 에러 문구도 함께 치운다.
  useEffect(() => {
    if (!open) setError(null)
  }, [open])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
    e.target.value = ''
    if (!file) return

    // 서버도 같은 검사를 하지만, 확실한 거절을 왕복 없이 바로 보여준다.
    if (!AVATAR_MIME_TYPES.includes(file.type)) {
      setError('jpg / png / webp 만 올릴 수 있어요.')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('사진은 최대 2MB까지 올릴 수 있어요.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      onMeChange(await uploadProfileImage(file))
      setOpen(false)
    } catch {
      setError('사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    try {
      onMeChange(await deleteProfileImage())
      setOpen(false)
    } catch {
      setError('사진을 지우지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
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
                <div className={styles.menuHead}>
                  <Avatar nickname={me.nickname} imageUrl={me.profileImageUrl} size={48} />
                  <div className={styles.menuIdentity}>
                    <strong className={styles.menuNickname}>{me.nickname}</strong>
                    {me.email && <span className={styles.menuEmail}>{me.email}</span>}
                  </div>
                </div>

                {error && <p className={styles.menuError}>{error}</p>}

                <button
                  className={styles.menuItem}
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  role="menuitem"
                >
                  {me.profileImageUrl ? '사진 변경' : '사진 등록'}
                </button>
                {me.profileImageUrl && (
                  <button
                    className={styles.menuItem}
                    onClick={handleRemove}
                    disabled={busy}
                    role="menuitem"
                  >
                    사진 삭제
                  </button>
                )}
                <button
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={onLogout}
                  disabled={busy}
                  role="menuitem"
                >
                  로그아웃
                </button>

                <input
                  ref={fileRef}
                  className={styles.fileInput}
                  type="file"
                  accept={AVATAR_MIME_TYPES.join(',')}
                  onChange={handleFile}
                />
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
