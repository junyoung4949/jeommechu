import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCategories, type Category } from '../api/categories'
import { BUDGET_BUCKETS } from '../api/recommend'
import { checkMenuName, createMenu, type MenuDetail, type NameCheckResult } from '../api/menus'
import MenuFields, { type MenuFormValue } from '../components/MenuFields/MenuFields'
import styles from '../styles/menuForm.module.css'

interface Props {
  isLoggedIn: boolean
  onLoginClick: () => void
}

interface ApiError {
  status?: number
  code?: string
  message?: string
  detail?: Record<string, unknown>
}

function readApiError(err: unknown): ApiError {
  const res = (err as {
    response?: { status?: number; data?: { code?: string; message?: string; detail?: Record<string, unknown> } }
  })?.response
  return {
    status: res?.status,
    code: res?.data?.code,
    message: res?.data?.message,
    detail: res?.data?.detail,
  }
}

type Step = 'name' | 'detail' | 'done'

const EMPTY_FORM: MenuFormValue = {
  categoryIds: [],
  budgetTier: null,
  minPeople: 1,
  maxPeople: 4,
  description: '',
  imageUrl: null,
  imagePreview: null,
}

export default function MenuCreatePage({ isLoggedIn, onLoginClick }: Props) {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<NameCheckResult | null>(null)
  const [confirmedDistinct, setConfirmedDistinct] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState<MenuFormValue>(EMPTY_FORM)
  const [uploading, setUploading] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  const [created, setCreated] = useState<MenuDetail | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]))
  }, [])

  /** 고친 필드의 오류 문구는 함께 지운다. 안 지우면 방금 고쳤는데도 빨간 글씨가 남는다. */
  function patchForm(patch: Partial<MenuFormValue>) {
    setForm((prev) => ({ ...prev, ...patch }))
    setFieldErrors((prev) => prev.filter((field) => !(field in patch)))
  }

  function resetAll() {
    setStep('name')
    setName('')
    setCheck(null)
    setConfirmedDistinct(false)
    setForm(EMPTY_FORM)
    setError('')
    setFieldErrors([])
    setCreated(null)
  }

  async function handleCheck() {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 30) {
      setError('메뉴 이름은 1~30자로 입력해 주세요.')
      return
    }
    setError('')
    setCheck(null)
    setConfirmedDistinct(false)
    setChecking(true)
    try {
      const result = await checkMenuName(trimmed)
      setCheck(result)
      // PASS 면 곧바로 상세 입력으로 넘어간다 (화면 4-4)
      if (result.verdict === 'PASS') setStep('detail')
    } catch (err) {
      setError(readApiError(err).message ?? '중복확인에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setChecking(false)
    }
  }

  async function handleSubmit() {
    const invalid: string[] = []
    if (form.categoryIds.length === 0) invalid.push('categoryIds')
    if (!form.budgetTier) invalid.push('budgetTier')
    if (form.maxPeople < form.minPeople) invalid.push('maxPeople')
    if (form.description.length > 50) invalid.push('description')
    if (!form.imageUrl) invalid.push('imageUrl')

    // budgetTier / imageUrl 을 따로 좁히는 이유: invalid 배열만 보면 타입이 안 좁혀져
    // 아래에서 non-null 단언(!)을 써야 한다. 검사와 사용을 한 조건에 묶어 단언을 없앤다.
    if (invalid.length > 0 || !form.budgetTier || !form.imageUrl) {
      setFieldErrors(invalid)
      setError('필수 항목을 확인해 주세요.')
      return
    }

    setError('')
    setFieldErrors([])
    setSubmitting(true)
    try {
      const menu = await createMenu({
        name: name.trim(),
        categoryIds: form.categoryIds,
        budgetTier: form.budgetTier,
        minPeople: form.minPeople,
        maxPeople: form.maxPeople,
        imageUrl: form.imageUrl,
        description: form.description.trim() || null,
        confirmedDistinct,
      })
      setCreated(menu)
      setStep('done')
    } catch (err) {
      const { code, message, detail } = readApiError(err)

      // 서버가 판정을 재수행하므로, 중복확인을 건너뛰었거나 그 사이 다른 사람이
      // 같은 메뉴를 등록했다면 여기서 처음 걸린다. 이름 단계로 되돌려 안내한다.
      if (code === 'DUPLICATE_MENU') {
        setCheck({
          input: name,
          normalized: name,
          verdict: 'DUPLICATE',
          matched: (detail?.matched as NameCheckResult['matched']) ?? null,
          candidates: [],
        })
        setStep('name')
      } else if (code === 'SIMILAR_NOT_CONFIRMED') {
        setCheck({
          input: name,
          normalized: name,
          verdict: 'SIMILAR',
          matched: null,
          candidates: (detail?.candidates as NameCheckResult['candidates']) ?? [],
        })
        setStep('name')
      } else if (code === 'VALIDATION_ERROR') {
        setFieldErrors((detail?.fields as string[]) ?? [])
        setError(message ?? '입력값을 확인해 주세요.')
      } else if (code === 'UNAUTHORIZED') {
        setError('로그인이 만료됐어요. 다시 로그인해 주세요.')
      } else {
        setError(message ?? '등록에 실패했어요. 다시 시도해 주세요.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ---- 비로그인 -------------------------------------------------------
  if (!isLoggedIn) {
    return (
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.title}>메뉴 등록</h1>
          <div className={styles.card}>
            <p className={styles.guideText}>
              메뉴를 등록하려면 로그인이 필요해요.
            </p>
            <button className={styles.primaryBtn} onClick={onLoginClick}>
              로그인하기
            </button>
            <button className={styles.ghostBtn} onClick={() => navigate('/')}>
              홈으로
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <h1 className={styles.title}>메뉴 등록</h1>
        <p className={styles.subTitle}>
          {step === 'done' ? '등록이 완료됐어요' : '없는 메뉴를 직접 추가할 수 있어요'}
        </p>

        {/* ---------- STEP 1 : 이름 + 중복확인 ---------- */}
        {step === 'name' && (
          <div className={styles.card}>
            <label className={styles.label}>메뉴 이름</label>
            <div className={styles.nameRow}>
              <input
                className={styles.input}
                value={name}
                maxLength={30}
                placeholder="예) 마라샹궈"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCheck()
                }}
              />
              <button
                className={styles.checkBtn}
                onClick={handleCheck}
                disabled={checking || name.trim().length === 0}
              >
                {checking ? '확인 중...' : '중복확인'}
              </button>
            </div>

            {/* 화면 4-1 : 이형어 사전 일치 */}
            {check?.verdict === 'DUPLICATE' && check.matched?.matchType === 'ALIAS' && (
              <div className={`${styles.verdict} ${styles.blocked}`}>
                <strong>이미 등록된 메뉴예요</strong>
                <p>
                  &lsquo;{check.input}&rsquo;은(는) <b>&lsquo;{check.matched.name}&rsquo;</b>(으)로 등록되어 있어요.
                  같은 메뉴의 다른 이름이라 새로 등록할 수 없어요.
                </p>
                <button className={styles.ghostBtn} onClick={resetAll}>
                  다른 이름으로 등록
                </button>
              </div>
            )}

            {/* 화면 4-2 : 정규화 후 완전일치 */}
            {check?.verdict === 'DUPLICATE' && check.matched?.matchType === 'EXACT' && (
              <div className={`${styles.verdict} ${styles.blocked}`}>
                <strong>이미 등록된 메뉴예요</strong>
                <p>
                  &lsquo;{check.matched.name}&rsquo;은(는) 이미 목록에 있어요.
                </p>
                <button className={styles.ghostBtn} onClick={resetAll}>
                  다른 이름으로 등록
                </button>
              </div>
            )}

            {/* 화면 4-3 : 유사 후보 → 사용자 확인 */}
            {check?.verdict === 'SIMILAR' && (
              <div className={`${styles.verdict} ${styles.similar}`}>
                <strong>
                  혹시 &lsquo;{check.candidates[0]?.name}&rsquo; 말씀이신가요?
                </strong>
                <ul className={styles.candidateList}>
                  {check.candidates.map((c) => (
                    <li key={c.id}>
                      {c.name}
                      <span className={styles.similarity}>
                        유사도 {Math.round(c.similarity * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.verdictActions}>
                  <button className={styles.ghostBtn} onClick={resetAll}>
                    네, 그거예요
                  </button>
                  <button
                    className={styles.primaryBtn}
                    onClick={() => {
                      setConfirmedDistinct(true)
                      setStep('detail')
                    }}
                  >
                    아니요, 다른 메뉴예요
                  </button>
                </div>
              </div>
            )}

            {error && <p className={styles.error}>{error}</p>}
          </div>
        )}

        {/* ---------- STEP 2 : 상세 입력 ---------- */}
        {step === 'detail' && (
          <div className={styles.card}>
            <div className={styles.nameBadge}>
              <span className={styles.nameBadgeLabel}>메뉴 이름</span>
              <b>{name.trim()}</b>
              <button
                className={styles.linkBtn}
                onClick={() => {
                  setStep('name')
                  setCheck(null)
                  setConfirmedDistinct(false)
                }}
              >
                수정
              </button>
            </div>
            {confirmedDistinct && (
              <p className={styles.note}>
                비슷한 메뉴와 다른 메뉴로 확인하셨어요.
              </p>
            )}

            <MenuFields
              categories={categories}
              value={form}
              onChange={patchForm}
              fieldErrors={fieldErrors}
              uploading={uploading}
              onUploadingChange={setUploading}
              onError={setError}
            />

            {error && <p className={styles.error}>{error}</p>}

            <button
              className={styles.primaryBtn}
              onClick={handleSubmit}
              disabled={submitting || uploading}
            >
              {submitting ? '등록 중...' : '등록하기'}
            </button>
          </div>
        )}

        {/* ---------- STEP 3 : 완료 ---------- */}
        {step === 'done' && created && (
          <div className={styles.card}>
            <div className={styles.doneMark}>✓</div>
            <h2 className={styles.doneTitle}>{created.name}</h2>
            <dl className={styles.summary}>
              <div>
                <dt>카테고리</dt>
                <dd>{created.categories.map((c) => c.name).join(', ')}</dd>
              </div>
              <div>
                <dt>가격대</dt>
                <dd>
                  {BUDGET_BUCKETS.find((b) => b.value === created.budgetTier)?.label ??
                    created.budgetTier}
                </dd>
              </div>
              <div>
                <dt>적합 인원</dt>
                <dd>{created.minPeople}~{created.maxPeople}명</dd>
              </div>
              {created.description && (
                <div>
                  <dt>설명</dt>
                  <dd>{created.description}</dd>
                </div>
              )}
              {created.createdBy && (
                <div>
                  <dt>등록자</dt>
                  <dd>{created.createdBy.nickname}</dd>
                </div>
              )}
            </dl>
            <button className={styles.primaryBtn} onClick={resetAll}>
              메뉴 더 등록하기
            </button>
            <button className={styles.ghostBtn} onClick={() => navigate('/')}>
              홈으로
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
