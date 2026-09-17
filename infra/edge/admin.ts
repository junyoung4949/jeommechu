// 관리자 전용 라우트.
//
// ## 왜 RLS 가 아니라 여기서 검사하는가
//
// DB 에는 이미 `is_manager()` 기반 RLS 정책이 깔려 있다(menus 수정·삭제, menu_aliases,
// categories, menu_categories). 그런데 이 함수는 **service role 키**로 DB 에 붙기 때문에
// RLS 를 통째로 우회한다. 서버를 거치는 한 그 정책들은 잠들어 있다.
//
// 그래서 문지기를 코드에 둔다. 검사가 `requireManager()` 한 줄로 눈에 보이고, 나머지
// 라우트와 검사 방식이 같아서 이해할 구조가 하나로 유지된다. RLS 는 그대로 두되 — 나중에
// 누가 anon 키로 DB 에 직접 붙는 경로가 생기면 그때 두 번째 자물쇠로 일한다.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fail, reply } from "./http.ts";

export interface AdminViewer {
  authUserId: string;
  isManager: boolean;
}

export interface AdminCtx {
  req: Request;
  /** 정규화된 경로 조각. 예: ["menus","16","aliases"] */
  seg: string[];
  origin: string | null;
  /** service role 클라이언트 */
  db: SupabaseClient;
  /**
   * 로그인한 사람을 가져온다. **게으르게** 부른다 — 관리자 경로가 아닐 때까지
   * 매 요청마다 DB 를 한 번 더 왕복시킬 이유가 없다.
   */
  getViewer: () => Promise<AdminViewer | null>;
  readJson: (req: Request) => Promise<Record<string, unknown> | null>;
  budgetTiers: readonly string[];
  /** 메뉴 사진으로 허용하는 URL 접두사. 클라이언트 값을 그대로 믿지 않는다. */
  imagePrefixes: string[];
}

const MAX_NAME = 30;
const MAX_DESC = 50;
const MAX_CATEGORY_NAME = 20;

/** 로그인 + 매니저 권한. 통과하면 null, 막히면 그대로 돌려보낼 응답. */
async function requireManager(ctx: AdminCtx): Promise<Response | null> {
  const viewer = await ctx.getViewer();
  if (!viewer) return fail("UNAUTHORIZED", "인증이 필요합니다.", ctx.origin);
  if (!viewer.isManager) {
    return fail("FORBIDDEN", "관리자만 할 수 있는 작업입니다.", ctx.origin);
  }
  return null;
}

