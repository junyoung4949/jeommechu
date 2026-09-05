import client from './client'

export interface AuthResponse {
  accessToken: string
  /** 재발급용. 호출할 때마다 새 값이 내려오므로 보관한다면 항상 최신 값으로 교체할 것. */
  refreshToken: string
  tokenType: string
  /** accessToken 잔여 수명(초). 기본 3600. */
  expiresIn: number
}

export interface MeResponse {
  id: number
  /** 소셜 로그인 사용자는 null 일 수 있다. */
  email: string | null
  nickname: string
  /**
   * 소셜 공급자가 준 외부 URL 이거나 우리 버킷에 올린 URL.
   * 둘 다 없으면 null — 이 경우 클라이언트는 닉네임 이니셜을 그린다.
   */
  profileImageUrl: string | null
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/login', { email, password })
  return data
}

export interface RegisterResponse {
  id: number
  email: string
  nickname: string
}

export async function register(email: string, password: string): Promise<RegisterResponse> {
  const { data } = await client.post<RegisterResponse>('/auth/register', { email, password })
  return data
}

export async function kakaoLogin(code: string): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/kakao', { code })
  return data
}

export async function googleLogin(code: string): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/google', { code })
  return data
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await client.get<MeResponse>('/auth/me')
  return data
}

export async function logout(): Promise<void> {
  await client.post('/auth/logout')
}

/** 프로필 사진 허용 조건. 서버와 같은 값이며, 굳이 왕복하지 않고 미리 걸러내려고 둔다. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 등록·교체 모두 이 하나로 처리한다. 옛 사진 정리는 서버가 한다. */
export async function uploadProfileImage(file: File): Promise<MeResponse> {
  const form = new FormData()
  form.append('file', file)
  // boundary 는 axios 가 채워 넣는다. 인스턴스 기본값(application/json)만 덮어쓰면 된다.
  const { data } = await client.post<MeResponse>('/auth/me/image', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function deleteProfileImage(): Promise<MeResponse> {
  const { data } = await client.delete<MeResponse>('/auth/me/image')
  return data
}
