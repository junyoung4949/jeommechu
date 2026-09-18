// 마이페이지 라우트 — 내 계정과 내가 등록한 메뉴.
//
// ## 왜 별도 파일인가
//
// index.ts 의 `/auth/*` 블록은 이미 로그인·소셜·토큰 재발급으로 길다. 여기 들어오는 것들은
// 인증 흐름이 아니라 **내 것을 읽고 고치는** 일이라 성격이 다르고, 순위 계산처럼 제법 긴
// 로직이 딸려 온다. admin.ts 와 같은 방식으로 떼어내 index.ts 는 위임만 하게 둔다.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fail, reply } from "./http.ts";

export interface MeViewer {
  authUserId: string;
  userNo: number;
  email: string | null;
  nickname: string;
  avatarUrl: string | null;
  isManager: boolean;
}

export interface MeCtx {
  req: Request;
  /** 정규화된 경로 조각. 예: ["auth","me","menus"] */
  seg: string[];
  origin: string | null;
  /** service role 클라이언트 */
  db: SupabaseClient;
  getViewer: () => Promise<MeViewer | null>;
  readJson: (req: Request) => Promise<Record<string, unknown> | null>;
  /** `/auth/me` 와 같은 사용자 표현을 쓰기 위해 index.ts 의 것을 그대로 받는다. */
  viewerBody: (viewer: MeViewer, avatarUrl?: string | null) => unknown;
  /** 우리 버킷에 있는 프로필 사진만 지운다 (외부 URL 은 건너뛴다). */
  deleteOwnAvatar: (url: string | null) => Promise<void>;
  clearSessionCookies: () => string[];
  /** 프로필 사진 버킷 이름. 탈퇴할 때 폴더째 비우는 데 쓴다. */
  avatarBucket: string;
}

/** 닉네임 길이(문자 수). DB 체크는 1~20 이지만 화면과 맞춰 더 좁게 받는다. */
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 12;

/**
 * 순위를 매기는 최소 **응답** 수.
 *
 * 추천 수가 아니라 응답 수인 것이 핵심이다. 추천은 10번 받았어도 사람들이 아무 버튼도
 * 안 눌렀다면 그 메뉴에 대해 아는 게 없다. 실제로 추천 10회에 응답 2회인 메뉴가 있다.
 *
 * 5 로 잡은 근거: 현재 응답이 가장 많은 메뉴가 9건이라 10 으로 자르면 모든 메뉴가
 * "집계 중"이 되어 순위가 아무것도 못 보여준다. 기록이 쌓이면 이 숫자만 올리면 된다 —
 * 클라이언트는 응답에 실려 오는 값을 그대로 쓰므로 함께 배포할 필요가 없다.
 */
const MIN_RESPONSES = 5;

interface StatRow {
  menu_id: number;
  recommended: number | string;
  chosen: number | string;
  skipped: number | string;
  no_response: number | string;
  last_recommended_at: string | null;
}

/**
 * 마이페이지 라우트를 처리한다. **맡을 경로가 아니면 null** 을 돌려주므로
 * index.ts 는 그대로 다음 라우트로 넘어가면 된다.
 */
export async function handleMeRoute(ctx: MeCtx): Promise<Response | null> {
  const { req, seg, origin } = ctx;
  if (seg[0] !== "auth" || seg[1] !== "me") return null;

  // ── GET /auth/me/menus ───────────────────────────────────────────────
  if (seg.length === 3 && seg[2] === "menus") {
    if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
    return await myMenus(ctx);
  }

  // ── PATCH /auth/me · DELETE /auth/me ─────────────────────────────────
  if (seg.length === 2) {
    if (req.method === "PATCH") return await patchMe(ctx);
    if (req.method === "DELETE") return await deleteMe(ctx);
    return null; // GET 은 index.ts 가 맡는다
  }

  return null;
}

/* ─────────────────────────── 내 메뉴 성적 ─────────────────────────── */

/**
 * 내가 등록한 메뉴와 그 성적.
 *
 * 순위를 서버가 매기는 이유: 클라이언트는 남의 메뉴 통계를 모른다. 등수와 모집단 크기를
 * 함께 내려보내야 "6개 중 1위"를 쓸 수 있다.
 */
