import client from './client'
import type { Category } from './categories'

/**
 * 명세 0-5. 배열 순서가 곧 명세의 `order` 다.
 * - 메뉴 속성으로서는 "그 메뉴가 속한 버킷 하나"
 * - 추천 필터로서는 "지불 가능 상한" (이 티어 이하가 모두 매칭)
 */
export const BUDGET_TIERS = [
  'UNDER_5000',
  'W5000_10000',
  'W10000_15000',
  'W15000_20000',
  'OVER_20000',
] as const

export type BudgetTier = (typeof BUDGET_TIERS)[number]

export interface RecommendParams {
  people?: number
  /** 상한으로 해석된다. */
  budgetTier?: BudgetTier
  /** 여러 개면 OR 매칭. */
  categoryIds?: number[]
}

export interface Menu {
  id: number
  name: string
  imageUrl: string | null
  budgetTier: BudgetTier
  categories: Category[]
  minPeople: number
  maxPeople: number
}

export interface RecommendResult {
  recommendationId: number
  menu: Menu
}

export async function fetchRecommend(params: RecommendParams): Promise<RecommendResult> {
  const searchParams = new URLSearchParams()
  if (params.people) searchParams.set('people', String(params.people))
  if (params.budgetTier) searchParams.set('budgetTier', params.budgetTier)
  // 반복 파라미터로 전달한다: categoryIds=1&categoryIds=3
  params.categoryIds?.forEach((id) => searchParams.append('categoryIds', String(id)))

  const { data } = await client.get<RecommendResult>(`/recommend?${searchParams}`)
  return data
}

export async function postAction(
  recommendationId: number,
  action: 'chosen' | 'skipped',
): Promise<void> {
  await client.post(`/recommendations/${recommendationId}/action`, { action })
}
