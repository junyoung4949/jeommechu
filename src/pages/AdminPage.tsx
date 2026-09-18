import { useEffect, useMemo, useState } from 'react'
import {
  addAlias,
  deleteCategory,
  deleteMenu,
  errorOf,
  fetchAdminMenus,
  fetchAdminStats,
  patchMenu,
  removeAlias,
  renameCategory,
  createCategory,
  type AdminMenu,
  type AdminStats,
  type CohortStats,
  type DailyRow,
  type HourRow,
  type IdentityCounts,
  type StatCounts,
  type WeekdayRow,
} from '../api/admin'
import { fetchCategories, type Category } from '../api/categories'
import { BUDGET_BUCKETS, budgetLabel, type BudgetTier } from '../api/recommend'
import styles from './AdminPage.module.css'

type Tab = 'menus' | 'stats' | 'categories'

/**
 * 정렬 기준.
 * 여기 채택률은 **무응답을 빼고** 낸다 — 넣으면 전부 5% 아래로 깔려 메뉴 간 비교가 안 된다.
 * 통계 탭의 '채택률'(분모가 추천 수)과는 값이 다르므로, 라벨에 분모를 적어 구분한다.
 */
type Sort = 'recent' | 'recommended' | 'rateHigh' | 'rateLow' | 'name'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'recent', label: '최근 등록순' },
  { value: 'recommended', label: '추천 많은순' },
  { value: 'rateLow', label: '응답 중 채택률 낮은순' },
  { value: 'rateHigh', label: '응답 중 채택률 높은순' },
  { value: 'name', label: '이름순' },
]

/** 응답(채택+넘김) 중 채택 비율. 응답이 없으면 비교 대상이 아니므로 null. */
function adoptionRate(m: AdminMenu): number | null {
  const answered = m.stats.chosen + m.stats.skipped
  return answered === 0 ? null : m.stats.chosen / answered
}

function formatDay(iso: string): string {
  return iso.slice(0, 10)
}

interface Draft {
  name: string
  categoryIds: number[]
  budgetTier: BudgetTier
  minPeople: number
  maxPeople: number
  description: string
}