async function myMenus(ctx: MeCtx): Promise<Response> {
  const { db, origin } = ctx;
  const viewer = await ctx.getViewer();
  if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);

  // 통계는 내 메뉴만이 아니라 **전부** 읽는다. 순위의 분모가 전체이기 때문이다.
  const [minesRes, statsRes] = await Promise.all([
    db
      .from("menus")
      .select(
        "id, name, budget_tier, min_people, max_people, image_url, description, created_at, menu_categories(categories(id, name))",
      )
      .eq("created_by", viewer.authUserId)
      .order("created_at", { ascending: false }),
    db.from("admin_menu_stats").select("*"),
  ]);

  if (minesRes.error) throw minesRes.error;
  if (statsRes.error) throw statsRes.error;

  const allStats = (statsRes.data ?? []) as StatRow[];
  const statById = new Map(allStats.map((s) => [Number(s.menu_id), s]));

  const { rankById, rankedTotal } = rankMenus(allStats);
  const avgChosenRate = averageAdoption(allStats);

  const menus = (minesRes.data ?? []).map((m) => {
    const s = statById.get(Number(m.id));
    const chosen = Number(s?.chosen ?? 0);
    const skipped = Number(s?.skipped ?? 0);
    const position = rankById.get(Number(m.id)) ?? null;
    return {
      id: m.id,
      name: m.name,
      imageUrl: m.image_url,
      categories: (m.menu_categories ?? []).map(
        (mc: { categories: { id: number; name: string } }) => mc.categories,
      ),
      budgetTier: m.budget_tier,
      minPeople: m.min_people,
      maxPeople: m.max_people,
      description: m.description,
      createdAt: m.created_at,
      stats: {
        recommended: Number(s?.recommended ?? 0),
        chosen,
        skipped,
        noResponse: Number(s?.no_response ?? 0),
      },
      // 표본이 모자란 메뉴는 등수를 주지 않는다. 화면이 "집계 중"으로 바꿔 보여준다.
      rank: position === null ? null : { position, total: rankedTotal },
      lastRecommendedAt: s?.last_recommended_at ?? null,
    };
  });

  return reply({
    status: 200,
    body: { minResponses: MIN_RESPONSES, avgChosenRate, menus },
    origin,
  });
}

/**
 * 응답(채택+넘김) 중 채택 비율로 등수를 매긴다.
 *
 * 무응답을 분모에 넣지 않는 것은 관리자 화면의 '응답 중 채택률'과 같은 정의다 — 기록의
 * 3/4 가 무응답이라 넣으면 모든 메뉴가 10% 아래로 깔려 순서가 잡히지 않는다.
 *
 * 동점은 같은 등수로 묶는다(1, 1, 3 …). 채택률이 같은데 한쪽을 위에 세울 근거가 없다.
 */
function rankMenus(all: StatRow[]): { rankById: Map<number, number>; rankedTotal: number } {
  const ranked = all
    .map((s) => {
      const chosen = Number(s.chosen);
      const answered = chosen + Number(s.skipped);
      return { menuId: Number(s.menu_id), answered, rate: answered === 0 ? 0 : chosen / answered };
    })
    .filter((r) => r.answered >= MIN_RESPONSES)
    .sort((a, b) => b.rate - a.rate);

  const rankById = new Map<number, number>();
  let prevRate = Number.NaN;
  let prevPosition = 0;
  ranked.forEach((r, i) => {
    // 부동소수 비교라 그대로 === 하지 않는다. 4/9 와 8/18 은 같은 등수여야 한다.
    const tied = Math.abs(r.rate - prevRate) < 1e-9;
    const position = tied ? prevPosition : i + 1;
    rankById.set(r.menuId, position);
    prevRate = r.rate;
    prevPosition = position;
  });

  return { rankById, rankedTotal: ranked.length };
}

/** 전체 평균 채택률. 내 메뉴가 높은지 낮은지 견줄 기준선이다. 응답이 하나도 없으면 null. */
function averageAdoption(all: StatRow[]): number | null {
  let chosen = 0;
  let answered = 0;
  for (const s of all) {
    chosen += Number(s.chosen);
    answered += Number(s.chosen) + Number(s.skipped);
  }
  return answered === 0 ? null : chosen / answered;
}

/* ───────────────────────────── 닉네임 ───────────────────────────── */

