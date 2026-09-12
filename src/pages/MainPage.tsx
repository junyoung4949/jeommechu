import { useEffect, useState, useCallback } from 'react'
import confetti from 'canvas-confetti'
import FilterCard, { type FilterState } from '../components/FilterCard/FilterCard'
import Avatar from '../components/Avatar/Avatar'
import { fetchCategories, type Category } from '../api/categories'
import { fetchRecommend, postAction, type RecommendResult } from '../api/recommend'
import styles from './MainPage.module.css'

function iGa(word: string) {
  const code = word.charCodeAt(word.length - 1)
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? '이' : '가'
}

interface Props {
  onLoginClick: () => void
}

/**
 * home   : 조건 고르고 추천받기 전
 * result : 추천 결과를 보는 중 (결정 / 다시)
 * decided: 결정을 누른 뒤 (공유 / 다시 고르기)
 *
 * decided 를 따로 둔 이유: 공유는 "내가 정한 메뉴"를 보내는 행동이라
 * 결정 이전에 열어두면 의미가 흐려진다. 예전에는 결정 후 2.2초 뒤 홈으로 돌아가서
 * 공유할 틈 자체가 없기도 했다.
 */
type Phase = 'home' | 'result' | 'decided'

export default function MainPage({ onLoginClick }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [filters, setFilters] = useState<FilterState>({
    people: null,
    budgetTier: null,
    categories: [],
  })
  const [phase, setPhase] = useState<Phase>('home')
  const [result, setResult] = useState<RecommendResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {
      setCategories([
        { id: 1, name: '한식' },
        { id: 2, name: '중식' },
        { id: 3, name: '일식' },
        { id: 4, name: '양식' },
        { id: 5, name: '분식' },
      ])
    })
  }, [])

  async function handleRecommend() {
    setError('')
    setLoading(true)
    try {
      const params = {
        people: filters.people ?? undefined,
        budgetTier: filters.budgetTier ?? undefined,
        categoryIds: filters.categories.length > 0 ? filters.categories : undefined,
      }
      const data = await fetchRecommend(params)
      setResult(data)
      setPhase('result')
    } catch (err: unknown) {
      // 빈 결과는 예외가 아니라 정상 흐름이다. 필터 완화를 안내한다.
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      setError(
        code === 'NO_MENU_FOUND'
          ? '조건에 맞는 메뉴가 없어요. 필터를 조금 넓혀보세요.'
          : '추천을 가져오지 못했어요. 다시 시도해주세요.',
      )
    } finally {
      setLoading(false)
    }
  }

  const fireConfetti = useCallback(() => {
    const colors = [getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#ff6b35', '#ffd700', '#ff4500', '#00bcd4']
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors })
    setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 }, colors }), 200)
    setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 }, colors }), 400)
  }, [])

  async function handleChosen() {
    if (!result) return
    await postAction(result.recommendationId, 'chosen').catch(() => {})
    fireConfetti()
    // 홈으로 되돌리지 않는다. 확정 화면에 머물러야 공유할 수 있다.
    setPhase('decided')
  }

  async function handleSkip() {
    if (!result) return
    await postAction(result.recommendationId, 'skipped').catch(() => {})
    handleRecommend()
  }

  /** 확정 화면에서 처음으로 돌아간다. */
  function handleRestart() {
    setPhase('home')
    setResult(null)
    setError('')
  }

  function handleShare() {
    if (!result) return
    const text = `오늘 점심은 ${result.menu.name}${iGa(result.menu.name)} 좋겠군요 — 점메추`
    // /menus/{id} 가 아니라 /share/{id} 를 보낸다.
    // 메신저 크롤러는 JS 를 실행하지 않아 SPA 경로에서는 메뉴별 미리보기를 못 읽는다.
    // /share/{id} 는 서버가 OG 태그를 박아 주고, 사람은 곧바로 /menus/{id} 로 넘어간다.
    const url = `${window.location.origin}/share/${result.menu.id}`

    if (navigator.share) {
      navigator.share({ title: '점메추', text, url })
    } else {
      navigator.clipboard.writeText(`${text}\n${url}`)
      alert('클립보드에 복사됐어요!')
    }
  }

  /** 결과 화면과 확정 화면이 함께 쓰는 부분 (사진 + 등록자). */
  const menuVisual = (menu: RecommendResult['menu']) => (
    <>
      <div className={styles.foodImageWrap}>
        <img src={menu.imageUrl} alt={menu.name} className={styles.foodImage} />
      </div>

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
    </>
  )

  return (
    <main className={styles.main}>
      {phase === 'home' && (
        <div className={styles.homeContent}>
          <h1 className={styles.mainTitle}>오늘 점심, 뭐 먹을까?</h1>
          <p className={styles.subTitle}>조건을 고르면 딱 맞는 메뉴를 추천해드려요</p>
          <button
            className={styles.recommendBtn}
            onClick={handleRecommend}
            disabled={loading}
          >
            {loading ? '추천 중...' : '음식 추천'}
          </button>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.filterWrap}>
            <FilterCard categories={categories} filters={filters} onChange={setFilters} />
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div className={styles.resultContent}>
          <p className={styles.resultSub}>오늘 점심은</p>
          <h2 className={styles.resultTitle}>{result.menu.name}{iGa(result.menu.name)} 좋겠군요</h2>

          {menuVisual(result.menu)}

          {/* 공유는 여기 없다 — 결정한 뒤(decided)에만 연다. */}
          <div className={styles.actionBtns}>
            <button className={`${styles.actionBtn} ${styles.chosen}`} onClick={handleChosen}>
              ✓ 결정
            </button>
            <button
              className={`${styles.actionBtn} ${styles.skip}`}
              onClick={handleSkip}
              disabled={loading}
            >
              ↺ {loading ? '...' : '다시'}
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.filterWrap}>
            <FilterCard categories={categories} filters={filters} onChange={setFilters} />
          </div>
        </div>
      )}

      {phase === 'decided' && result && (
        <div className={styles.resultContent}>
          <p className={styles.decidedBadge}>오늘 점심 확정</p>
          <h2 className={styles.resultTitle}>{result.menu.name}</h2>

          {menuVisual(result.menu)}

          <div className={styles.decidedBtns}>
            <button className={styles.shareBtn} onClick={handleShare}>
              ↗ 친구에게 공유하기
            </button>
            <button className={styles.restartBtn} onClick={handleRestart}>
              다시 고르기
            </button>
          </div>
        </div>
      )}

      <button className={styles.loginPrompt} onClick={onLoginClick}>
        로그인하면 추천 기록이 저장돼요
      </button>
    </main>
  )
}