function draftOf(m: AdminMenu): Draft {
  return {
    name: m.name,
    categoryIds: m.categories.map((c) => c.id),
    budgetTier: m.budgetTier,
    minPeople: m.minPeople,
    maxPeople: m.maxPeople,
    description: m.description ?? '',
  }
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('menus')
  const [menus, setMenus] = useState<AdminMenu[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // ── 목록 조건 ──────────────────────────────────────────
  const [q, setQ] = useState('')
  const [byCreator, setByCreator] = useState('')
  const [byCategory, setByCategory] = useState('')
  const [onlyNoCategory, setOnlyNoCategory] = useState(false)
  const [sort, setSort] = useState<Sort>('recent')

  // ── 편집 ──────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editNotice, setEditNotice] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')

  async function reload() {
    setLoading(true)
    setLoadError('')
    try {
      const [m, c] = await Promise.all([fetchAdminMenus(), fetchCategories()])
      setMenus(m)
      setCategories(c)
      return m
    } catch (err) {
      setLoadError(errorOf(err).message ?? '목록을 불러오지 못했어요.')
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const selected = menus.find((m) => m.id === selectedId) ?? null

  function select(m: AdminMenu) {
    setSelectedId(m.id)
    setDraft(draftOf(m))
    setEditError('')
    setEditNotice('')
    setAliasInput('')
    setPendingDelete('')
  }

  const creators = useMemo(() => {
    const names = new Set<string>()
    for (const m of menus) if (m.createdBy) names.add(m.createdBy.nickname)
    return [...names].sort()
  }, [menus])

  /**
   * 걸러내기와 정렬은 브라우저에서 한다. 목록이 한 응답에 다 오기 때문에 서버를 다시
   * 부를 이유가 없고, 조건을 바꿀 때마다 즉시 반응한다.
   * 메뉴가 수백 개를 넘어가면 그때 서버 쿼리로 옮긴다.
   */
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let rows = menus.filter((m) => {
      if (onlyNoCategory && m.categories.length > 0) return false
      if (byCreator && m.createdBy?.nickname !== byCreator) return false
      if (byCategory && !m.categories.some((c) => String(c.id) === byCategory)) return false
      if (!needle) return true
      // 이형어까지 뒤진다 — '돈까스'로 찾아도 '돈가스'가 나와야 한다.
      return (
        m.name.toLowerCase().includes(needle) ||
        m.aliases.some((a) => a.toLowerCase().includes(needle))
      )
    })

    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case 'recommended':
          return b.stats.recommended - a.stats.recommended
        case 'name':
          return a.name.localeCompare(b.name, 'ko')
        case 'rateHigh':
        case 'rateLow': {
          // 응답이 없는 메뉴는 비교할 수가 없다. 순서와 무관하게 늘 뒤로 보낸다.
          const ra = adoptionRate(a)
          const rb = adoptionRate(b)
          if (ra === null && rb === null) return 0
          if (ra === null) return 1
          if (rb === null) return -1
          return sort === 'rateHigh' ? rb - ra : ra - rb
        }
        default:
          return b.createdAt.localeCompare(a.createdAt)
      }
    })
    return rows
  }, [menus, q, byCreator, byCategory, onlyNoCategory, sort])

  const noCategoryCount = menus.filter((m) => m.categories.length === 0).length

  // ── 저장 ──────────────────────────────────────────────
  async function save() {
    if (!selected || !draft) return
    setSaving(true)
    setEditError('')
    setEditNotice('')
    try {
      await patchMenu(selected.id, {
        name: draft.name.trim(),
        categoryIds: draft.categoryIds,
        budgetTier: draft.budgetTier,
        minPeople: draft.minPeople,
        maxPeople: draft.maxPeople,
        description: draft.description.trim() === '' ? null : draft.description.trim(),
      })
      const fresh = await reload()
      if (fresh) {
        const again = fresh.find((m) => m.id === selected.id)
        if (again) setDraft(draftOf(again))
      }
      setEditNotice('저장했어요.')
    } catch (err) {
      setEditError(errorOf(err).message ?? '저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  async function submitAlias() {
    if (!selected) return
    const value = aliasInput.trim()
    if (!value) return
    setEditError('')
    try {
      await addAlias(selected.id, value)
      setAliasInput('')
      await reload()
    } catch (err) {
      setEditError(errorOf(err).message ?? '이름을 묶지 못했어요.')
    }
  }

  async function dropAlias(alias: string) {
    if (!selected) return
    setEditError('')
    try {
      await removeAlias(selected.id, alias)
      await reload()
    } catch (err) {
      setEditError(errorOf(err).message ?? '연결을 해제하지 못했어요.')
    }
  }

  /**
   * 첫 호출은 확인 없이 보낸다. 추천 기록이 있으면 서버가 몇 건인지 알려주며 막고,
   * 그 문구를 보여준 뒤 두 번째 호출에서 확인 플래그를 붙인다.
   * 되돌릴 수 없는 삭제라 "정말요?" 한 번은 사람이 읽고 넘어가야 한다.
   */
  async function removeMenu(confirmed: boolean) {
    if (!selected) return
    setEditError('')
    try {
      await deleteMenu(selected.id, confirmed)
      setSelectedId(null)
      setDraft(null)
      setPendingDelete('')
      await reload()
    } catch (err) {
      const e = errorOf(err)
      if (e.code === 'CASCADE_NOT_CONFIRMED') setPendingDelete(e.message ?? '')
      else setEditError(e.message ?? '삭제하지 못했어요.')
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.tabs} role="tablist">
        {([
          ['menus', '메뉴 관리'],
          ['stats', '추천 통계'],
          ['categories', '카테고리'],
        ] as [Tab, string][]).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={styles.tab}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && <p className={styles.error}>{loadError}</p>}
      {loading && <p className={styles.muted}>불러오는 중...</p>}

      {!loading && tab === 'menus' && (
        <div className={styles.split}>
          <section className={styles.listCol}>
            <div className={styles.filters}>
              <input
                className={styles.search}
                placeholder="메뉴 이름 또는 이형어로 찾기"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="메뉴 검색"
              />
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <select value={byCreator} onChange={(e) => setByCreator(e.target.value)} aria-label="등록자">
                <option value="">등록자 전체</option>
                {creators.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={byCategory} onChange={(e) => setByCategory(e.target.value)} aria-label="카테고리">
                <option value="">카테고리 전체</option>
                {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
              <button
                className={`${styles.toggle} ${onlyNoCategory ? styles.toggleOn : ''}`}
                aria-pressed={onlyNoCategory}
                onClick={() => setOnlyNoCategory((v) => !v)}
                title="카테고리가 하나도 없는 메뉴만 봅니다"
              >
                카테고리 없음 {noCategoryCount > 0 && <b>{noCategoryCount}</b>}
              </button>
              <span className={styles.count}>{visible.length} / {menus.length}</span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>사진</th><th>이름</th><th>카테고리</th><th>예산</th>
                    <th>인원</th><th>등록자</th><th>추천</th><th>채택</th><th>이형어</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => (
                    <tr
                      key={m.id}
                      aria-selected={m.id === selectedId}
                      onClick={() => select(m)}
                    >
                      <td><img className={styles.thumb} src={m.imageUrl} alt="" loading="lazy" /></td>
                      <td>
                        <div className={styles.name}>{m.name}</div>
                        <div className={styles.sub}>#{m.id} · {formatDay(m.createdAt)}</div>
                      </td>
                      <td className={styles.sub}>
                        {m.categories.length > 0
                          ? m.categories.map((c) => c.name).join(', ')
                          : <span className={styles.warn}>없음</span>}
                      </td>
                      <td className={styles.sub}>{budgetLabel(m.budgetTier)}</td>
                      <td className={styles.num}>{m.minPeople}~{m.maxPeople}</td>
                      <td className={styles.sub}>{m.createdBy?.nickname ?? '탈퇴한 사용자'}</td>
                      <td className={styles.num}>{m.stats.recommended}</td>
                      <td className={styles.num}>{m.stats.chosen}</td>
                      <td>{m.aliases.length > 0 ? <span className={styles.chip}>{m.aliases.length}</span> : <span className={styles.sub}>—</span>}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={9} className={styles.empty}>조건에 맞는 메뉴가 없어요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <aside className={styles.editCol}>
            {!selected || !draft ? (
              <p className={styles.placeholder}>왼쪽에서 메뉴를 고르면 여기서 고칠 수 있어요.</p>
            ) : (
              <div className={styles.edit}>
                <p className={styles.eyebrow}>메뉴 #{selected.id} 편집</p>

                <div className={styles.photo}>
                  <img src={selected.imageUrl} alt={selected.name} />
                </div>

                <label className={styles.field}>
                  <span>이름</span>
                  <input
                    value={draft.name}
                    maxLength={30}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>

                <div className={styles.field}>
                  <span>카테고리 <em>· 눌러서 켜고 끕니다</em></span>
                  <div className={styles.picks}>
                    {categories.map((c) => {
                      const on = draft.categoryIds.includes(c.id)
                      return (
                        <button
                          key={c.id}
                          className={styles.pick}
                          aria-pressed={on}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              categoryIds: on
                                ? draft.categoryIds.filter((id) => id !== c.id)
                                : [...draft.categoryIds, c.id],
                            })
                          }
                        >
                          {c.name}
                        </button>
                      )
                    })}
                  </div>
                  {draft.categoryIds.length === 0 && (
                    <p className={styles.warnLine}>최소 하나는 골라야 저장할 수 있어요.</p>
                  )}
                </div>

                <div className={styles.row2}>
                  <label className={styles.field}>
                    <span>예산</span>
                    <select
                      value={draft.budgetTier}
                      onChange={(e) => setDraft({ ...draft, budgetTier: e.target.value as BudgetTier })}
                    >
                      {BUDGET_BUCKETS.map((b) => (
                        <option key={b.value} value={b.value}>{b.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.field}>
                    <span>인원</span>
                    <div className={styles.people}>
                      <input
                        type="number" min={1} value={draft.minPeople}
                        onChange={(e) => setDraft({ ...draft, minPeople: Number(e.target.value) })}
                      />
                      <span className={styles.tilde}>~</span>
                      <input
                        type="number" min={1} value={draft.maxPeople}
                        onChange={(e) => setDraft({ ...draft, maxPeople: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>

                <label className={styles.field}>
                  <span>설명 <em>· 최대 50자</em></span>
                  <input
                    value={draft.description}
                    maxLength={50}
                    placeholder="비워둬도 됩니다"
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>

                <section className={styles.section}>
                  <h3>이형어</h3>
                  <p className={styles.sectionWhy}>
                    여기 묶인 이름으로 등록을 시도하면 중복으로 막힙니다.
                  </p>
                  <div className={styles.aliases}>
                    {selected.aliases.map((a) => (
                      <span key={a} className={styles.alias}>
                        {a}
                        <button onClick={() => dropAlias(a)} aria-label={`${a} 연결 해제`}>×</button>
                      </span>
                    ))}
                    <input
                      className={styles.aliasInput}
                      placeholder="+ 이름 추가"
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitAlias() }}
                    />
                  </div>
                </section>

                <section className={styles.section}>
                  <h3>등록 정보</h3>
                  <dl className={styles.meta}>
                    <dt>등록자</dt><dd>{selected.createdBy?.nickname ?? '탈퇴한 사용자'}</dd>
                    <dt>등록일</dt><dd>{formatDay(selected.createdAt)}</dd>
                    <dt>성적</dt>
                    <dd>
                      추천 {selected.stats.recommended} · 채택 {selected.stats.chosen} ·
                      넘김 {selected.stats.skipped} · 무응답 {selected.stats.noResponse}
                    </dd>
                  </dl>
                </section>

                {editError && <p className={styles.error}>{editError}</p>}
                {editNotice && <p className={styles.notice}>{editNotice}</p>}

                <div className={styles.actions}>
                  <button
                    className={styles.primary}
                    onClick={save}
                    disabled={saving || draft.categoryIds.length === 0}
                  >
                    {saving ? '저장 중...' : '저장'}
                  </button>
                  <button className={styles.ghost} onClick={() => setDraft(draftOf(selected))}>
                    되돌리기
                  </button>
                  <button className={styles.danger} onClick={() => removeMenu(false)}>
                    메뉴 삭제
                  </button>
                </div>

                {pendingDelete && (
                  <div className={styles.confirm}>
                    <p>{pendingDelete}</p>
                    <div>
                      <button className={styles.danger} onClick={() => removeMenu(true)}>
                        알겠습니다, 삭제
                      </button>
                      <button className={styles.ghost} onClick={() => setPendingDelete('')}>
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {!loading && tab === 'stats' && <StatsTab />}
      {!loading && tab === 'categories' && (
        <CategoriesTab categories={categories} menus={menus} onChanged={reload} />
      )}
    </main>
  )
}

/* ─────────────────────────── 통계 ─────────────────────────── */

/**
 * 메뉴별 정렬 기준.
 * 여기서의 세 비율은 **분모가 추천 수**다. 셋을 더하면 항상 100% 가 되므로 한 막대로 읽힌다.
 * (메뉴 관리 탭의 '응답 중 채택률'은 분모가 달라 값이 서로 다르다.)
 */
type StatSort = 'recommended' | 'chosenHigh' | 'chosenLow' | 'skippedHigh' | 'noneHigh' | 'name'

const STAT_SORTS: { value: StatSort; label: string }[] = [
  { value: 'recommended', label: '추천 많은순' },
  { value: 'chosenHigh', label: '채택률 높은순' },
  { value: 'chosenLow', label: '채택률 낮은순' },
  { value: 'skippedHigh', label: '넘김률 높은순' },
  { value: 'noneHigh', label: '무응답률 높은순' },
  { value: 'name', label: '이름순' },
]

/** 추천이 0인 메뉴는 비율이 존재하지 않는다. 0% 로 적으면 '아무도 안 고른 메뉴'와 섞인다. */
function rate(n: number, recommended: number): number | null {
  return recommended === 0 ? null : n / recommended
}

function pctText(r: number | null): string {
  return r === null ? '—' : `${Math.round(r * 100)}%`
}

/** 비율이 없는 행(추천 0)은 정렬 방향과 무관하게 늘 뒤로 보낸다. */
function byRate(a: number | null, b: number | null, desc: boolean): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return desc ? b - a : a - b
}

const KST = 'Asia/Seoul'

/** 오늘(한국 날짜). 서버가 KST 로 경계를 자르므로 화면도 같은 기준으로 고른다. */
function kstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KST }).format(new Date())
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * 서버는 **기록이 있는 날만** 내려준다. 그대로 그리면 조용한 날이 사라져 그래프가
 * 실제보다 촘촘해 보인다. 기간이 정해져 있으면 빈 날을 0으로 채워 실제 간격을 살린다.
 */
function fillDays(daily: DailyRow[], from: string, to: string): DailyRow[] {
  const start = from || daily[0]?.day
  const end = to || daily[daily.length - 1]?.day
  if (!start || !end || start > end) return daily

  const byDay = new Map(daily.map((d) => [d.day, d]))
  const out: DailyRow[] = []
  // 기간을 아주 넓게 잡으면 막대가 실 한 올이 된다. 그쯤이면 채워봐야 읽히지 않는다.
  for (let day = start; day <= end && out.length < 400; day = shiftDay(day, 1)) {
    out.push(
      byDay.get(day) ??
        { day, recommended: 0, chosen: 0, skipped: 0, noResponse: 0, loggedIn: 0, anonymous: 0, signups: 0 },
    )
  }
  return out
}

/**
 * 막대를 무엇으로 쪼갤지.
 * 행동만으로 쪼개면 "이 숫자가 누구 것인가"가 안 보이고, 신원만으로 쪼개면 반응이 안 보인다.
 * 두 벌을 따로 그리는 대신 같은 막대를 두 가지로 읽게 한다 — 높이(추천 수)는 그대로다.
 */
type Mode = 'action' | 'identity'

/** 막대 한 칸의 재료. 두 기준 모두 이 한 행에서 나온다. */
type Slice = StatCounts & IdentityCounts

const LEGEND: Record<Mode, { label: string; cls: string; pick: (r: Slice) => number }[]> = {
  action: [
    { label: '채택', cls: styles.segChosen, pick: (r) => r.chosen },
    { label: '넘김', cls: styles.segSkipped, pick: (r) => r.skipped },
    { label: '무응답', cls: styles.segNone, pick: (r) => r.noResponse },
  ],
  identity: [
    { label: '로그인', cls: styles.segMember, pick: (r) => r.loggedIn },
    { label: '비로그인', cls: styles.segGuest, pick: (r) => r.anonymous },
  ],
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

/** 마우스를 올리면 기준과 무관하게 전부 보여준다. 기준을 바꿔가며 확인하지 않아도 되도록. */
function tipOf(head: string, r: Slice, extra = ''): string {
  return (
    `${head} · 추천 ${r.recommended} (로그인 ${r.loggedIn} / 비로그인 ${r.anonymous})` +
    ` · 채택 ${r.chosen} · 넘김 ${r.skipped} · 무응답 ${r.noResponse}${extra}`
  )
}

function peakOf<T extends Slice>(rows: T[], label: (r: T) => string): string {
  if (rows.length === 0) return '—'
  const top = rows.reduce((a, b) => (b.recommended > a.recommended ? b : a))
  return top.recommended === 0 ? '—' : `${label(top)} · ${top.recommended}건`
}

interface BarDatum {
  key: string
  label: string
  tip: string
  row: Slice
  /** 막대 위 점. 지금은 '그날 가입이 있었다'는 표시로만 쓴다. */
  mark?: boolean
}

/**
 * 세로 막대 묶음. 일별·시간대별·요일별이 모두 이걸 쓴다 —
 * 축만 다르고 읽는 방법은 같아야 눈이 옮겨 다닐 수 있다.
 */
function Bars({ data, mode, labelStep = 1 }: { data: BarDatum[]; mode: Mode; labelStep?: number }) {
  // 최댓값이 0이면(기록 없음) 0으로 나누게 된다.
  const max = Math.max(...data.map((d) => d.row.recommended), 1)
  return (
    <>
      <div className={styles.trend}>
        {data.map((d) => (
          <div key={d.key} className={styles.trendCol} title={d.tip}>
            <span className={styles.trendDot} data-on={d.mark || undefined} />
            <div className={styles.trendBar} style={{ height: `${(d.row.recommended / max) * 100}%` }}>
              {LEGEND[mode].map((seg) => (
                <span key={seg.label} className={seg.cls} style={{ flexGrow: seg.pick(d.row) }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.trendDays}>
        {data.map((d, i) => <span key={d.key}>{i % labelStep === 0 ? d.label : ''}</span>)}
      </div>
    </>
  )
}

const PRESETS: { label: string; days: number | null }[] = [
  { label: '최근 7일', days: 7 },
  { label: '최근 30일', days: 30 },
  { label: '전체', days: null },
]

function StatsTab() {
  const today = kstToday()
  const [from, setFrom] = useState(() => shiftDay(kstToday(), -29))
  const [to, setTo] = useState(today)
  const [data, setData] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<StatSort>('recommended')
  const [mode, setMode] = useState<Mode>('action')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchAdminStats({ from: from || undefined, to: to || undefined })
      .then((d) => { if (alive) setData(d) })
      .catch((err) => { if (alive) setError(errorOf(err).message ?? '통계를 불러오지 못했어요.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to])

  function applyPreset(days: number | null) {
    if (days === null) { setFrom(''); setTo('') } else { setFrom(shiftDay(today, -(days - 1))); setTo(today) }
  }

  const rows = useMemo(() => {
    const list = [...(data?.perMenu ?? [])]
    list.sort((a, b) => {
      switch (sort) {
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '', 'ko')
        case 'chosenHigh':
          return byRate(rate(a.chosen, a.recommended), rate(b.chosen, b.recommended), true)
        case 'chosenLow':
          return byRate(rate(a.chosen, a.recommended), rate(b.chosen, b.recommended), false)
        case 'skippedHigh':
          return byRate(rate(a.skipped, a.recommended), rate(b.skipped, b.recommended), true)
        case 'noneHigh':
          return byRate(rate(a.noResponse, a.recommended), rate(b.noResponse, b.recommended), true)
        default:
          return b.recommended - a.recommended
      }
    })
    return list
  }, [data, sort])

  const activePreset = PRESETS.find((p) =>
    p.days === null ? !from && !to : from === shiftDay(today, -(p.days - 1)) && to === today,
  )

  return (
    <div className={styles.stats}>
      <div className={styles.rangeBar}>
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={styles.preset}
              aria-pressed={activePreset?.label === p.label}
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className={styles.dateField}>
          <span>시작</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <span className={styles.tilde}>~</span>
        <label className={styles.dateField}>
          <span>종료</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className={styles.count}>
          {from || to ? `${from || '처음'} ~ ${to || '오늘'}` : '전체 기간'}
          {loading && ' · 불러오는 중...'}
        </span>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {!data ? (
        !error && <p className={styles.muted}>불러오는 중...</p>
      ) : (
        <>
          <Totals total={data.total} />

          <div className={styles.chartBar}>
            <div className={styles.presets}>
              {([['action', '행동별'], ['identity', '신원별']] as [Mode, string][]).map(([v, label]) => (
                <button
                  key={v}
                  className={styles.preset}
                  aria-pressed={mode === v}
                  onClick={() => setMode(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className={styles.chartHint}>아래 세 그래프의 막대를 쪼개는 기준 (높이는 추천 수로 동일)</span>
            <div className={styles.legend}>
              {LEGEND[mode].map((s) => (
                <span key={s.label}><i className={s.cls} />{s.label}</span>
              ))}
            </div>
          </div>

          <Trend daily={fillDays(data.daily, from, to)} mode={mode} />

          <div className={styles.rhythm}>
            <Hourly rows={data.hourly} mode={mode} />
            <Weekday rows={data.weekday} mode={mode} />
          </div>

          <Inflow users={data.users} />

          <div className={styles.panelBox}>
            <header>
              <h3>메뉴별 성적</h3>
              <span>세 비율의 분모는 <b>추천 수</b>입니다 — 더하면 100%</span>
              <select
                className={styles.inlineSelect}
                value={sort}
                onChange={(e) => setSort(e.target.value as StatSort)}
                aria-label="메뉴 정렬"
              >
                {STAT_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </header>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>메뉴</th><th>추천</th><th>채택률</th><th>넘김률</th><th>무응답률</th><th>구성</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const chosen = rate(m.chosen, m.recommended)
                    return (
                      <tr key={m.menuId}>
                        <td className={styles.name}>{m.name ?? `#${m.menuId}`}</td>
                        <td className={styles.num}>{m.recommended}</td>
                        <RateCell value={chosen} count={m.chosen} tone={styles.good} />
                        <RateCell value={rate(m.skipped, m.recommended)} count={m.skipped} tone={styles.warnText} />
                        <RateCell value={rate(m.noResponse, m.recommended)} count={m.noResponse} tone={styles.sub} />
                        <td><Stack row={m} /></td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className={styles.empty}>이 기간에는 추천 기록이 없어요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RateCell({ value, count, tone }: { value: number | null; count: number; tone: string }) {
  return (
    <td>
      <div className={styles.rateCell}>
        <b className={tone}>{pctText(value)}</b>
        <span className={styles.sub}>{count}</span>
      </div>
    </td>
  )
}

/** 채택·넘김·무응답을 한 줄에 쌓는다. 셋의 합이 추천 수라 비교가 눈으로 끝난다. */
function Stack({ row }: { row: StatCounts }) {
  if (row.recommended === 0) return <div className={styles.stack} />
  return (
    <div
      className={styles.stack}
      title={`채택 ${row.chosen} · 넘김 ${row.skipped} · 무응답 ${row.noResponse}`}
    >
      <span className={styles.segChosen} style={{ flexGrow: row.chosen }} />
      <span className={styles.segSkipped} style={{ flexGrow: row.skipped }} />
      <span className={styles.segNone} style={{ flexGrow: row.noResponse }} />
    </div>
  )
}

function Totals({ total }: { total: StatCounts & IdentityCounts }) {
  const p = (n: number) => pctText(rate(n, total.recommended))
  return (
    <div className={styles.cards}>
      <div className={styles.card}>
        <span>추천 요청</span>
        <strong>{total.recommended}</strong>
        <em>로그인 {total.loggedIn} · 비로그인 {total.anonymous}</em>
      </div>
      <div className={styles.card}><span>채택</span><strong className={styles.good}>{total.chosen}</strong><em>채택률 {p(total.chosen)}</em></div>
      <div className={styles.card}><span>넘김</span><strong className={styles.warnText}>{total.skipped}</strong><em>넘김률 {p(total.skipped)}</em></div>
      <div className={styles.card}><span>무응답</span><strong>{total.noResponse}</strong><em>무응답률 {p(total.noResponse)}</em></div>
    </div>
  )
}

function Trend({ daily, mode }: { daily: DailyRow[]; mode: Mode }) {
  if (daily.length === 0) return null
  // 날짜 라벨이 겹치면 아무것도 못 읽는다. 열 개쯤만 남기고 건너뛴다.
  const step = Math.ceil(daily.length / 10)

  return (
    <div className={styles.panelBox}>
      <header>
        <h3>일별 추이</h3>
        <span>점은 그날의 가입 · 가장 많은 날 {peakOf(daily, (d) => d.day)}</span>
      </header>
      <Bars
        mode={mode}
        labelStep={step}
        data={daily.map((d) => ({
          key: d.day,
          label: d.day.slice(5),
          row: d,
          mark: d.signups > 0,
          tip: tipOf(d.day, d, d.signups > 0 ? ` · 가입 ${d.signups}` : ''),
        }))}
      />
    </div>
  )
}

/**
 * 시간대별. 점심 메뉴를 고르는 서비스라 **가장 중요한 축**이다.
 * 하루가 24칸으로 늘 고정이라, 기간을 바꿔도 같은 자리를 비교하게 된다.
 */
function Hourly({ rows, mode }: { rows: HourRow[]; mode: Mode }) {
  return (
    <div className={styles.panelBox}>
      <header>
        <h3>시간대별</h3>
        <span>KST · 피크 {peakOf(rows, (r) => `${r.hour}시`)}</span>
      </header>
      <Bars
        mode={mode}
        labelStep={3}
        data={rows.map((r) => ({
          key: String(r.hour),
          label: String(r.hour),
          row: r,
          tip: tipOf(`${r.hour}시대`, r),
        }))}
      />
    </div>
  )
}

function Weekday({ rows, mode }: { rows: WeekdayRow[]; mode: Mode }) {
  return (
    <div className={styles.panelBox}>
      <header>
        <h3>요일별</h3>
        <span>피크 {peakOf(rows, (r) => `${WEEKDAYS[r.dow - 1]}요일`)}</span>
      </header>
      <Bars
        mode={mode}
        data={rows.map((r) => ({
          key: String(r.dow),
          label: WEEKDAYS[r.dow - 1],
          row: r,
          tip: tipOf(`${WEEKDAYS[r.dow - 1]}요일`, r),
        }))}
      />
    </div>
  )
}

/**
 * 기간 내 가입자와 그들의 활동.
 * 활동은 **가입 이후** 기록만 센다 — 로그인 시 비로그인 이력이 계정으로 넘어오기 때문에,
 * 그냥 세면 가입 전에 하던 활동까지 신규 회원의 성적으로 잡혀 활성도가 부풀려진다.
 */
function Inflow({ users }: { users: CohortStats }) {
  const share = users.totalUsers === 0 ? null : users.signups / users.totalUsers
  const ratio = (n: number) => (users.signups === 0 ? '—' : `${Math.round((n / users.signups) * 100)}%`)
  const perUser = users.signups === 0 ? '—' : (users.recommended / users.signups).toFixed(1)
  const answered = users.chosen + users.skipped

  return (
    <div className={styles.panelBox}>
      <header>
        <h3>유입과 활동</h3>
        <span>이 기간에 가입한 사람들의 <b>가입 이후</b> 활동만 셉니다</span>
      </header>

      <div className={styles.innerCards}>
        <div className={styles.card}>
          <span>신규 가입</span>
          <strong>{users.signups}</strong>
          <em>전체 {users.totalUsers}명 중 {pctText(share)}</em>
        </div>
        <div className={styles.card}>
          <span>활동 시작</span>
          <strong className={styles.good}>{users.activated}</strong>
          <em>신규 중 {ratio(users.activated)}</em>
        </div>
        <div className={styles.card}>
          <span>재방문</span>
          <strong>{users.returning}</strong>
          <em>이틀 이상 활동 · 평균 {users.avgActiveDays}일</em>
        </div>
        <div className={styles.card}>
          <span>1인당 추천</span>
          <strong>{perUser}</strong>
          <em>응답률 {pctText(rate(answered, users.recommended))}</em>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>가입자</th><th>가입일</th><th>추천</th><th>채택</th><th>넘김</th>
              <th>무응답</th><th>활동일</th><th>마지막 활동</th>
            </tr>
          </thead>
          <tbody>
            {users.rows.map((u) => (
              <tr key={u.userNo}>
                <td className={styles.name}>{u.nickname}</td>
                <td className={styles.sub}>{formatDay(u.joinedAt)}</td>
                <td className={styles.num}>{u.recommended}</td>
                <td className={`${styles.num} ${styles.good}`}>{u.chosen}</td>
                <td className={`${styles.num} ${styles.warnText}`}>{u.skipped}</td>
                <td className={styles.num}>{u.noResponse}</td>
                <td className={styles.num}>{u.activeDays}</td>
                <td className={styles.sub}>{u.lastActiveAt ? formatDay(u.lastActiveAt) : '없음'}</td>
              </tr>
            ))}
            {users.rows.length === 0 && (
              <tr><td colSpan={8} className={styles.empty}>이 기간에 가입한 사람이 없어요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ────────────────────────── 카테고리 ────────────────────────── */

function CategoriesTab({
  categories,
  menus,
  onChanged,
}: {
  categories: Category[]
  menus: AdminMenu[]
  onChanged: () => Promise<AdminMenu[] | null>
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')

  const countOf = (id: number) => menus.filter((m) => m.categories.some((c) => c.id === id)).length

  async function run(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      await onChanged()
      return true
    } catch (err) {
      setError(errorOf(err).message ?? '처리하지 못했어요.')
      return false
    }
  }

  async function tryDelete(id: number, confirmed: boolean) {
    setError('')
    try {
      await deleteCategory(id, confirmed)
      setConfirmId(null)
      setConfirmText('')
      await onChanged()
    } catch (err) {
      const e = errorOf(err)
      if (e.code === 'CATEGORY_IN_USE') {
        setConfirmId(id)
        setConfirmText(e.message ?? '')
      } else {
        setError(e.message ?? '삭제하지 못했어요.')
      }
    }
  }

  return (
    <div className={styles.cats}>
      {categories.map((c) => (
        <div key={c.id} className={styles.catRow}>
          {editingId === c.id ? (
            <>
              <input
                className={styles.catInput}
                value={editingName}
                maxLength={20}
                autoFocus
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && await run(() => renameCategory(c.id, editingName.trim()))) {
                    setEditingId(null)
                  }
                }}
              />
              <button
                className={styles.smallBtn}
                onClick={async () => {
                  if (await run(() => renameCategory(c.id, editingName.trim()))) setEditingId(null)
                }}
              >
                저장
              </button>
              <button className={styles.smallBtn} onClick={() => setEditingId(null)}>취소</button>
            </>
          ) : (
            <>
              <span className={styles.catName}>{c.name}</span>
              <span className={styles.catNum}>메뉴 {countOf(c.id)}개</span>
              <button
                className={styles.smallBtn}
                onClick={() => { setEditingId(c.id); setEditingName(c.name) }}
              >
                이름 수정
              </button>
              <button className={`${styles.smallBtn} ${styles.dangerText}`} onClick={() => tryDelete(c.id, false)}>
                삭제
              </button>
            </>
          )}

          {confirmId === c.id && (
            <div className={styles.confirmInline}>
              <p>{confirmText}</p>
              <div>
                <button className={styles.danger} onClick={() => tryDelete(c.id, true)}>알겠습니다, 삭제</button>
                <button className={styles.ghost} onClick={() => { setConfirmId(null); setConfirmText('') }}>취소</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.addCat}>
        <input
          placeholder="새 카테고리 이름"
          value={newName}
          maxLength={20}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && newName.trim() && await run(() => createCategory(newName.trim()))) {
              setNewName('')
            }
          }}
        />
        <button
          className={styles.primary}
          disabled={!newName.trim()}
          onClick={async () => {
            if (await run(() => createCategory(newName.trim()))) setNewName('')
          }}
        >
          추가
        </button>
      </div>

      <p className={styles.muted}>
        카테고리를 지우면 그 카테고리가 걸린 메뉴에서 자동으로 빠집니다. 그 결과 카테고리가
        하나도 안 남는 메뉴가 생기면, 지우기 전에 몇 개인지 알려드립니다.
        그런 메뉴는 메뉴 관리 탭의 <b>카테고리 없음</b> 필터로 찾아 고칠 수 있어요.
      </p>
    </div>
  )
}
