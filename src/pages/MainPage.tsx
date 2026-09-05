import { useEffect, useState, useCallback } from 'react'
import confetti from 'canvas-confetti'
import FilterCard, { type FilterState } from '../components/FilterCard/FilterCard'
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

type Phase = 'home' | 'result'

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
    setTimeout(() => {
      setPhase('home')
      setResult(null)
    }, 2200)
  }

  async function handleSkip() {
    if (!result) return
    await postAction(result.recommendationId, 'skipped').catch(() => {})
    handleRecommend()
  }

  function handleShare() {
    if (!result) return
    const text = `오늘 점심은 ${result.menu.name}${iGa(result.menu.name)} 좋겠군요 — 점메추`
    if (navigator.share) {
      navigator.share({ title: '점메추', text })
    } else {
      navigator.clipboard.writeText(text)
      alert('클립보드에 복사됐어요!')
    }
  }

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

          <div className={styles.foodImageWrap}>
            {result.menu.imageUrl ? (
              <img
                src={result.menu.imageUrl}
                alt={result.menu.name}
                className={styles.foodImage}
              />
            ) : (
              <div className={styles.foodImagePlaceholder}>[ 음식 사진 ]</div>
            )}
          </div>

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
            <button className={`${styles.actionBtn} ${styles.share}`} onClick={handleShare}>
              ↗ 공유하기
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.filterWrap}>
            <FilterCard categories={categories} filters={filters} onChange={setFilters} />
          </div>
        </div>
      )}

      <button className={styles.loginPrompt} onClick={onLoginClick}>
        로그인하면 추천 기록이 저장돼요
      </button>
    </main>
  )
}
