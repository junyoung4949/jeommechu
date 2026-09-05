import client from './client'

export interface Category {
  id: number
  name: string
}

/** GET /api/v1/categories → [{ id, name }] (명세 0-5: 읽기 응답은 객체 배열) */
export async function fetchCategories(): Promise<Category[]> {
  const { data } = await client.get<Category[]>('/categories')
  return data
}