/** 경로의 숫자 세그먼트. 아니면 null. */
function idOf(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 이름 → 정규화 문자열. 이형어 비교는 전부 이 값으로 한다. */
async function normalize(db: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await db.rpc("normalize_menu_name", { p_name: name });
  if (error) throw error;
  return String(data ?? "").trim();
}

/**
 * 관리자 라우트를 처리한다. **맡을 경로가 아니면 null** 을 돌려주므로,
 * index.ts 는 그대로 다음 라우트로 넘어가면 된다.
 */
export async function handleAdminRoute(ctx: AdminCtx): Promise<Response | null> {
  const { req, seg, origin, db } = ctx;
  const method = req.method;

  // ── PATCH /menus/{id} · DELETE /menus/{id} ───────────────────────────
  if (seg[0] === "menus" && seg.length === 2 && idOf(seg[1]) !== null) {
    if (method === "PATCH") return await patchMenu(ctx, idOf(seg[1])!);
    if (method === "DELETE") return await deleteMenu(ctx, idOf(seg[1])!);
    return null; // GET 은 공개 라우트가 맡는다
  }

  // ── POST /menus/{id}/aliases ─────────────────────────────────────────
  if (seg[0] === "menus" && seg.length === 3 && seg[2] === "aliases" && idOf(seg[1]) !== null) {
    if (method !== "POST") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
    return await addAlias(ctx, idOf(seg[1])!);
  }

  // ── DELETE /menus/{id}/aliases/{alias} ───────────────────────────────
  if (seg[0] === "menus" && seg.length === 4 && seg[2] === "aliases" && idOf(seg[1]) !== null) {
    if (method !== "DELETE") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
    return await removeAlias(ctx, idOf(seg[1])!, decodeURIComponent(seg[3]));
  }

  // ── POST /categories ─────────────────────────────────────────────────
  if (seg[0] === "categories" && seg.length === 1 && method === "POST") {
    return await createCategory(ctx);
  }

  // ── PATCH/DELETE /categories/{id} ────────────────────────────────────
  if (seg[0] === "categories" && seg.length === 2 && idOf(seg[1]) !== null) {
    if (method === "PATCH") return await renameCategory(ctx, idOf(seg[1])!);
    if (method === "DELETE") return await deleteCategory(ctx, idOf(seg[1])!);
    return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
  }

  // ── GET /admin/menus · GET /admin/stats ──────────────────────────────
  if (seg[0] === "admin" && seg.length === 2) {
    if (method !== "GET") return fail("METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.", origin);
    if (seg[1] === "menus") return await listMenusForAdmin(ctx);
    if (seg[1] === "stats") return await stats(ctx);
  }

  return null;
}

/* ────────────────────────────── 메뉴 ────────────────────────────── */

async function patchMenu(ctx: AdminCtx, menuId: number): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const { data: current } = await db
    .from("menus")
    .select("id, name, budget_tier, min_people, max_people, canonical_name")
    .eq("id", menuId)
    .maybeSingle();
  if (!current) return fail("NOT_FOUND", "존재하지 않는 메뉴입니다.", origin, { menuId });

  const body = (await ctx.readJson(ctx.req)) ?? {};
  const patch: Record<string, unknown> = {};
  const fields: string[] = [];

  // 보낸 필드만 고친다. 안 보낸 필드를 null 로 밀어버리면 부분 수정이 불가능해진다.
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > MAX_NAME) fields.push("name");
    else patch.name = name;
  }
  if ("budgetTier" in body) {
    const t = typeof body.budgetTier === "string" ? body.budgetTier : "";
    if (!ctx.budgetTiers.includes(t)) fields.push("budgetTier");
    else patch.budget_tier = t;
  }
  if ("minPeople" in body) {
    if (!Number.isInteger(body.minPeople) || (body.minPeople as number) < 1) fields.push("minPeople");
    else patch.min_people = body.minPeople;
  }
  if ("maxPeople" in body) {
    if (!Number.isInteger(body.maxPeople) || (body.maxPeople as number) < 1) fields.push("maxPeople");
    else patch.max_people = body.maxPeople;
  }
  if ("description" in body) {
    const d = body.description == null || body.description === "" ? null : String(body.description);
    if (d !== null && d.length > MAX_DESC) fields.push("description");
    else patch.description = d;
  }
  if ("imageUrl" in body) {
    const url = String(body.imageUrl ?? "");
    if (!ctx.imagePrefixes.some((p) => url.startsWith(p))) fields.push("imageUrl");
    else patch.image_url = url;
  }

  // 인원 범위는 **최종 값끼리** 비교해야 한다. min 만 보낸 요청이 기존 max 를 넘길 수 있다.
  const finalMin = (patch.min_people as number) ?? current.min_people;
  const finalMax = (patch.max_people as number) ?? current.max_people;
  if (finalMin > finalMax) fields.push("maxPeople");

  let categoryIds: number[] | null = null;
  if ("categoryIds" in body) {
    const raw = Array.isArray(body.categoryIds) ? body.categoryIds : [];
    if (raw.length < 1 || !raw.every((v) => Number.isInteger(v) && (v as number) > 0)) {
      fields.push("categoryIds");
    } else {
      categoryIds = raw as number[];
      const { data: found } = await db.from("categories").select("id").in("id", categoryIds);
      if ((found?.length ?? 0) !== categoryIds.length) fields.push("categoryIds");
    }
  }

  if (fields.length > 0) {
    return fail("VALIDATION_ERROR", "입력값을 다시 확인해 주세요.", origin, {
      fields: [...new Set(fields)],
    });
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db.from("menus").update(patch).eq("id", menuId);
    if (error) {
      // canonical_name 이 UNIQUE 다. 이름을 고쳤는데 다른 메뉴와 같은 이름이 되면 여기서 걸린다.
      if (error.code === "23505") {
        return fail("DUPLICATE_MENU", "같은 이름의 메뉴가 이미 있어요.", origin, { fields: ["name"] });
      }
      throw error;
    }
  }

  if (categoryIds) {
    // **넣고 나서 지운다.** 순서가 반대면 중간에 실패했을 때 카테고리 없는 메뉴가 남는다.
    const rows = categoryIds.map((category_id) => ({ menu_id: menuId, category_id }));
    const { error: insErr } = await db
      .from("menu_categories")
      .upsert(rows, { onConflict: "menu_id,category_id", ignoreDuplicates: true });
    if (insErr) throw insErr;

    const { error: delErr } = await db
      .from("menu_categories")
      .delete()
      .eq("menu_id", menuId)
      .not("category_id", "in", `(${categoryIds.join(",")})`);
    if (delErr) throw delErr;
  }

  const { data: detail, error: readErr } = await db.rpc("menu_detail_json", { p_menu_id: menuId });
  if (readErr) throw readErr;
  return reply({ status: 200, body: detail, origin });
}

