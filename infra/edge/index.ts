// 점메추 API — 명세서(Notion) 구현
//
// 배포 경로:  https://<project>.supabase.co/functions/v1/api/<path>
// 명세 경로:  /api/v1/<path>
// 리버스 프록시(또는 커스텀 도메인)에서 /api/v1/* → /functions/v1/api/* 로 rewrite 하면
// 명세 그대로의 URL 이 된다. 아래 라우터는 두 형태를 모두 받는다.
//
// verify_jwt=false 인 이유: 명세상 categories / recommend / auth.* / name-check 는
// 인증 불필요 또는 선택이다. 인증은 라우트별로 직접 검사한다.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleAdminRoute } from "./admin.ts";
import {
  clearCookie,
  corsHeaders,
  fail,
  parseCookies,
  reply,
  SESSION_HINT_COOKIE,
  setCookie,
  UUID_RE,
} from "./http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const IMAGE_BUCKET = "menu-images";
const AVATAR_BUCKET = "avatars";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 썸네일로만 쓰이므로 메뉴 이미지보다 작게 잡는다
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const BUDGET_TIERS = [
  "UNDER_5000",
  "W5000_10000",
  "W10000_15000",
  "W15000_20000",
  "OVER_20000",
];

const ACCESS_COOKIE_MAX_AGE = 60 * 60;            // 1시간 — accessToken 수명과 일치
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일
const UID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 0-2: JWT 가 있으면 JWT 우선, 없으면 accessToken 쿠키. */
function bearerToken(req: Request, cookies: Record<string, string>): string | null {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    // Supabase 게이트웨이가 붙이는 anon key 는 사용자 토큰이 아니다.
    if (token && token !== ANON_KEY) return token;
  }
  return cookies["accessToken"] ?? null;
}

interface Viewer {
  authUserId: string;
  userNo: number;
  email: string | null;
  nickname: string;
  /** 소셜 공급자가 준 외부 URL 이거나 avatars 버킷 URL. 둘 다 없으면 null. */
  avatarUrl: string | null;
  /** 카테고리·이형어·메뉴 관리 권한 (명세의 "매니저"). */
  isManager: boolean;
}

async function resolveViewer(token: string | null): Promise<Viewer | null> {
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("user_no, nickname, avatar_url, is_manager")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) return null;
  return {
    authUserId: data.user.id,
    userNo: profile.user_no,
    email: data.user.email ?? null,
    nickname: profile.nickname,
    avatarUrl: profile.avatar_url ?? null,
    isManager: profile.is_manager === true,
  };
}

/**
 * 메뉴 사진으로 허용하는 URL 접두사.
 * 클라이언트가 보낸 주소를 그대로 믿으면 남의 서버 이미지를 우리 메뉴로 걸 수 있다 (0-3).
 */
function menuImagePrefixes(): string[] {
  const cdn = Deno.env.get("MENU_IMAGE_CDN_BASE");
  return [
    publicUrlPrefix(IMAGE_BUCKET),
    ...(cdn ? [cdn.replace(/\/+$/, "") + "/"] : []),
  ];
}

/** 0-1: 사용자 표현. /auth/me 와 프로필 사진 응답이 같은 모양을 쓰도록 한곳에 모은다. */
function viewerBody(viewer: Viewer, avatarUrl: string | null = viewer.avatarUrl) {
  return {
    id: viewer.userNo,
    email: viewer.email,
    nickname: viewer.nickname,
    profileImageUrl: avatarUrl,
  };
}

/** 업로드 파트 검증 결과. 실패면 그대로 응답으로 돌려보낸다. */
type FilePart = { ok: true; file: File; ext: string } | { ok: false; response: Response };

async function readImagePart(
  req: Request,
  origin: string | null,
  maxBytes: number,
): Promise<FilePart> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return {
      ok: false,
      response: fail("VALIDATION_ERROR", "multipart/form-data 요청이 아닙니다.", origin, {
        fields: ["file"],
      }),
    };
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      response: fail("VALIDATION_ERROR", "file 파트가 필요합니다.", origin, { fields: ["file"] }),
    };
  }

  const ext = MIME_EXT[file.type];
  if (!ext) {
    return {
      ok: false,
      response: fail("VALIDATION_ERROR", "jpg / png / webp 만 업로드할 수 있어요.", origin, {
        fields: ["file"],
        allowedMimeTypes: Object.keys(MIME_EXT),
      }),
    };
  }
  if (file.size > maxBytes) {
    const maxSizeMb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      response: fail("FILE_TOO_LARGE", `이미지는 최대 ${maxSizeMb}MB까지 올릴 수 있어요.`, origin, {
        maxSizeMb,
      }),
    };
  }

  return { ok: true, file, ext };
}

