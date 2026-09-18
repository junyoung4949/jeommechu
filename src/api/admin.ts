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

export interface StatCounts {
  recommended: number
  chosen: number
  skipped: number
  noResponse: number
}

/**
 * 같은 기록을 신원으로 쪼갠 것. `loggedIn + anonymous === recommended` 가 항상 성립한다
 * (서버가 비로그인을 `uid 있음`이 아니라 `user_id 없음`으로 세기 때문).
 */
export interface IdentityCounts {
  loggedIn: number
  anonymous: number
}

export interface MenuStatRow extends StatCounts {
  menuId: number
  name: string | null
  lastRecommendedAt: string | null
}

/** 하루치 집계. 기간 안에 기록이 하나도 없는 날은 아예 오지 않는다. */
export interface DailyRow extends StatCounts, IdentityCounts {
  day: string
  signups: number
}

/** 0~23시(KST). 기록이 없는 시간도 0으로 온다 — 24칸이 늘 같은 자리에 있어야 비교가 된다. */
export interface HourRow extends StatCounts, IdentityCounts {
  hour: number
}

/** 1=월 … 7=일 (ISO). 주말이 오른쪽 끝에 붙어 평일 패턴이 끊기지 않는다. */
export interface WeekdayRow extends StatCounts, IdentityCounts {
  dow: number
}

/** 기간 내 가입자 한 명의 성적. 활동은 **가입 이후** 기록만 센다. */
export interface CohortUser extends StatCounts {
  userNo: number
  nickname: string
  joinedAt: string
  activeDays: number
  lastActiveAt: string | null
}

export interface CohortStats extends StatCounts {
  /** 기간 내 신규 가입자 수. */
  signups: number
  /** 기간 종료 시점의 누적 회원 수. 유입률의 분모다. */
  totalUsers: number
  /** 가입 후 추천을 한 번이라도 받은 사람 수. */
  activated: number
  /** 활동한 날이 이틀 이상인 사람 수. */
  returning: number
  avgActiveDays: number
  rows: CohortUser[]
}

export interface AdminStats {
  range: { from: string | null; to: string | null }
  total: StatCounts & IdentityCounts
  perMenu: MenuStatRow[]
  daily: DailyRow[]
  hourly: HourRow[]
  weekday: WeekdayRow[]
  users: CohortStats
}

export async function fetchAdminMenus(): Promise<AdminMenu[]> {
  const { data } = await client.get<AdminMenu[]>('/admin/menus')
  return data
}

/**
 * 기간은 `YYYY-MM-DD` (한국 날짜 기준, 양 끝 포함). 비우면 그쪽 방향으로 제한이 없다.
 * 서버가 날짜 경계를 KST 로 잡으므로 클라이언트는 타임존을 만지지 않는다.
 */
export async function fetchAdminStats(range: { from?: string; to?: string } = {}): Promise<AdminStats> {
  const params: Record<string, string> = {}
  if (range.from) params.from = range.from
  if (range.to) params.to = range.to
  const { data } = await client.get<AdminStats>('/admin/stats', { params })
  return data
}

/**
 * 메뉴 수정·삭제는 이제 관리자 전용이 아니다 — 등록자 본인도 자기 메뉴에 쓴다.
 * 정의는 `api/menus.ts` 로 옮겼고, 여기서는 기존 import 를 깨지 않으려고 다시 내보낸다.
 */
export { patchMenu, deleteMenu, type MenuPatch } from './menus'

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

/** 마이페이지도 같은 형식을 읽으므로 `api/client.ts` 로 올렸다. 기존 import 를 위해 다시 내보낸다. */
export { errorOf } from './client'
