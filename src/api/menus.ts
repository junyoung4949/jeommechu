import client from './client'
import type { Category } from './categories'
import type { BudgetTier, MenuCreator } from './recommend'

export type Verdict = 'PASS' | 'DUPLICATE' | 'SIMILAR'
export type MatchType = 'EXACT' | 'ALIAS'

export interface Candidate {
  id: number
  name: string
  distance: number
  similarity: number
}

export interface NameCheckResult {
  input: string
  /** 정규화 + 이형어 매핑을 거친 형태. 예: 짜장면 → 자장면 */
  normalized: string
  verdict: Verdict
  /** verdict=DUPLICATE 일 때만 존재 */
  matched: {
    id: number
    name: string
    matchType: MatchType
    decisionCount: number
  } | null
  /** verdict=SIMILAR 일 때만 채워짐 (유사도 내림차순, 최대 3개) */
  candidates: Candidate[]
}

export interface MenuDetail {
  id: number
  name: string
  categories: Category[]
  budgetTier: BudgetTier
  minPeople: number
  maxPeople: number
  imageUrl: string
  description: string | null
  createdBy: MenuCreator | null
  createdAt: string
}

export interface CreateMenuBody {
  name: string
  categoryIds: number[]
  budgetTier: BudgetTier
  minPeople: number
  maxPeople: number
  /** 필수. `uploadMenuImage()` 가 반환한 URL 을 그대로 넣는다. */
  imageUrl: string
  description?: string | null
  /** SIMILAR 후보를 "다른 메뉴"라고 확인했을 때 true */
  confirmedDistinct?: boolean
}

/**
 * 메뉴 단건 조회. 공유 링크로 들어온 사람이 보는 화면의 데이터원이다.
 * 인증이 필요 없다 — 링크를 받은 사람은 보통 로그인 상태가 아니다.
 */
export async function fetchMenu(id: number): Promise<MenuDetail> {
  const { data } = await client.get<MenuDetail>(`/menus/${id}`)
  return data
}

/** 등록 전 미리보기용. 최종 차단은 서버가 등록 시 다시 판정한다. */
export async function checkMenuName(name: string): Promise<NameCheckResult> {
  const { data } = await client.get<NameCheckResult>('/menus/name-check', {
    params: { name },
  })
  return data
}

/** 이 API 만 multipart/form-data 를 쓴다 (공통 규약 0-1 예외). */
export async function uploadMenuImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<{ imageUrl: string }>('/images', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.imageUrl
}

export async function createMenu(body: CreateMenuBody): Promise<MenuDetail> {
  const { data } = await client.post<MenuDetail>('/menus', body)
  return data
}

/** 보낸 필드만 바뀐다. 안 보낸 필드는 그대로 남는다. */
export interface MenuPatch {
  name?: string
  categoryIds?: number[]
  budgetTier?: BudgetTier
  minPeople?: number
  maxPeople?: number
  description?: string | null
  /**
   * `uploadMenuImage()` 가 돌려준 주소만 받는다. 서버가 우리 버킷 주소인지 다시 보고,
   * 아니면 `VALIDATION_ERROR` 로 막는다 — 초기 데이터처럼 외부 주소를 쓰는 메뉴는
   * 사진을 새로 올리지 않는 한 이 필드를 보내면 안 된다.
   */
  imageUrl?: string
}

/** 관리자와 등록자 본인이 함께 쓴다. 누가 쓸 수 있는지는 서버가 판단한다. */
export async function patchMenu(id: number, patch: MenuPatch): Promise<void> {
  await client.patch(`/menus/${id}`, patch)
}

/**
 * 추천 기록이 있으면 서버가 `CASCADE_NOT_CONFIRMED` 로 막는다.
 * 몇 건이 함께 사라지는지 사용자에게 보여준 뒤 `confirmCascade` 로 다시 부른다.
 */
export async function deleteMenu(id: number, confirmCascade = false): Promise<void> {
  await client.delete(`/menus/${id}`, { data: { confirmCascade } })
}

/**
 * 메뉴 한 개의 성적. 서버가 관리자 화면에 쓰던 집계(`AdminMenu.stats`)와 같은 모양이다.
 * 넷의 합이 아니라 `chosen + skipped + noResponse === recommended` 가 성립한다.
 */
export interface MenuStats {
  recommended: number
  chosen: number
  skipped: number
  /** 추천만 받고 아무 버튼도 안 누른 횟수. */
  noResponse: number
}

/**
 * 전체 메뉴 중 이 메뉴의 등수.
 *
 * `total` 은 전체 메뉴 수가 아니라 **집계 기준을 넘긴 메뉴 수**다. 응답이 한두 건뿐인
 * 메뉴까지 분모에 넣으면 등수가 부풀려진다. 기준 미달이면 이 값 자체가 null 이다.
 */
export interface MenuRank {
  position: number
  total: number
}

export interface MyMenu {
  id: number
  name: string
  imageUrl: string
  categories: Category[]
  budgetTier: BudgetTier
  minPeople: number
  maxPeople: number
  description: string | null
  createdAt: string
  stats: MenuStats
  /** 응답 수가 `minResponses` 에 못 미치면 null — 화면은 "집계 중"으로 표시한다. */
  rank: MenuRank | null
  lastRecommendedAt: string | null
}

export interface MyMenusResponse {
  /**
   * 순위가 매겨지는 최소 응답 수. 이 값을 서버가 쥐고 있어야 데이터가 쌓였을 때
   * 클라이언트 배포 없이 기준을 올릴 수 있다.
   */
  minResponses: number
  /** 전체 평균 채택률(0~1). 비교 기준선이 없으면 내 채택률이 높은지 낮은지 알 수 없다. */
  avgChosenRate: number | null
  menus: MyMenu[]
}

export async function fetchMyMenus(): Promise<MyMenusResponse> {
  const { data } = await client.get<MyMenusResponse>('/auth/me/menus')
  return data
}

/**
 * 응답(채택+넘김) 중 채택 비율.
 *
 * 무응답을 분모에 넣지 않는다 — 실제로 무응답이 전체의 3/4 이라 넣으면 모든 메뉴가
 * 10% 아래로 깔려 비교가 안 된다. 관리자 화면의 '응답 중 채택률'과 같은 정의다.
 * 응답이 없으면 비교 대상이 아니므로 null.
 */
export function adoptionRate(stats: MenuStats): number | null {
  const answered = stats.chosen + stats.skipped
  return answered === 0 ? null : stats.chosen / answered
}

export function answeredCount(stats: MenuStats): number {
  return stats.chosen + stats.skipped
}
