import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCategories, type Category } from '../api/categories'
import type { BudgetTier } from '../api/recommend'
import {
  checkMenuName,
  createMenu,
  uploadMenuImage,
  type MenuDetail,
  type NameCheckResult,
} from '../api/menus'
import styles from './MenuCreatePage.module.css'

interface Props {
  isLoggedIn: boolean
  onLoginClick: () => void
}

/**
 * 등록 화면의 예산은 **그 메뉴가 속한 버킷 하나**를 고르는 것이다.
 * 추천 필터의 "상한" 해석과 의미가 다르므로 라벨도 다르게 쓴다.
 */
const BUDGET_BUCKETS: { value: BudgetTier; label: string }[] = [
  { value: 'UNDER_5000', label: '5천원 미만' },
  { value: 'W5000_10000', label: '5천원대' },
  { value: 'W10000_15000', label: '1만원대' },
  { value: 'W15000_20000', label: '1만5천원대' },
  { value: 'OVER_20000', label: '2만원 이상' },
]

const PEOPLE_RANGE = [1, 2, 3, 4, 5, 6, 7, 8]

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

export default function MenuCreatePage({ isLoggedIn, onLoginClick }: Props) {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<NameCheckResult | null>(null)
  const [confirmedDistinct, setConfirmedDistinct] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryIds, setCategoryIds] = useState<number[]>([])
  const [budgetTier, setBudgetTier] = useState<BudgetTier | null>(null)
  const [minPeople, setMinPeople] = useState(1)
  const [maxPeople, setMaxPeople] = useState(4)
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  const [created, setCreated] = useState<MenuDetail | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]))
  }, [])

  function resetAll() {
    setStep('name')
    setName('')
    setCheck(null)
    setConfirmedDistinct(false)
    setCategoryIds([])
    setBudgetTier(null)
    setMinPeople(1)
    setMaxPeople(4)
    setDescription('')
    setImageUrl(null)
    setImagePreview(null)
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

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // 같은 파일 재선택도 인식되도록
    if (!file) return

    setError('')
    setUploading(true)
    try {
      const url = await uploadMenuImage(file)
      setImageUrl(url)
      setImagePreview(URL.createObjectURL(file))
    } catch (err) {
      const { code, message } = readApiError(err)
      setError(
        code === 'FILE_TOO_LARGE'
          ? '이미지는 최대 5MB까지 올릴 수 있어요.'
          : message ?? '이미지 업로드에 실패했어요.',
      )
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    const invalid: string[] = []
    if (categoryIds.length === 0) invalid.push('categoryIds')
    if (!budgetTier) invalid.push('budgetTier')
    if (maxPeople < minPeople) invalid.push('maxPeople')
    if (description.length > 50) invalid.push('description')

    if (invalid.length > 0) {
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
        categoryIds,
        budgetTier: budgetTier!,
        minPeople,
        maxPeople,
        imageUrl,
        description: description.trim() || null,
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

  function toggleCategory(id: number) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const invalid = (field: string) => fieldErrors.includes(field)

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

            <section className={styles.section}>
              <label className={styles.label}>
                카테고리 <span className={styles.req}>필수</span>
              </label>
              <div className={styles.chips}>
                {categories.map(({ id, name: catName }) => (
                  <button
                    key={id}
                    className={`${styles.chip} ${categoryIds.includes(id) ? styles.active : ''}`}
                    onClick={() => toggleCategory(id)}
                  >
                    {catName}
                  </button>
                ))}
              </div>
              {invalid('categoryIds') && (
                <p className={styles.fieldError}>카테고리를 1개 이상 선택해 주세요.</p>
              )}
            </section>

            <section className={styles.section}>
              <label className={styles.label}>
                가격대 <span className={styles.req}>필수</span>
              </label>
              <p className={styles.hint}>이 메뉴의 1인분 가격이 속한 구간을 골라 주세요.</p>
              <div className={styles.chips}>
                {BUDGET_BUCKETS.map(({ value, label }) => (
                  <button
                    key={value}
                    className={`${styles.chip} ${budgetTier === value ? styles.active : ''}`}
                    onClick={() => setBudgetTier(budgetTier === value ? null : value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {invalid('budgetTier') && (
                <p className={styles.fieldError}>가격대를 선택해 주세요.</p>
              )}
            </section>

            <section className={styles.section}>
              <label className={styles.label}>
                적합 인원 <span className={styles.req}>필수</span>
              </label>
              <p className={styles.hint}>몇 명이서 먹기 좋은 메뉴인가요?</p>
              <div className={styles.peopleRow}>
                <select
                  className={styles.select}
                  value={minPeople}
                  onChange={(e) => setMinPeople(Number(e.target.value))}
                >
                  {PEOPLE_RANGE.map((n) => (
                    <option key={n} value={n}>{n}명</option>
                  ))}
                </select>
                <span className={styles.tilde}>~</span>
                <select
                  className={styles.select}
                  value={maxPeople}
                  onChange={(e) => setMaxPeople(Number(e.target.value))}
                >
                  {PEOPLE_RANGE.map((n) => (
                    <option key={n} value={n}>{n}명</option>
                  ))}
                </select>
              </div>
              {invalid('maxPeople') && (
                <p className={styles.fieldError}>최대 인원은 최소 인원보다 크거나 같아야 해요.</p>
              )}
            </section>

            <section className={styles.section}>
              <label className={styles.label}>
                사진 <span className={styles.opt}>선택</span>
              </label>
              {imagePreview ? (
                <div className={styles.imageBox}>
                  <img src={imagePreview} alt="미리보기" className={styles.imagePreview} />
                  <button
                    className={styles.linkBtn}
                    onClick={() => {
                      setImageUrl(null)
                      setImagePreview(null)
                    }}
                  >
                    사진 제거
                  </button>
                </div>
              ) : (
                <label className={styles.fileLabel}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className={styles.fileInput}
                    onChange={handleFile}
                    disabled={uploading}
                  />
                  {uploading ? '업로드 중...' : '사진 선택 (jpg / png / webp, 5MB 이하)'}
                </label>
              )}
              {invalid('imageUrl') && (
                <p className={styles.fieldError}>이미지 주소가 올바르지 않아요. 다시 업로드해 주세요.</p>
              )}
            </section>

            <section className={styles.section}>
              <label className={styles.label}>
                한 줄 설명 <span className={styles.opt}>선택</span>
              </label>
              <input
                className={styles.input}
                value={description}
                maxLength={50}
                placeholder="예) 얼큰하고 든든해요"
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className={styles.counter}>{description.length} / 50</p>
              {invalid('description') && (
                <p className={styles.fieldError}>설명은 50자 이하로 입력해 주세요.</p>
              )}
            </section>

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
