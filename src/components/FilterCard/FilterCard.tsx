import { useState } from 'react'
import type { Category } from '../../api/categories'
import type { BudgetTier } from '../../api/recommend'
import styles from './FilterCard.module.css'

export interface FilterState {
  people: number | null
  budgetTier: BudgetTier | null
  categories: number[]
}

interface Props {
  categories: Category[]
  filters: FilterState
  onChange: (filters: FilterState) => void
}

const PEOPLE_OPTIONS = [
  { value: 1, label: '1명' },
  { value: 2, label: '2명' },
  { value: 3, label: '3명+' },
]

// 예산은 "상한"이다. 예를 들어 '~1만' 을 고르면 1만원 미만 구간까지 전부 후보가 된다.
// 마지막 '2만+' 은 상한이 없다는 뜻이라 사실상 예산 제한 없음과 같다.
const BUDGET_OPTIONS: { value: BudgetTier; label: string }[] = [
  { value: 'UNDER_5000', label: '~5천' },
  { value: 'W5000_10000', label: '~1만' },
  { value: 'W10000_15000', label: '~1만5천' },
  { value: 'W15000_20000', label: '~2만' },
  { value: 'OVER_20000', label: '2만+' },
]

export default function FilterCard({ categories, filters, onChange }: Props) {
  const [open, setOpen] = useState(true)

  function toggleCategory(id: number) {
    const next = filters.categories.includes(id)
      ? filters.categories.filter((c) => c !== id)
      : [...filters.categories, id]
    onChange({ ...filters, categories: next })
  }

  return (
    <div className={styles.wrapper}>
      <button className={styles.toggleHeader} onClick={() => setOpen((v) => !v)}>
        <span className={styles.toggleIcon}>≡</span>
        <span className={styles.toggleLabel}>필터</span>
        <span className={styles.toggleFold}>{open ? '∧ 접기' : '∨ 펼치기'}</span>
      </button>

      {open && (
        <div className={styles.card}>
          <section className={styles.section}>
            <p className={styles.sectionLabel}>👤 인원수</p>
            <div className={styles.chips}>
              {PEOPLE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.chip} ${filters.people === value ? styles.active : ''}`}
                  onClick={() => onChange({ ...filters, people: filters.people === value ? null : value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <div className={styles.divider} />

          <section className={styles.section}>
            <p className={styles.sectionLabel}>₩ 예산</p>
            <div className={styles.chips}>
              {BUDGET_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.chip} ${filters.budgetTier === value ? styles.active : ''}`}
                  onClick={() =>
                    onChange({ ...filters, budgetTier: filters.budgetTier === value ? null : value })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <div className={styles.divider} />

          <section className={styles.section}>
            <p className={styles.sectionLabel}>⊞ 카테고리</p>
            <div className={styles.chips}>
              {categories.map(({ id, name }) => (
                <button
                  key={id}
                  className={`${styles.chip} ${filters.categories.includes(id) ? styles.active : ''}`}
                  onClick={() => toggleCategory(id)}
                >
                  {name}
                </button>
              ))}
              <button
                className={`${styles.chip} ${filters.categories.length === 0 ? styles.active : ''}`}
                onClick={() => onChange({ ...filters, categories: [] })}
              >
                상관없음
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
