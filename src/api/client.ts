import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * accessToken 은 1시간 뒤 만료된다. 그때마다 로그아웃시키지 않기 위해
 * 401 을 받으면 /auth/refresh 로 재발급한 뒤 원래 요청을 한 번 재시도한다.
 *
 * 토큰은 HttpOnly 쿠키로만 오간다. 클라이언트가 값을 읽거나 보관하지 않으므로
 * 재발급 호출도 본문 없이 던지면 되고, 갱신된 쿠키는 브라우저가 알아서 갈아끼운다.
 */

/**
 * 세션 존재 힌트. 로그인 시 서버가 토큰과 함께 내려주는 유일한 non-HttpOnly 쿠키다.
 *
 * 이게 없으면 클라이언트는 "로그인한 적 없는 사람"과 "토큰만 만료된 사람"을 구분하지 못해
 * 방문할 때마다 /auth/me → /auth/refresh 를 던지고 401 두 번을 받는다.
 * 자격 증명이 아니라 힌트일 뿐이므로 위조돼도 안전하다 — 실제 인증은 서버가 토큰으로 한다.
 */
const SESSION_HINT_COOKIE = 'hasSession'

export function hasSessionHint(): boolean {
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${SESSION_HINT_COOKIE}=`))
}

/** 아래 경로들은 401 자체가 정상 응답이므로 재시도하지 않는다. (특히 refresh 는 무한 루프 방지) */
const NO_RETRY_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/kakao',
  '/auth/google',
]

/**
 * 동시에 여러 요청이 401 을 받아도 재발급은 한 번만 수행하고
 * 나머지는 그 결과를 기다린다. 병렬로 호출하면 refreshToken 이 여러 번 회전해
 * 유예 시간을 넘긴 뒤늦은 호출이 401 을 받게 된다.
 */
let refreshing: Promise<void> | null = null

function refreshOnce(): Promise<void> {
  refreshing ??= client
    .post('/auth/refresh')
    .then(() => undefined)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined

    if (error.response?.status !== 401 || !config || config._retried) throw error
    if (NO_RETRY_PATHS.some((path) => (config.url ?? '').startsWith(path))) throw error
    // 세션이 있었던 적이 없으면 재발급을 시도할 이유가 없다.
    if (!hasSessionHint()) throw error

    config._retried = true

    try {
      await refreshOnce()
    } catch {
      // 재발급도 실패 = 세션이 끝났다. 원래의 401 을 그대로 올려보낸다.
      throw error
    }

    return client(config)
  },
)

export default client