async function deleteMenu(ctx: AdminCtx, menuId: number): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const { data: menu } = await db
    .from("menus")
    .select("id, name, canonical_name")
    .eq("id", menuId)
    .maybeSingle();
  if (!menu) return fail("NOT_FOUND", "존재하지 않는 메뉴입니다.", origin, { menuId });

  // recommendations 는 ON DELETE CASCADE 다. 메뉴를 지우면 그 메뉴의 추천 기록이 **함께
  // 사라지고 과거 통계가 소급해서 바뀐다.** 되돌릴 수 없으므로 한 번 확인받는다.
  // (등록 화면의 confirmedDistinct 와 같은 방식이다.)
  const { count } = await db
    .from("recommendations")
    .select("id", { count: "exact", head: true })
    .eq("menu_id", menuId);
  const lost = count ?? 0;

  const body = (await ctx.readJson(ctx.req)) ?? {};
  if (lost > 0 && body.confirmCascade !== true) {
    return fail(
      "CASCADE_NOT_CONFIRMED",
      `이 메뉴를 지우면 추천 기록 ${lost}건도 함께 삭제됩니다.`,
      origin,
      { recommendations: lost },
    );
  }

  // 이형어는 menus 와 외래키로 묶여 있지 않다(canonical 문자열로 느슨하게 연결). 메뉴만
  // 지우면 어디에도 안 걸리는 이형어가 남아, 나중에 그 이름으로 등록하려는 사람을 계속 막는다.
  const { count: aliasCount } = await db
    .from("menu_aliases")
    .delete({ count: "exact" })
    .eq("canonical", menu.canonical_name);

  const { error } = await db.from("menus").delete().eq("id", menuId);
  if (error) throw error;

  return reply({
    status: 200,
    body: { deleted: { menuId, name: menu.name }, removedRecommendations: lost, removedAliases: aliasCount ?? 0 },
    origin,
  });
}

/* ───────────────────────────── 이형어 ───────────────────────────── */

async function addAlias(ctx: AdminCtx, menuId: number): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const { data: menu } = await db
    .from("menus")
    .select("id, name, canonical_name")
    .eq("id", menuId)
    .maybeSingle();
  if (!menu) return fail("NOT_FOUND", "존재하지 않는 메뉴입니다.", origin, { menuId });

  const body = (await ctx.readJson(ctx.req)) ?? {};
  const raw = typeof body.alias === "string" ? body.alias.trim() : "";
  if (raw.length < 1 || raw.length > MAX_NAME) {
    return fail("VALIDATION_ERROR", "이름은 1~30자여야 합니다.", origin, { fields: ["alias"] });
  }

  const alias = await normalize(db, raw);
  if (!alias) {
    return fail("VALIDATION_ERROR", "쓸 수 없는 이름입니다.", origin, { fields: ["alias"] });
  }
  if (alias === menu.canonical_name) {
    return fail("VALIDATION_ERROR", "메뉴 이름과 같습니다.", origin, { fields: ["alias"] });
  }

  // 이미 등록된 **메뉴** 이름을 이형어로 묶으면 그 메뉴가 가려진다.
  // 예: '라면'이 따로 있는데 라멘의 이형어로 묶으면 라면을 다시 등록할 수 없다.
  const { data: clash } = await db
    .from("menus")
    .select("id, name")
    .eq("canonical_name", alias)
    .maybeSingle();
  if (clash) {
    return fail("DUPLICATE_MENU", `‘${clash.name}’이 이미 별도 메뉴로 있어요.`, origin, {
      menuId: clash.id,
    });
  }

  const { data: existing } = await db
    .from("menu_aliases")
    .select("alias, canonical")
    .eq("alias", alias)
    .maybeSingle();
  if (existing) {
    return fail("DUPLICATE_MENU", `이미 ‘${existing.canonical}’에 묶여 있어요.`, origin, {
      canonical: existing.canonical,
    });
  }

  const { error } = await db.from("menu_aliases").insert({ alias, canonical: menu.canonical_name });
  if (error) throw error;

  return reply({ status: 201, body: { alias, canonical: menu.canonical_name }, origin });
}

