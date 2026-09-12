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
