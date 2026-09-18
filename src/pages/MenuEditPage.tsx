import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchCategories, type Category } from '../api/categories'
import {
  checkMenuName,
  fetchMenu,
  patchMenu,
  type MenuDetail,
  type MenuPatch,
  type NameCheckResult,
} from '../api/menus'
import { errorOf } from '../api/client'
import type { MeResponse } from '../api/auth'
import MenuFields, { type MenuFormValue } from '../components/MenuFields/MenuFields'
import styles from '../styles/menuForm.module.css'

interface Props {
  me: MeResponse
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sorted = [...b].sort()
  return [...a].sort().every((v, i) => v === sorted[i])
}

export default function MenuEditPage({ me }: Props) {
  const navigate = useNavigate()
  const { id } = useParams()
  const menuId = Number(id)

  const [categories, setCategories] = useState<Category[]>([])
  /** 불러온 원본. 바뀐 필드만 보내야 하므로 끝까지 들고 있는다. */
  const [original, setOriginal] = useState<MenuDetail | null>(null)
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [form, setForm] = useState<MenuFormValue>({
    categoryIds: [],
    budgetTier: null,
    minPeople: 1,
    maxPeople: 4,
    description: '',
    imageUrl: null,
    imagePreview: null,
  })

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  /** 이름을 바꿨을 때 미리 확인한 결과. 서버가 막는 것과 알려만 주는 것이 다르다. */
  const [nameCheck, setNameCheck] = useState<NameCheckResult | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    if (!Number.isInteger(menuId) || menuId < 1) {
      setLoadError('잘못된 주소예요.')
      return
    }
    fetchMenu(menuId)
      .then((menu) => {
        setOriginal(menu)
        setName(menu.name)
        setForm({
          categoryIds: menu.categories.map((c) => c.id),
          budgetTier: menu.budgetTier,
          minPeople: menu.minPeople,
          maxPeople: menu.maxPeople,
          description: menu.description ?? '',
          // 사진을 실제로 바꿨을 때만 imageUrl 이 채워진다. 기존 주소를 그대로 돌려보내면
          // 외부(초기 데이터) 주소인 경우 서버가 VALIDATION_ERROR 로 막기 때문이다.
          imageUrl: null,
          imagePreview: menu.imageUrl,
        })
      })
      .catch((err) => {
        setLoadError(
          errorOf(err).code === 'NOT_FOUND'
            ? '존재하지 않는 메뉴예요.'
            : '메뉴를 불러오지 못했어요.',
        )
      })
  }, [menuId])

  function patchForm(patch: Partial<MenuFormValue>) {
    setForm((prev) => ({ ...prev, ...patch }))
    setFieldErrors((prev) => prev.filter((field) => !(field in patch)))
  }

  /** 원본과 다른 값만 담는다. 안 보낸 필드는 서버가 그대로 둔다. */
  function buildPatch(menu: MenuDetail): MenuPatch {
    const patch: MenuPatch = {}
    const trimmedName = name.trim()
    if (trimmedName !== menu.name) patch.name = trimmedName
    if (!sameIds(form.categoryIds, menu.categories.map((c) => c.id))) {
      patch.categoryIds = form.categoryIds
    }
    if (form.budgetTier && form.budgetTier !== menu.budgetTier) patch.budgetTier = form.budgetTier
    if (form.minPeople !== menu.minPeople) patch.minPeople = form.minPeople
    if (form.maxPeople !== menu.maxPeople) patch.maxPeople = form.maxPeople
    const description = form.description.trim() || null
    if (description !== menu.description) patch.description = description
    // 새로 올렸을 때만 들어 있다.
    if (form.imageUrl) patch.imageUrl = form.imageUrl
    return patch
  }

  async function handleSave() {
    if (!original) return

    const invalid: string[] = []
    if (name.trim().length < 1 || name.trim().length > 30) invalid.push('name')
    if (form.categoryIds.length === 0) invalid.push('categoryIds')
    if (!form.budgetTier) invalid.push('budgetTier')
    if (form.maxPeople < form.minPeople) invalid.push('maxPeople')
    if (form.description.length > 50) invalid.push('description')
    if (invalid.length > 0) {
      setFieldErrors(invalid)
      setError(invalid.includes('name') ? '메뉴 이름은 1~30자로 입력해 주세요.' : '필수 항목을 확인해 주세요.')
      return
    }

    const patch = buildPatch(original)
    if (Object.keys(patch).length === 0) {
      setError('바뀐 내용이 없어요.')
      return
    }

    setError('')
    setFieldErrors([])
    setSaving(true)
    try {
      // 이름을 바꿨다면 먼저 물어본다. 서버는 완전 중복만 막지만, 비슷한 메뉴가 있다는 건
      // 저장 전에 알려주는 편이 낫다 — 등록 화면과 같은 판정을 쓴다.
      if (patch.name) {
        const result = await checkMenuName(patch.name)
        if (result.verdict === 'DUPLICATE') {
          setNameCheck(result)
          setFieldErrors(['name'])
          setSaving(false)
          return
        }
        // SIMILAR 는 막지 않는다. 한 번 보여주고, 그대로 저장을 누르면 진행된다.
        if (result.verdict === 'SIMILAR' && nameCheck?.verdict !== 'SIMILAR') {
          setNameCheck(result)
          setSaving(false)
          return
        }
      }

      await patchMenu(original.id, patch)
      navigate(`/menus/${original.id}`)
    } catch (err) {
      const { code, message, detail } = errorOf(err)
      if (code === 'DUPLICATE_MENU') {
        setFieldErrors(['name'])
        setError('같은 이름의 메뉴가 이미 있어요.')
      } else if (code === 'VALIDATION_ERROR') {
        setFieldErrors((detail?.fields as string[]) ?? [])
        setError(message ?? '입력값을 확인해 주세요.')
      } else if (code === 'FORBIDDEN') {
        setError('내가 등록한 메뉴만 고칠 수 있어요.')
      } else if (code === 'UNAUTHORIZED') {
        setError('로그인이 만료됐어요. 다시 로그인해 주세요.')
      } else {
        setError(message ?? '저장하지 못했어요. 다시 시도해 주세요.')
      }
      setSaving(false)
    }
  }

  // ---- 불러오기 실패 / 로딩 -------------------------------------------
  if (loadError) {
    return (
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.title}>메뉴 수정</h1>
          <div className={styles.card}>
            <p className={styles.guideText}>{loadError}</p>
            <button className={styles.ghostBtn} onClick={() => navigate('/me')}>
              마이페이지로
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (!original) {
    return (
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.title}>메뉴 수정</h1>
          <p className={styles.subTitle}>불러오는 중...</p>
        </div>
      </main>
    )
  }

  // ---- 남의 메뉴 -------------------------------------------------------
  // 감추는 건 편의일 뿐이다 — 주소를 직접 쳐서 들어와도 서버가 403 으로 막는다.
  const mine = original.createdBy?.id === me.id
  if (!mine && !me.isManager) {
    return (
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.title}>메뉴 수정</h1>
          <div className={styles.card}>
            <p className={styles.guideText}>
              {original.createdBy
                ? '내가 등록한 메뉴만 고칠 수 있어요.'
                : '점메추 기본 메뉴는 고칠 수 없어요.'}
            </p>
            <button className={styles.ghostBtn} onClick={() => navigate(`/menus/${original.id}`)}>
              메뉴 보기
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <h1 className={styles.title}>메뉴 수정</h1>
        <p className={styles.subTitle}>바꾼 항목만 저장돼요</p>

        <div className={styles.card}>
          <label className={styles.label}>메뉴 이름</label>
          <input
            className={styles.input}
            value={name}
            maxLength={30}
            onChange={(e) => {
              setName(e.target.value)
              setNameCheck(null)
              setFieldErrors((prev) => prev.filter((f) => f !== 'name'))
            }}
          />
          {name.trim() !== original.name && (
            <p className={styles.fieldHint}>
              이름을 바꾸면 저장할 때 중복 확인을 다시 합니다.
            </p>
          )}

          {nameCheck?.verdict === 'DUPLICATE' && (
            <div className={`${styles.verdict} ${styles.blocked}`}>
              <strong>이미 등록된 이름이에요</strong>
              <p>
                &lsquo;{nameCheck.matched?.name ?? nameCheck.input}&rsquo;(으)로 이미 있어요.
                다른 이름을 써주세요.
              </p>
            </div>
          )}

          {nameCheck?.verdict === 'SIMILAR' && (
            <div className={`${styles.verdict} ${styles.similar}`}>
              <strong>비슷한 메뉴가 있어요</strong>
              <ul className={styles.candidateList}>
                {nameCheck.candidates.map((c) => (
                  <li key={c.id}>
                    {c.name}
                    <span className={styles.similarity}>
                      유사도 {Math.round(c.similarity * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
              <p>다른 메뉴가 맞다면 그대로 저장하세요.</p>
            </div>
          )}

          <MenuFields
            categories={categories}
            value={form}
            onChange={patchForm}
            fieldErrors={fieldErrors}
            uploading={uploading}
            onUploadingChange={setUploading}
            onError={setError}
            // 사진 없는 메뉴는 존재할 수 없다 (menus.image_url NOT NULL).
            allowRemoveImage={false}
          />

          {error && <p className={styles.error}>{error}</p>}

          <button
            className={styles.primaryBtn}
            onClick={handleSave}
            disabled={saving || uploading}
          >
            {saving ? '저장 중...' : '저장하기'}
          </button>
          <button className={styles.ghostBtn} onClick={() => navigate(-1)} disabled={saving}>
            취소
          </button>
        </div>
      </div>
    </main>
  )
}