async function patchMe(ctx: MeCtx): Promise<Response> {
  const { db, origin } = ctx;
  const viewer = await ctx.getViewer();
  if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);

  const body = (await ctx.readJson(ctx.req)) ?? {};
  // 지금 고칠 수 있는 건 닉네임뿐이다. 사진은 /auth/me/image 가 따로 맡는다.
  if (!("nickname" in body)) {
    return fail("VALIDATION_ERROR", "요청 값을 확인해 주세요.", origin, { fields: ["nickname"] });
  }

  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  // 한글 한 글자도 1 로 세도록 코드 포인트 단위로 센다.
  const length = [...nickname].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return fail("VALIDATION_ERROR", "요청 값을 확인해 주세요.", origin, {
      fields: ["nickname"],
      min: NICKNAME_MIN,
      max: NICKNAME_MAX,
    });
  }

  // 같은 값이면 DB 를 건드리지 않는다. 자기 닉네임과의 unique 충돌도 함께 피한다.
  if (nickname === viewer.nickname) {
    return reply({ status: 200, body: ctx.viewerBody(viewer), origin });
  }

  const { error } = await db.from("profiles").update({ nickname }).eq("id", viewer.authUserId);
  if (error) {
    // 미리 조회해서 확인하지 않는다 — 확인과 저장 사이에 남이 채갈 수 있어
    // 어차피 이 충돌을 다뤄야 한다. 23505 = unique_violation.
    if (error.code === "23505") {
      return fail("NICKNAME_TAKEN", "이미 사용 중인 닉네임입니다.", origin, { nickname });
    }
    throw error;
  }

  return reply({ status: 200, body: ctx.viewerBody({ ...viewer, nickname }), origin });
}

/* ────────────────────────────── 탈퇴 ────────────────────────────── */

/**
 * 계정 삭제.
 *
 * auth.users 를 지우면 나머지는 외래키가 정리한다:
 * - `profiles` → CASCADE 로 함께 삭제
 * - `menus.created_by` → **SET NULL**. 등록한 메뉴는 남고 등록자 표시만 끊긴다
 * - `recommendations.user_id` → CASCADE. **내가 받은 추천 기록은 함께 사라진다**
 *
 * 마지막 줄이 중요하다. 내가 등록한 메뉴는 남지만, 내가 받은 추천 기록이 지워지면서
 * 그 기록이 세어지던 메뉴들의 성적이 소급해서 줄어든다. 되돌릴 수 없으므로 화면에서
 * 한 번 확인받은 뒤에 여기까지 온다.
 */
async function deleteMe(ctx: MeCtx): Promise<Response> {
  const { db, origin } = ctx;
  const viewer = await ctx.getViewer();
  if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", origin);

  // 파일부터 지운다. 계정이 사라진 뒤에는 어느 폴더가 이 사람 것이었는지 알 수 없다.
  await deleteAvatarFolder(ctx, viewer);

  const { error } = await db.auth.admin.deleteUser(viewer.authUserId);
  if (error) throw error;

  // 계정이 사라졌으니 세션도 무효다. 브라우저에 남은 쿠키까지 함께 치운다.
  return reply({ status: 200, cookies: ctx.clearSessionCookies(), origin });
}

/**
 * 프로필 사진이 있던 폴더를 통째로 비운다.
 *
 * 업로드가 옛 파일을 지우므로 보통 한 장뿐이지만, 정리에 실패한 고아 파일이 남아 있을 수
 * 있다. 계정이 사라지면 아무도 그 폴더를 다시 찾지 못하므로 여기서 한 번에 비운다.
 * 삭제 실패는 파일이 남는 것뿐이라 탈퇴 자체를 막지 않는다.
 */
async function deleteAvatarFolder(ctx: MeCtx, viewer: MeViewer): Promise<void> {
  try {
    // 외부(소셜) URL 이면 이 호출이 알아서 건너뛴다.
    await ctx.deleteOwnAvatar(viewer.avatarUrl);

    const bucket = ctx.db.storage.from(ctx.avatarBucket);
    const { data, error } = await bucket.list(viewer.authUserId);
    if (error || !data?.length) return;
    await bucket.remove(data.map((f) => `${viewer.authUserId}/${f.name}`));
  } catch (e) {
    console.error("[api] avatar folder cleanup failed", {
      user: viewer.authUserId,
      error: (e as Error).message,
    });
  }
}