function publicUrlPrefix(bucket: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/`;
}

/**
 * 우리 버킷에 남아 있던 옛 프로필 사진을 지운다.
 * 소셜 공급자의 외부 URL 은 우리 것이 아니므로 건너뛴다.
 * 삭제 실패는 고아 파일 하나가 남는 것뿐이라 요청 전체를 실패시키지 않는다.
 */
async function deleteOwnAvatar(url: string | null): Promise<void> {
  const prefix = publicUrlPrefix(AVATAR_BUCKET);
  if (!url || !url.startsWith(prefix)) return;
  const objectPath = url.slice(prefix.length);
  if (!objectPath) return;
  const { error } = await admin.storage.from(AVATAR_BUCKET).remove([objectPath]);
  if (error) console.error("[api] avatar cleanup failed", { objectPath, error: error.message });
}

/** 비로그인 식별자. 없으면 새로 발급하고 Set-Cookie 대상으로 표시한다. */
function resolveUid(cookies: Record<string, string>): { uid: string; isNew: boolean } {
  const existing = cookies["uid"];
  if (existing && UUID_RE.test(existing)) return { uid: existing, isNew: false };
  return { uid: crypto.randomUUID(), isNew: true };
}

function rpcFailure(payload: Record<string, unknown>, origin: string | null, cookies: string[] = []) {
  return fail(
    String(payload.code ?? "INTERNAL_ERROR"),
    String(payload.message ?? "처리 중 오류가 발생했습니다."),
    origin,
    payload.detail ?? {},
    cookies,
  );
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

interface SessionLike {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

/**
 * 토큰 응답 공통 형태.
 * 웹은 HttpOnly 쿠키만으로 충분하고, 모바일은 body 값을 저장해 Bearer 로 보낸다 (0-2).
 * refreshToken 은 매 재발급마다 회전(rotation)한다.
 */
function sessionReply(
  session: SessionLike,
  origin: string | null,
  extraCookies: string[] = [],
): Response {
  return reply({
    status: 200,
    body: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      tokenType: "Bearer",
      expiresIn: session.expires_in ?? ACCESS_COOKIE_MAX_AGE,
    },
    cookies: [
      setCookie("accessToken", session.access_token, ACCESS_COOKIE_MAX_AGE),
      setCookie("refreshToken", session.refresh_token, REFRESH_COOKIE_MAX_AGE),
      // 클라이언트가 읽을 수 있는 유일한 쿠키. 세션 수명은 refreshToken 이 결정하므로 함께 간다.
      setCookie(SESSION_HINT_COOKIE, "1", REFRESH_COOKIE_MAX_AGE, { httpOnly: false }),
      ...extraCookies,
    ],
    origin,
  });
}

/** 세션 종료 시 세 쿠키를 함께 지운다. 하나라도 남으면 클라이언트 판단이 어긋난다. */
function clearSessionCookies(): string[] {
  return [
    clearCookie("accessToken"),
    clearCookie("refreshToken"),
    clearCookie(SESSION_HINT_COOKIE, { httpOnly: false }),
  ];
}

/** 로그인 성공 공통 처리: uid 이력 이전 + 토큰 발급 (인증 페이지 명세). */
async function completeLogin(
  session: SessionLike,
  authUserId: string,
  cookies: Record<string, string>,
  origin: string | null,
): Promise<Response> {
  const extra: string[] = [];

  const existingUid = cookies["uid"];
  if (existingUid && UUID_RE.test(existingUid)) {
    await admin.rpc("claim_anonymous_history", {
      p_uid: existingUid,
      p_user_id: authUserId,
    });
    // 이전 완료 후 uid 쿠키는 삭제한다.
    extra.push(clearCookie("uid"));
  }

  return sessionReply(session, origin, extra);
}

/**
 * 공급자 콘솔에 등록해 둔 redirect_uri 목록. 쉼표로 구분한다.
 *
 * 환경이 배포 하나였을 때는 값도 하나면 됐지만, 로컬 개발까지 받으려면 여러 개가 필요하다.
 * **이름이 복수형인 건 값이 목록이라는 뜻이다** — 단수형으로 착각해 주소 하나만 넣으면
 * 나머지 환경의 로그인이 조용히 막힌다.
 */
function allowedRedirectUris(provider: "google" | "kakao"): string[] {
  const prefix = provider === "google" ? "GOOGLE" : "KAKAO";
  const raw = Deno.env.get(`${prefix}_REDIRECT_URIS`) ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

type ExchangeResult =
  | { ok: true; idToken: string }
  | { ok: false; code: "REDIRECT_URI_NOT_ALLOWED" | "INVALID_AUTH_CODE" };

/**
 * 인가 코드 → id_token 교환. Supabase 의 signInWithIdToken 으로 넘긴다.
 *
 * redirect_uri 는 인가 요청 때 쓴 값과 **바이트 단위로 같아야** 공급자가 받아준다(코드
 * 가로채기 방지). 그런데 그 값을 정하는 건 브라우저의 origin 이라 서버가 미리 알 수 없다.
 * 그래서 클라이언트가 실어 보낸 값을 쓰되, 받은 값을 그대로 교환에 넣지는 않고 허용
 * 목록으로 검증한다.
 *
 * 비교는 **완전 일치**여야 한다. startsWith 로 하면
 * `https://jeommechu.co.kr.evil.com/oauth/kakao` 같은 주소가 통과한다.
 */
async function exchangeSocialCode(
  provider: "google" | "kakao",
  code: string,
  requestedRedirectUri: string,
): Promise<ExchangeResult> {
  const conf = provider === "google"
    ? {
      endpoint: "https://oauth2.googleapis.com/token",
      clientId: Deno.env.get("GOOGLE_CLIENT_ID"),
      clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
    }
    : {
      endpoint: "https://kauth.kakao.com/oauth/token",
      clientId: Deno.env.get("KAKAO_CLIENT_ID"),
      clientSecret: Deno.env.get("KAKAO_CLIENT_SECRET"),
    };

  const allowed = allowedRedirectUris(provider);
  if (!conf.clientId || allowed.length === 0) {
    throw new Error(`${provider} OAuth 환경변수가 설정되지 않았습니다.`);
  }

  // 옛 클라이언트는 redirectUri 를 보내지 않는다. 그때는 목록의 첫 값을 쓴다 —
  // 배포 도메인을 맨 앞에 두면 기존 동작이 그대로 유지된다.
  const redirectUri = requestedRedirectUri || allowed[0];
  if (!allowed.includes(redirectUri)) {
    console.error("[api] redirect_uri not allowed", { provider, requestedRedirectUri });
    return { ok: false, code: "REDIRECT_URI_NOT_ALLOWED" };
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: conf.clientId,
    redirect_uri: redirectUri,
    code,
  });
  if (conf.clientSecret) form.set("client_secret", conf.clientSecret);

  const res = await fetch(conf.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: form,
  });
  if (!res.ok) {
    // 공급자가 왜 거절했는지 버리면 단서가 전혀 남지 않는다. redirect_uri 불일치가
    // "인가 코드가 유효하지 않다"로 보이는 바람에 한참을 헤맨 적이 있다.
    console.error("[api] token exchange failed", {
      provider,
      redirectUri,
      status: res.status,
      body: await res.text(),
    });
    return { ok: false, code: "INVALID_AUTH_CODE" };
  }

  const payload = await res.json();
  return typeof payload.id_token === "string"
    ? { ok: true, idToken: payload.id_token }
    : { ok: false, code: "INVALID_AUTH_CODE" };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // /functions/v1/api/... 와 프록시된 /api/v1/... 을 모두 같은 경로로 정규화한다.
  let path = new URL(req.url).pathname;
  path = path.replace(/^\/functions\/v1/, "");
  path = path.replace(/^\/api(?=\/|$)/, "");
  path = path.replace(/^\/v1(?=\/|$)/, "");
  const seg = path.split("/").filter(Boolean);

  const cookies = parseCookies(req);
  const token = bearerToken(req, cookies);

  // resolveViewer 는 DB 를 왕복한다. 한 요청 안에서 여러 번 부르지 않도록 한 번만 계산한다.
  let viewerOnce: Promise<Viewer | null> | null = null;
  const getViewer = () => (viewerOnce ??= resolveViewer(token));

  try {
    // 관리자 라우트를 먼저 본다. PATCH/DELETE /menus/{id} 는 아래 공개 라우트의
    // "GET 아니면 METHOD_NOT_ALLOWED" 에 먼저 걸려버리기 때문이다.
    // 맡을 경로가 아니면 null 이 와서 그대로 아래로 흘러간다.
    const handled = await handleAdminRoute({
      req,
      seg,
      origin,
      db: admin,
      getViewer,
      readJson,
      budgetTiers: BUDGET_TIERS,
      imagePrefixes: menuImagePrefixes(),
    });
    if (handled) return handled;

    // ---- GET /categories ------------------------------------------------
    if (seg[0] === "categories" && seg.length === 1) {
      if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
      const { data, error } = await admin
        .from("categories")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return reply({ status: 200, body: data, origin });
    }

    // ---- GET /recommend -------------------------------------------------
    if (seg[0] === "recommend" && seg.length === 1) {
      if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);

      const params = new URL(req.url).searchParams;
      const fields: string[] = [];

      let people: number | null = null;
      const rawPeople = params.get("people");
      if (rawPeople !== null && rawPeople !== "") {
        people = Number(rawPeople);
        if (!Number.isInteger(people) || people < 1) fields.push("people");
      }

      let budgetTier: string | null = params.get("budgetTier");
      if (budgetTier === "") budgetTier = null;
      if (budgetTier !== null && !BUDGET_TIERS.includes(budgetTier)) fields.push("budgetTier");

      // 반복 파라미터. 구버전 단수형 categoryId 도 받아준다.
      const rawCategories = [...params.getAll("categoryIds"), ...params.getAll("categoryId")];
      const categoryIds: number[] = [];
      for (const raw of rawCategories) {
        for (const piece of raw.split(",")) {
          if (piece.trim() === "") continue;
          const n = Number(piece);
          if (!Number.isInteger(n) || n < 1) fields.push("categoryIds");
          else categoryIds.push(n);
        }
      }

      if (fields.length > 0) {
        return fail("VALIDATION_ERROR", "잘못된 요청입니다.", origin, { fields: [...new Set(fields)] });
      }

      const viewer = await getViewer();
      const outgoing: string[] = [];
      let uid: string | null = null;
      if (!viewer) {
        const resolved = resolveUid(cookies);
        uid = resolved.uid;
        if (resolved.isNew) outgoing.push(setCookie("uid", uid, UID_COOKIE_MAX_AGE));
      }

      const { data, error } = await admin.rpc("recommend_menu", {
        p_people: people,
        p_budget_tier: budgetTier,
        p_category_ids: categoryIds.length > 0 ? categoryIds : null,
        p_user_id: viewer?.authUserId ?? null,
        p_uid: uid,
      });
      if (error) throw error;
      if (!data.ok) return rpcFailure(data, origin, outgoing);

      return reply({
        status: 200,
        body: { recommendationId: data.recommendationId, menu: data.menu },
        cookies: outgoing,
        origin,
      });
    }

    // ---- POST /recommendations/{id}/action ------------------------------
    if (seg[0] === "recommendations" && seg.length === 3 && seg[2] === "action") {
      if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);

      const recommendationId = Number(seg[1]);
      if (!Number.isInteger(recommendationId) || recommendationId < 1) {
        return fail("VALIDATION_ERROR", "잘못된 요청입니다.", origin, { fields: ["recommendationId"] });
      }

      const body = await readJson(req);
      const action = body?.action;
      if (action !== "chosen" && action !== "skipped") {
        return fail("VALIDATION_ERROR", "action 은 chosen 또는 skipped 여야 합니다.", origin, {
          fields: ["action"],
        });
      }

      const viewer = await getViewer();
      const uid = viewer ? null : (cookies["uid"] && UUID_RE.test(cookies["uid"]) ? cookies["uid"] : null);

      const { data, error } = await admin.rpc("record_recommendation_action", {
        p_recommendation_id: recommendationId,
        p_action: action,
        p_user_id: viewer?.authUserId ?? null,
        p_uid: uid,
      });
      if (error) throw error;
      if (!data.ok) return rpcFailure(data, origin);

      return reply({ status: 200, origin });
    }

    // ---- /auth/* --------------------------------------------------------
    if (seg[0] === "auth") {
      // POST /auth/register
      if (seg[1] === "register" && seg.length === 2 && req.method === "POST") {
        const body = await readJson(req);
        const email = typeof body?.email === "string" ? body.email.trim() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        const fields: string[] = [];
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.push("email");
        // bcrypt 는 72바이트를 넘는 비밀번호를 받지 못한다. 인증 서버의 영어 에러 문구에
        // 의존하지 말고 여기서 확정적으로 막는다. (한글은 1자가 3바이트다.)
        const passwordBytes = new TextEncoder().encode(password).length;
        if (password.length < 8 || passwordBytes > 72) fields.push("password");
        if (fields.length > 0) {
          return fail("VALIDATION_ERROR", "이메일 또는 비밀번호 형식이 올바르지 않아요.", origin, { fields });
        }

        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) {
          const message = error?.message ?? "";
          if (error?.code === "email_exists" || /already/i.test(message)) {
            return fail("EMAIL_ALREADY_EXISTS", "이미 사용 중인 이메일이에요.", origin);
          }
          // 여기까지 온 실패는 형식이 아니라 서버 정책(대시보드 설정) 위반이다.
          // 매핑되지 않는 케이스를 나중에 추적할 수 있도록 원본을 남긴다.
          console.error("[api] register failed", { code: error?.code, message });
          const isPasswordIssue = error?.code === "weak_password" || /password/i.test(message);
          return fail(
            "VALIDATION_ERROR",
            isPasswordIssue
              ? "비밀번호가 조건에 맞지 않아요. 더 길거나 복잡하게 만들어 주세요."
              : "회원가입에 실패했어요. 입력값을 확인해 주세요.",
            origin,
            { fields: [isPasswordIssue ? "password" : "email"] },
          );
        }

        const { data: profile } = await admin
          .from("profiles")
          .select("user_no, nickname")
          .eq("id", data.user.id)
          .maybeSingle();

        return reply({
          status: 201,
          body: { id: profile?.user_no ?? null, email, nickname: profile?.nickname ?? null },
          origin,
        });
      }

      // POST /auth/login
      if (seg[1] === "login" && seg.length === 2 && req.method === "POST") {
        const body = await readJson(req);
        const email = typeof body?.email === "string" ? body.email.trim() : "";
        const password = typeof body?.password === "string" ? body.password : "";

        const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
        if (error || !data.session) {
          return fail("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않아요.", origin);
        }
        return await completeLogin(data.session, data.user!.id, cookies, origin);
      }

      // POST /auth/refresh — accessToken 재발급 (refreshToken 회전)
      if (seg[1] === "refresh" && seg.length === 2 && req.method === "POST") {
        const body = await readJson(req);
        const refreshToken = typeof body?.refreshToken === "string" && body.refreshToken.trim() !== ""
          ? body.refreshToken.trim()
          : cookies["refreshToken"];

        if (!refreshToken) {
          return fail("INVALID_REFRESH_TOKEN", "다시 로그인해 주세요.", origin, {}, clearSessionCookies());
        }

        const { data, error } = await anonClient().auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (error || !data.session) {
          return fail("INVALID_REFRESH_TOKEN", "다시 로그인해 주세요.", origin, {}, clearSessionCookies());
        }
        return sessionReply(data.session, origin);
      }

      // POST /auth/kakao | POST /auth/google
      if ((seg[1] === "kakao" || seg[1] === "google") && seg.length === 2 && req.method === "POST") {
        const provider = seg[1] as "kakao" | "google";
        const body = await readJson(req);
        const code = typeof body?.code === "string" ? body.code.trim() : "";
        if (!code) {
          return fail("INVALID_AUTH_CODE", "유효하지 않은 인가 코드입니다.", origin);
        }
        // 클라이언트가 인가 요청에 쓴 값. 없으면 목록의 첫 값으로 폴백한다.
        const requestedRedirectUri = typeof body?.redirectUri === "string"
          ? body.redirectUri.trim()
          : "";

        const exchanged = await exchangeSocialCode(provider, code, requestedRedirectUri);
        if (!exchanged.ok) {
          if (exchanged.code === "REDIRECT_URI_NOT_ALLOWED") {
            return fail(
              "REDIRECT_URI_NOT_ALLOWED",
              "허용되지 않은 redirect_uri 입니다.",
              origin,
              { redirectUri: requestedRedirectUri },
            );
          }
          return fail("INVALID_AUTH_CODE", "유효하지 않은 인가 코드입니다.", origin);
        }

        const { data, error } = await anonClient().auth.signInWithIdToken({
          provider,
          token: exchanged.idToken,
        });
        if (error || !data.session) {
          return fail("INVALID_AUTH_CODE", "유효하지 않은 인가 코드입니다.", origin);
        }
        return await completeLogin(data.session, data.user!.id, cookies, origin);
      }

      // GET /auth/me
      if (seg[1] === "me" && seg.length === 2 && req.method === "GET") {
        const viewer = await getViewer();
        if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);
        return reply({ status: 200, body: viewerBody(viewer), origin });
      }

      // POST /auth/me/image   — 프로필 사진 등록·교체
      // DELETE /auth/me/image — 프로필 사진 삭제 (이니셜로 되돌림)
      if (seg[1] === "me" && seg[2] === "image" && seg.length === 3) {
        if (req.method !== "POST" && req.method !== "DELETE") {
          return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
        }

        const viewer = await getViewer();
        if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);

        let nextUrl: string | null = null;

        if (req.method === "POST") {
          const part = await readImagePart(req, origin, MAX_AVATAR_BYTES);
          if (!part.ok) return part.response;

          // 사용자별 폴더에 둔다. 나중에 계정을 지울 때 폴더째 비우면 된다.
          const objectPath = `${viewer.authUserId}/${crypto.randomUUID()}.${part.ext}`;
          const { error } = await admin.storage
            .from(AVATAR_BUCKET)
            .upload(objectPath, await part.file.arrayBuffer(), {
              contentType: part.file.type,
              upsert: false,
            });
          if (error) throw error;

          nextUrl = admin.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath).data.publicUrl;
        }

        const { error: updateError } = await admin
          .from("profiles")
          .update({ avatar_url: nextUrl })
          .eq("id", viewer.authUserId);
        if (updateError) {
          // DB 가 안 바뀌었으면 방금 올린 파일은 아무도 참조하지 않는다. 바로 회수한다.
          await deleteOwnAvatar(nextUrl);
          throw updateError;
        }

        // 참조가 끊긴 뒤에 지운다. 순서가 반대면 실패 시 사진 없는 계정이 된다.
        await deleteOwnAvatar(viewer.avatarUrl);

        return reply({ status: 200, body: viewerBody(viewer, nextUrl), origin });
      }

      // POST /auth/logout
      if (seg[1] === "logout" && seg.length === 2 && req.method === "POST") {
        const viewer = await getViewer();
        if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);
        // 세션을 폐기하면 해당 refreshToken 도 함께 무효화된다.
        if (token) await admin.auth.admin.signOut(token, "local");
        return reply({
          status: 200,
          cookies: clearSessionCookies(),
          origin,
        });
      }
    }

    // ---- GET /menus/name-check ------------------------------------------
    if (seg[0] === "menus" && seg[1] === "name-check" && seg.length === 2) {
      if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
      const name = (new URL(req.url).searchParams.get("name") ?? "").trim();
      if (name.length < 1 || name.length > 30) {
        return fail("VALIDATION_ERROR", "메뉴 이름은 1~30자여야 합니다.", origin, { fields: ["name"] });
      }
      const { data, error } = await admin.rpc("check_menu_name", { p_name: name });
      if (error) throw error;
      return reply({ status: 200, body: data, origin });
    }

    // ---- GET /menus/{id} -------------------------------------------------
    // 공유 링크로 들어온 사람이 보는 화면의 데이터. 비로그인도 봐야 하므로 인증 없음.
    // 숫자 세그먼트만 받는다 — 위의 name-check 와 경로 길이가 같기 때문이다.
    if (seg[0] === "menus" && seg.length === 2 && /^\d+$/.test(seg[1])) {
      if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);

      const menuId = Number(seg[1]);
      if (!Number.isSafeInteger(menuId) || menuId < 1) {
        return fail("VALIDATION_ERROR", "잘못된 요청입니다.", origin, { fields: ["menuId"] });
      }

      const { data, error } = await admin.rpc("menu_detail_json", { p_menu_id: menuId });
      if (error) throw error;
      // 함수는 없는 메뉴에 null 을 돌려준다.
      if (!data) return fail("NOT_FOUND", "존재하지 않는 메뉴입니다.", origin, { menuId });

      return reply({ status: 200, body: data, origin });
    }

    // ---- POST /images ----------------------------------------------------
    if (seg[0] === "images" && seg.length === 1) {
      if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);

      const viewer = await getViewer();
      if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);

      const part = await readImagePart(req, origin, MAX_IMAGE_BYTES);
      if (!part.ok) return part.response;

      const objectPath = `menus/${crypto.randomUUID()}.${part.ext}`;
      const { error } = await admin.storage
        .from(IMAGE_BUCKET)
        .upload(objectPath, await part.file.arrayBuffer(), {
          contentType: part.file.type,
          upsert: false,
        });
      if (error) throw error;

      const { data: pub } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(objectPath);
      return reply({ status: 201, body: { imageUrl: pub.publicUrl }, origin });
    }

    // ---- POST /menus -----------------------------------------------------
    if (seg[0] === "menus" && seg.length === 1) {
      if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);

      const viewer = await getViewer();
      if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);

      const body = await readJson(req);
      if (!body) return fail("VALIDATION_ERROR", "본문이 올바르지 않습니다.", origin, { fields: ["body"] });

      const fields: string[] = [];
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 30) fields.push("name");

      const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds : [];
      if (categoryIds.length < 1 || !categoryIds.every((v) => Number.isInteger(v) && (v as number) > 0)) {
        fields.push("categoryIds");
      }

      const budgetTier = typeof body.budgetTier === "string" ? body.budgetTier : "";
      if (!BUDGET_TIERS.includes(budgetTier)) fields.push("budgetTier");

      const minPeople = body.minPeople;
      const maxPeople = body.maxPeople;
      if (!Number.isInteger(minPeople) || (minPeople as number) < 1) fields.push("minPeople");
      if (!Number.isInteger(maxPeople) || (maxPeople as number) < 1) fields.push("maxPeople");
      if (
        Number.isInteger(minPeople) && Number.isInteger(maxPeople) &&
        (minPeople as number) > (maxPeople as number)
      ) {
        fields.push("maxPeople");
      }

      const description = body.description == null ? null : String(body.description);
      if (description !== null && description.length > 50) fields.push("description");

      // 사진은 필수다. 그리고 우리 버킷/CDN 도메인만 허용한다 (클라이언트 값 불신 — 0-3).
      const imageUrl = body.imageUrl == null || body.imageUrl === "" ? null : String(body.imageUrl);
      if (imageUrl === null) {
        fields.push("imageUrl");
      } else {
        if (!menuImagePrefixes().some((p) => imageUrl.startsWith(p))) fields.push("imageUrl");
      }

      if (fields.length > 0) {
        return fail("VALIDATION_ERROR", "입력값을 다시 확인해 주세요.", origin, {
          fields: [...new Set(fields)],
        });
      }

      const { data, error } = await admin.rpc("create_menu", {
        p_user_id: viewer.authUserId,
        p_name: name,
        p_category_ids: categoryIds,
        p_budget_tier: budgetTier,
        p_min_people: minPeople,
        p_max_people: maxPeople,
        p_image_url: imageUrl,
        p_description: description,
        p_confirmed_distinct: body.confirmedDistinct === true,
      });
      if (error) throw error;
      if (!data.ok) return rpcFailure(data, origin);

      return reply({ status: 201, body: data.menu, origin });
    }

    return fail("NOT_FOUND", "존재하지 않는 엔드포인트입니다.", origin, { path });
  } catch (err) {
    console.error("[api] unhandled", { path, method: req.method, err: String(err) });
    return fail("INTERNAL_ERROR", "서버 내부 오류가 발생했습니다.", origin);
  }
});