async function removeAlias(ctx: AdminCtx, menuId: number, rawAlias: string): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const { data: menu } = await db
    .from("menus")
    .select("id, canonical_name")
    .eq("id", menuId)
    .maybeSingle();
  if (!menu) return fail("NOT_FOUND", "존재하지 않는 메뉴입니다.", origin, { menuId });

  const alias = await normalize(db, rawAlias);
  // canonical 까지 함께 맞춘다. 경로의 메뉴와 실제로 묶인 이형어만 지우기 위해서다.
  const { count, error } = await db
    .from("menu_aliases")
    .delete({ count: "exact" })
    .eq("alias", alias)
    .eq("canonical", menu.canonical_name);
  if (error) throw error;
  if (!count) return fail("NOT_FOUND", "이 메뉴에 묶인 이름이 아닙니다.", origin, { alias });

  return reply({ status: 200, body: { removed: alias }, origin });
}

/* ──────────────────────────── 카테고리 ──────────────────────────── */

function categoryName(body: Record<string, unknown>): string {
  return typeof body.name === "string" ? body.name.trim() : "";
}

async function createCategory(ctx: AdminCtx): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const name = categoryName((await ctx.readJson(ctx.req)) ?? {});
  if (name.length < 1 || name.length > MAX_CATEGORY_NAME) {
    return fail("VALIDATION_ERROR", "카테고리 이름은 1~20자여야 합니다.", origin, { fields: ["name"] });
  }

  const { data, error } = await db.from("categories").insert({ name }).select("id, name").single();
  if (error) {
    if (error.code === "23505") {
      return fail("DUPLICATE_MENU", "같은 이름의 카테고리가 이미 있어요.", origin, { fields: ["name"] });
    }
    throw error;
  }
  return reply({ status: 201, body: data, origin });
}

async function renameCategory(ctx: AdminCtx, id: number): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const name = categoryName((await ctx.readJson(ctx.req)) ?? {});
  if (name.length < 1 || name.length > MAX_CATEGORY_NAME) {
    return fail("VALIDATION_ERROR", "카테고리 이름은 1~20자여야 합니다.", origin, { fields: ["name"] });
  }

  const { data, error } = await db
    .from("categories")
    .update({ name })
    .eq("id", id)
    .select("id, name")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return fail("DUPLICATE_MENU", "같은 이름의 카테고리가 이미 있어요.", origin, { fields: ["name"] });
    }
    throw error;
  }
  if (!data) return fail("NOT_FOUND", "존재하지 않는 카테고리입니다.", origin, { id });
  return reply({ status: 200, body: data, origin });
}

async function deleteCategory(ctx: AdminCtx, id: number): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const { data: cat } = await db.from("categories").select("id, name").eq("id", id).maybeSingle();
  if (!cat) return fail("NOT_FOUND", "존재하지 않는 카테고리입니다.", origin, { id });

  const { data: links } = await db.from("menu_categories").select("menu_id").eq("category_id", id);
  const menuIds = (links ?? []).map((l) => l.menu_id as number);

  // 이 카테고리를 빼면 **카테고리가 하나도 안 남는** 메뉴를 센다.
  // 그런 메뉴는 카테고리 필터로 영영 찾을 수 없게 되므로 지우기 전에 알려줘야 한다.
  let orphaned = 0;
  if (menuIds.length > 0) {
    const { data: all } = await db
      .from("menu_categories")
      .select("menu_id")
      .in("menu_id", menuIds);
    const byMenu = new Map<number, number>();
    for (const r of all ?? []) {
      byMenu.set(r.menu_id as number, (byMenu.get(r.menu_id as number) ?? 0) + 1);
    }
    orphaned = menuIds.filter((m) => (byMenu.get(m) ?? 0) <= 1).length;
  }

  const body = (await ctx.readJson(ctx.req)) ?? {};
  if (menuIds.length > 0 && body.confirmCascade !== true) {
    const tail = orphaned > 0
      ? ` 그중 ${orphaned}개는 카테고리가 하나도 남지 않습니다.`
      : "";
    return fail(
      "CATEGORY_IN_USE",
      `메뉴 ${menuIds.length}개에서 이 카테고리가 빠집니다.${tail}`,
      origin,
      { menus: menuIds.length, orphaned },
    );
  }

  // 매핑 행은 외래키가 ON DELETE CASCADE 라 DB 가 같은 트랜잭션에서 함께 지운다.
  const { error } = await db.from("categories").delete().eq("id", id);
  if (error) throw error;

  return reply({
    status: 200,
    body: { deleted: id, name: cat.name, detachedMenus: menuIds.length, orphanedMenus: orphaned },
    origin,
  });
}

