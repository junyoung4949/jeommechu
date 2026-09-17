import client from './client'
import type { Category } from './categories'
import type { BudgetTier } from './recommend'

/** 관리자 목록의 한 행. 화면이 필요로 하는 것이 한 응답에 다 담겨 온다. */
export interface AdminMenu {
  id: number
  name: string
  budgetTier: BudgetTier
  minPeople: number
  maxPeople: number
  imageUrl: string
  description: string | null
  createdAt: string
  /** 등록자가 탈퇴하면 null 이 된다 (menus.created_by 가 ON DELETE SET NULL). */
  createdBy: { nickname: string; profileImageUrl: string | null } | null
  categories: Category[]
  aliases: string[]
  stats: {
    recommended: number
    chosen: number
    skipped: number
    /** 추천만 받고 아무 버튼도 안 누른 횟수. */
    noResponse: number
  }
}

export interface AdminStats {
  total: { recommended: number; chosen: number; skipped: number; noResponse: number }
  perMenu: {
    menuId: number
    name: string | null
    recommended: number
    chosen: number
    skipped: number
    noResponse: number
    lastRecommendedAt: string | null
  }[]
}

export async function fetchAdminMenus(): Promise<AdminMenu[]> {
  const { data } = await client.get<AdminMenu[]>('/admin/menus')
  return data
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data } = await client.get<AdminStats>('/admin/stats')
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
}

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

export async function addAlias(menuId: number, alias: string): Promise<void> {
  await client.post(`/menus/${menuId}/aliases`, { alias })
}

export async function removeAlias(menuId: number, alias: string): Promise<void> {
  await client.delete(`/menus/${menuId}/aliases/${encodeURIComponent(alias)}`)
}

export async function createCategory(name: string): Promise<Category> {
  const { data } = await client.post<Category>('/categories', { name })
  return data
}

export async function renameCategory(id: number, name: string): Promise<Category> {
  const { data } = await client.patch<Category>(`/categories/${id}`, { name })
  return data
}

/**
 * 메뉴가 걸려 있으면 서버가 `CATEGORY_IN_USE` 로 막고, 몇 개에서 이 카테고리가 빠지는지와
 * 그중 몇 개가 카테고리 0개가 되는지를 알려준다. 그걸 보여준 뒤 다시 부른다.
 */
export async function deleteCategory(id: number, confirmCascade = false): Promise<void> {
  await client.delete(`/categories/${id}`, { data: { confirmCascade } })
}

/** 서버 오류 응답에서 코드와 문구를 꺼낸다. 형식은 명세 0-4 로 모든 라우트가 동일하다. */
export function errorOf(err: unknown): { code?: string; message?: string; detail?: Record<string, unknown> } {
  const res = (err as { response?: { data?: { code?: string; message?: string; detail?: Record<string, unknown> } } })
    ?.response?.data
  return res ?? {}
}
