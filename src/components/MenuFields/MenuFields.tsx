import { BUDGET_BUCKETS, type BudgetTier } from '../../api/recommend'
import type { Category } from '../../api/categories'
import { uploadMenuImage } from '../../api/menus'
import { errorOf } from '../../api/client'
import { shrinkImageForUpload } from '../../lib/resizeImage'
import styles from '../../styles/menuForm.module.css'

/** 등록·수정이 함께 다루는 메뉴의 속성. 이름은 다루는 방식이 달라 여기 없다. */
export interface MenuFormValue {
  categoryIds: number[]
  budgetTier: BudgetTier | null
  minPeople: number
  maxPeople: number
  description: string
  /** 서버에 보낼 주소. `POST /images` 가 돌려준 값만 들어온다. */
  imageUrl: string | null
  /** 화면에 보여줄 주소. 새로 올린 사진은 blob URL, 기존 사진은 서버 URL 이다. */
  imagePreview: string | null
}

interface Props {
  categories: Category[]
  value: MenuFormValue
  onChange: (patch: Partial<MenuFormValue>) => void
  /** 서버가 돌려준 필드 이름들. 그 자리에 문구를 띄운다. */
  fieldErrors: string[]
  uploading: boolean
  onUploadingChange: (uploading: boolean) => void
  onError: (message: string) => void
  /**
   * 사진을 비울 수 있는지. 등록 화면은 다시 고르면 되지만, 수정 화면에서는 비울 수 없다 —
   * `menus.image_url` 이 NOT NULL 이라 사진 없는 메뉴는 존재할 수 없다.
   */
  allowRemoveImage?: boolean
}

const PEOPLE_RANGE = [1, 2, 3, 4, 5, 6, 7, 8]

/**
 * 메뉴의 속성 입력 묶음. 등록 화면의 2단계와 수정 화면이 이걸 함께 쓴다.
 *
 * 사진 업로드까지 여기서 맡는다 — 두 화면이 똑같이 "줄여서 올리고 미리보기를 바꾸는" 일을
 * 하기 때문이다. 올리는 동안 저장을 막는 건 부모의 일이라 `onUploadingChange` 로 알려준다.
 */
export default function MenuFields({
  categories,
  value,
  onChange,
  fieldErrors,
  uploading,
  onUploadingChange,
  onError,
  allowRemoveImage = true,
}: Props) {
  const invalid = (field: string) => fieldErrors.includes(field)

  function toggleCategory(id: number) {
    onChange({
      categoryIds: value.categoryIds.includes(id)
        ? value.categoryIds.filter((c) => c !== id)
        : [...value.categoryIds, id],
    })
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // 같은 파일 재선택도 인식되도록
    if (!file) return

    onError('')
    onUploadingChange(true)
    try {
      // 원본이 아니라 줄인 사진을 올린다. 미리보기도 올린 것과 같은 사진이어야
      // 사용자가 보는 화질과 실제 등록되는 화질이 어긋나지 않는다.
      const upload = await shrinkImageForUpload(file)
      const url = await uploadMenuImage(upload)
      onChange({ imageUrl: url, imagePreview: URL.createObjectURL(upload) })
    } catch (err) {
      const { code, message } = errorOf(err)
      onError(
        code === 'FILE_TOO_LARGE'
          ? '이미지는 최대 5MB까지 올릴 수 있어요.'
          : message ?? '이미지 업로드에 실패했어요.',
      )
    } finally {
      onUploadingChange(false)
    }
  }

  return (
    <>
      <section className={styles.section}>
        <label className={styles.label}>
          카테고리 <span className={styles.req}>필수</span>
        </label>
        <div className={styles.chips}>
          {categories.map(({ id, name }) => (
            <button
              key={id}
              className={`${styles.chip} ${value.categoryIds.includes(id) ? styles.active : ''}`}
              onClick={() => toggleCategory(id)}
            >
              {name}
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
          {BUDGET_BUCKETS.map(({ value: tier, label }) => (
            <button
              key={tier}
              className={`${styles.chip} ${value.budgetTier === tier ? styles.active : ''}`}
              onClick={() => onChange({ budgetTier: value.budgetTier === tier ? null : tier })}
            >
              {label}
            </button>
          ))}
        </div>
        {invalid('budgetTier') && <p className={styles.fieldError}>가격대를 선택해 주세요.</p>}
      </section>

      <section className={styles.section}>
        <label className={styles.label}>
          적합 인원 <span className={styles.req}>필수</span>
        </label>
        <p className={styles.hint}>몇 명이서 먹기 좋은 메뉴인가요?</p>
        <div className={styles.peopleRow}>
          <select
            className={styles.select}
            value={value.minPeople}
            onChange={(e) => onChange({ minPeople: Number(e.target.value) })}
            aria-label="최소 인원"
          >
            {PEOPLE_RANGE.map((n) => (
              <option key={n} value={n}>{n}명</option>
            ))}
          </select>
          <span className={styles.tilde}>~</span>
          <select
            className={styles.select}
            value={value.maxPeople}
            onChange={(e) => onChange({ maxPeople: Number(e.target.value) })}
            aria-label="최대 인원"
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
          사진 <span className={styles.req}>필수</span>
        </label>
        {value.imagePreview ? (
          <div className={styles.imageBox}>
            <img src={value.imagePreview} alt="미리보기" className={styles.imagePreview} />
            <label className={styles.linkBtn} style={{ marginLeft: 0 }}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={styles.fileInput}
                onChange={handleFile}
                disabled={uploading}
              />
              {uploading ? '업로드 중...' : '사진 교체'}
            </label>
            {allowRemoveImage && (
              <button
                className={styles.linkBtn}
                style={{ marginLeft: 0 }}
                onClick={() => onChange({ imageUrl: null, imagePreview: null })}
              >
                사진 제거
              </button>
            )}
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
            {/*
              올리기 전에 긴 변 1280px 로 줄이므로 큰 사진도 그냥 고르면 된다.
              5MB 상한은 그대로지만 줄인 뒤에 걸리는 일은 사실상 없어서 안내하지 않는다.
            */}
            {uploading ? '업로드 중...' : '사진 선택 (jpg / png / webp)'}
          </label>
        )}
        {/*
          등록된 사진은 모든 사용자에게 공개된다. 웹에서 가져온 사진을 올리면
          저작권 문제가 되므로, 업로드 직전에 한 번 짚어 준다.
        */}
        <p className={styles.fieldHint}>
          직접 찍은 사진만 올려주세요. 웹에서 가져온 사진은 저작권 문제가 될 수 있어요.
        </p>
        {invalid('imageUrl') && (
          <p className={styles.fieldError}>
            {value.imageUrl
              ? '사진을 등록하지 못했어요. 다시 올려주세요.'
              : '메뉴 사진을 등록해 주세요.'}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <label className={styles.label}>
          한 줄 설명 <span className={styles.opt}>선택</span>
        </label>
        <input
          className={styles.input}
          value={value.description}
          maxLength={50}
          placeholder="예) 얼큰하고 든든해요"
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <p className={styles.counter}>{value.description.length} / 50</p>
        {invalid('description') && (
          <p className={styles.fieldError}>설명은 50자 이하로 입력해 주세요.</p>
        )}
      </section>
    </>
  )
}
