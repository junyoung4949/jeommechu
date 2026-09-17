import { useEffect, useMemo, useState } from 'react'
import {
  addAlias,
  deleteCategory,
  deleteMenu,
  errorOf,
  fetchAdminMenus,
  patchMenu,
  removeAlias,
  renameCategory,
  createCategory,
  type AdminMenu,
} from '../api/admin'
import { fetchCategories, type Category } from '../api/categories'
import { BUDGET_BUCKETS, budgetLabel, type BudgetTier } from '../api/recommend'
import styles from './AdminPage.module.css'

type Tab = 'menus' | 'stats' | 'categories'

/**
 * 정렬 기준.
 * 채택률은 **무응답을 빼고** 낸다 — 넣으면 전부 5% 아래로 깔려 메뉴 간 비교가 안 된다.
 */
type Sort = 'recent' | 'recommended' | 'rateHigh' | 'rateLow' | 'name'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'recent', label: '최근 등록순' },
  { value: 'recommended', label: '추천 많은순' },
  { value: 'rateLow', label: '채택률 낮은순' },
  { value: 'rateHigh', label: '채택률 높은순' },
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

      {!loading && tab === 'stats' && <StatsTab menus={menus} />}
      {!loading && tab === 'categories' && (
        <CategoriesTab categories={categories} menus={menus} onChanged={reload} />
      )}
    </main>
  )
}

/* ─────────────────────────── 통계 ─────────────────────────── */

function StatsTab({ menus }: { menus: AdminMenu[] }) {
  const total = menus.reduce(
    (a, m) => ({
      recommended: a.recommended + m.stats.recommended,
      chosen: a.chosen + m.stats.chosen,
      skipped: a.skipped + m.stats.skipped,
      noResponse: a.noResponse + m.stats.noResponse,
    }),
    { recommended: 0, chosen: 0, skipped: 0, noResponse: 0 },
  )
  const answered = total.chosen + total.skipped
  const pct = (n: number) => (answered === 0 ? '—' : `${Math.round((n / answered) * 100)}%`)
  const rows = [...menus].sort((a, b) => b.stats.recommended - a.stats.recommended)

  return (
    <div className={styles.stats}>
      <div className={styles.cards}>
        <div className={styles.card}><span>추천 요청</span><strong>{total.recommended}</strong><em>누적</em></div>
        <div className={styles.card}><span>채택</span><strong className={styles.good}>{total.chosen}</strong><em>응답 중 {pct(total.chosen)}</em></div>
        <div className={styles.card}><span>넘김</span><strong className={styles.warnText}>{total.skipped}</strong><em>응답 중 {pct(total.skipped)}</em></div>
        <div className={styles.card}><span>무응답</span><strong>{total.noResponse}</strong><em>추천만 받고 이탈</em></div>
      </div>

      <div className={styles.panelBox}>
        <header>
          <h3>메뉴별 성적</h3>
          <span>막대는 <b>응답 중 채택 비율</b> — 무응답은 빼고 계산합니다</span>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>메뉴</th><th>추천</th><th>채택</th><th>넘김</th><th>응답 중 채택</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const r = adoptionRate(m)
                const low = r !== null && r < 0.25
                return (
                  <tr key={m.id}>
                    <td className={styles.name}>{m.name}</td>
                    <td className={styles.num}>{m.stats.recommended}</td>
                    <td className={`${styles.num} ${styles.good}`}>{m.stats.chosen}</td>
                    <td className={`${styles.num} ${styles.warnText}`}>{m.stats.skipped}</td>
                    <td>
                      <div className={styles.barCell}>
                        <div className={styles.track}>
                          <div
                            className={`${styles.fill} ${low ? styles.fillLow : ''}`}
                            style={{ width: `${r === null ? 0 : r * 100}%` }}
                          />
                        </div>
                        <span className={styles.pct}>{r === null ? '—' : `${Math.round(r * 100)}%`}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