/* ───────────────────────────── 조회 ───────────────────────────── */

/**
 * 관리자 목록. 화면이 한 번에 필요로 하는 것(사진·등록자·카테고리·이형어·성적)을
 * 한 응답에 담는다. 행마다 따로 부르면 16개짜리 목록에 요청이 수십 번 나간다.
 */
async function listMenusForAdmin(ctx: AdminCtx): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const [menusRes, statsRes, aliasRes] = await Promise.all([
    db
      .from("menus")
      .select(
        "id, name, canonical_name, budget_tier, min_people, max_people, image_url, description, created_at, created_by, menu_categories(categories(id, name)), profiles:created_by(nickname, avatar_url)",
      )
      .order("created_at", { ascending: false }),
    db.from("admin_menu_stats").select("*"),
    db.from("menu_aliases").select("alias, canonical"),
  ]);

  if (menusRes.error) throw menusRes.error;
  if (statsRes.error) throw statsRes.error;
  if (aliasRes.error) throw aliasRes.error;

  const statById = new Map((statsRes.data ?? []).map((s) => [s.menu_id, s]));
  const aliasByCanonical = new Map<string, string[]>();
  for (const a of aliasRes.data ?? []) {
    const list = aliasByCanonical.get(a.canonical) ?? [];
    list.push(a.alias);
    aliasByCanonical.set(a.canonical, list);
  }

  const items = (menusRes.data ?? []).map((m) => {
    const s = statById.get(m.id) ?? { recommended: 0, chosen: 0, skipped: 0, no_response: 0 };
    return {
      id: m.id,
      name: m.name,
      budgetTier: m.budget_tier,
      minPeople: m.min_people,
      maxPeople: m.max_people,
      imageUrl: m.image_url,
      description: m.description,
      createdAt: m.created_at,
      createdBy: m.profiles
        ? { nickname: m.profiles.nickname, profileImageUrl: m.profiles.avatar_url }
        : null,
      categories: (m.menu_categories ?? []).map((mc: { categories: { id: number; name: string } }) => mc.categories),
      aliases: aliasByCanonical.get(m.canonical_name) ?? [],
      stats: {
        recommended: Number(s.recommended),
        chosen: Number(s.chosen),
        skipped: Number(s.skipped),
        noResponse: Number(s.no_response),
      },
    };
  });

  return reply({ status: 200, body: items, origin });
}

async function stats(ctx: AdminCtx): Promise<Response> {
  const denied = await requireManager(ctx);
  if (denied) return denied;
  const { db, origin } = ctx;

  const [rowsRes, menusRes] = await Promise.all([
    db.from("admin_menu_stats").select("*"),
    db.from("menus").select("id, name"),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  if (menusRes.error) throw menusRes.error;

  const nameById = new Map((menusRes.data ?? []).map((m) => [m.id, m.name]));
  const perMenu = (rowsRes.data ?? []).map((s) => ({
    menuId: s.menu_id,
    name: nameById.get(s.menu_id) ?? null,
    recommended: Number(s.recommended),
    chosen: Number(s.chosen),
    skipped: Number(s.skipped),
    noResponse: Number(s.no_response),
    lastRecommendedAt: s.last_recommended_at,
  }));

  const total = perMenu.reduce(
    (acc, m) => ({
      recommended: acc.recommended + m.recommended,
      chosen: acc.chosen + m.chosen,
      skipped: acc.skipped + m.skipped,
      noResponse: acc.noResponse + m.noResponse,
    }),
    { recommended: 0, chosen: 0, skipped: 0, noResponse: 0 },
  );

  return reply({
    status: 200,
    // 채택률은 무응답을 빼고 낸다. 넣으면 전부 5% 아래로 깔려 메뉴 간 비교가 안 된다.
    body: { total, perMenu },
    origin,
  });
}
