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

/**
 * "그 메뉴가 속한 버킷" 으로 읽을 때의 라벨.
 *
 * 추천 필터의 라벨(`~1만` 같은 상한 표기)과 **일부러 다르다** — 필터는 "이 금액까지 낼 수 있다",
 * 메뉴 속성은 "이 메뉴는 이 가격대다" 라서 같은 값이라도 읽는 방식이 다르기 때문이다.
 * 등록 화면과 메뉴 상세 화면이 이 정의를 공유한다.
 */
export const BUDGET_BUCKETS: { value: BudgetTier; label: string }[] = [
  { value: 'UNDER_5000', label: '5천원 미만' },
  { value: 'W5000_10000', label: '5천원대' },
  { value: 'W10000_15000', label: '1만원대' },
  { value: 'W15000_20000', label: '1만5천원대' },
  { value: 'OVER_20000', label: '2만원 이상' },
]

export function budgetLabel(tier: BudgetTier): string {
  return BUDGET_BUCKETS.find((b) => b.value === tier)?.label ?? tier
}

export interface RecommendParams {
  people?: number
  /** 상한으로 해석된다. */
  budgetTier?: BudgetTier
  /** 여러 개면 OR 매칭. */
  categoryIds?: number[]
}

/**
 * 메뉴를 등록한 사람.
 *
 * null 인 경우가 둘이다 — 처음부터 들어 있던 기본 메뉴, 그리고 등록자가 탈퇴한 메뉴.
 * 클라이언트는 둘을 구분하지 않고 "점메추 기본 메뉴"로 보여준다.
 */
export interface MenuCreator {
  id: number
  nickname: string
  profileImageUrl: string | null
}

export interface Menu {
  id: number
  name: string
  /** 사진은 등록 필수라 null 이 아니다 (DB NOT NULL). */
  imageUrl: string
  budgetTier: BudgetTier
  categories: Category[]
  minPeople: number
  maxPeople: number
  createdBy: MenuCreator | null
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
