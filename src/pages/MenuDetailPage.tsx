import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar/Avatar'
import { fetchMenu, type MenuDetail } from '../api/menus'
import { budgetLabel } from '../api/recommend'
import styles from './MenuDetailPage.module.css'

type Status = 'loading' | 'ok' | 'notfound' | 'error'

/**
 * 메뉴 상세. 공유 링크(`/menus/{id}`)로 들어오는 화면이다.
 *
 * 로그인 없이 열려야 한다 — 링크를 받은 사람은 대개 이 서비스를 처음 본다.
 * 그래서 마지막에 "나도 추천받기" 로 홈으로 유도한다.
 */
export default function MenuDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [menu, setMenu] = useState<MenuDetail | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    const menuId = Number(id)
    // 라우트가 :id 를 문자열로 넘기므로 숫자가 아닌 값이 올 수 있다.
    if (!Number.isSafeInteger(menuId) || menuId < 1) {
      setStatus('notfound')
      return
    }

    let alive = true
    setStatus('loading')
    fetchMenu(menuId)
      .then((data) => {
        if (!alive) return
        setMenu(data)
        setStatus('ok')
      })
      .catch((err: unknown) => {
        if (!alive) return
        const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
        setStatus(code === 'NOT_FOUND' ? 'notfound' : 'error')
      })
    // 링크를 타고 다른 메뉴로 이동했을 때 옛 응답이 덮어쓰지 않게 한다.
    return () => {
      alive = false
    }
  }, [id])

  if (status === 'loading') {
    return (
      <main className={styles.main}>
        <p className={styles.placeholder}>불러오는 중...</p>
      </main>
    )
  }

  if (status !== 'ok' || !menu) {
    return (
      <main className={styles.main}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            {status === 'notfound' ? '없는 메뉴예요' : '불러오지 못했어요'}
          </h1>
          <p className={styles.guideText}>
            {status === 'notfound'
              ? '삭제됐거나 잘못된 링크일 수 있어요.'
              : '잠시 후 다시 시도해 주세요.'}
          </p>
          <button className={styles.primaryBtn} onClick={() => navigate('/')}>
            오늘 점심 추천받기
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <div className={styles.imageWrap}>
          <img src={menu.imageUrl} alt={menu.name} className={styles.image} />
        </div>

        <h1 className={styles.name}>{menu.name}</h1>
        {menu.description && <p className={styles.description}>{menu.description}</p>}

        <div className={styles.tags}>
          {menu.categories.map((c) => (
            <span key={c.id} className={styles.tag}>
              {c.name}
            </span>
          ))}
        </div>

        <dl className={styles.facts}>
          <div className={styles.factRow}>
            <dt>가격대</dt>
            <dd>{budgetLabel(menu.budgetTier)}</dd>
          </div>
          <div className={styles.factRow}>
            <dt>적합 인원</dt>
            <dd>
              {menu.minPeople}~{menu.maxPeople}명
            </dd>
          </div>
        </dl>

        {menu.createdBy ? (
          <p className={styles.credit}>
            <Avatar
              nickname={menu.createdBy.nickname}
              imageUrl={menu.createdBy.profileImageUrl}
              size={22}
            />
            <span>
              <strong>{menu.createdBy.nickname}</strong>님이 등록한 메뉴예요
            </span>
          </p>
        ) : (
          <p className={styles.credit}>
            <span className={styles.creditMuted}>점메추 기본 메뉴</span>
          </p>
        )}

        <button className={styles.primaryBtn} onClick={() => navigate('/')}>
          나도 오늘 점심 추천받기
        </button>
      </div>
    </main>
  )
}
