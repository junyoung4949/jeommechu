// 공통 규약 0-1 / 0-4 구현 헬퍼

export const JSON_CONTENT_TYPE = "application/json; charset=UTF-8";

// 0-4 에러코드 → HTTP status. body 에 status 를 중복 기재하지 않는다.
export const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INVALID_AUTH_CODE: 400,
  REDIRECT_URI_NOT_ALLOWED: 400,
  INVALID_CREDENTIALS: 401,
  INVALID_REFRESH_TOKEN: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RECOMMENDATION_NOT_FOUND: 404,
  NO_MENU_FOUND: 404,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  EMAIL_ALREADY_EXISTS: 409,
  NICKNAME_TAKEN: 409,
  DUPLICATE_MENU: 409,
  SIMILAR_NOT_CONFIRMED: 409,
  CASCADE_NOT_CONFIRMED: 409,
  CATEGORY_IN_USE: 409,
  FILE_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://localhost:5173"];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) return DEFAULT_ORIGINS;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    // PATCH 가 빠지면 /menus/{id} 수정이 프리플라이트에서 막힌다. 실제로 한 번 그랬다.
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Vary": "Origin",
  };
  // 쿠키를 쓰므로 와일드카드 오리진은 사용할 수 없다.
  if (origin && allowedOrigins().includes(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
    base["Access-Control-Allow-Credentials"] = "true";
  }
  return base;
}

// 0-2 쿠키 속성: 발급·삭제 모두 동일하게 맞춘다.
//
// 토큰은 HttpOnly 라 JS 가 읽을 수 없다. 그래서 클라이언트는 "로그인한 적 없는 사람"과
// "토큰만 만료된 사람"을 구분하지 못하고, 일단 요청을 던져 401 을 받아야만 알 수 있다.
// 그 구분에 쓰라고 값 없는 표식 쿠키 하나를 HttpOnly 없이 함께 내려보낸다.
// 자격 증명이 아니므로 위조돼도 위험하지 않다 — 서버는 이 쿠키를 신뢰하지 않는다.
function cookieAttrs(httpOnly: boolean): string {
  return `Path=/${httpOnly ? "; HttpOnly" : ""}; Secure; SameSite=Lax`;
}

export function setCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  options: { httpOnly?: boolean } = {},
): string {
  const attrs = cookieAttrs(options.httpOnly ?? true);
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; ${attrs}`;
}

export function clearCookie(name: string, options: { httpOnly?: boolean } = {}): string {
  return `${name}=; Max-Age=0; ${cookieAttrs(options.httpOnly ?? true)}`;
}

/** 세션 존재 여부 힌트. 값에 의미는 없고 있고 없고만 본다. */
export const SESSION_HINT_COOKIE = "hasSession";

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.get("cookie");
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export interface ReplyInit {
  status: number;
  body?: unknown;
  cookies?: string[];
  origin: string | null;
}

export function reply({ status, body, cookies = [], origin }: ReplyInit): Response {
  const headers = new Headers(corsHeaders(origin));
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);

  if (body === undefined) return new Response(null, { status, headers });

  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { status, headers });
}

export function fail(
  code: string,
  message: string,
  origin: string | null,
  detail: unknown = {},
  cookies: string[] = [],
): Response {
  return reply({
    status: ERROR_STATUS[code] ?? 500,
    body: { code, message, detail },
    cookies,
    origin,
  });
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
