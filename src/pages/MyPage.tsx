import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar/Avatar'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  NICKNAME_MAX,
  NICKNAME_MIN,
  deleteAccount,
  deleteProfileImage,
  updateNickname,
  uploadProfileImage,
  type MeResponse,
} from '../api/auth'
import { errorOf } from '../api/client'
import {
  adoptionRate,
  answeredCount,
  deleteMenu,
  fetchMyMenus,
  type MyMenu,
  type MyMenusResponse,
} from '../api/menus'
import { budgetLabel } from '../api/recommend'
import styles from './MyPage.module.css'

interface Props {
  me: MeResponse
  /** 닉네임·사진이 바뀌면 새 사용자 정보를 위로 올려보낸다 (헤더 아바타가 같이 갱신된다). */
  onMeChange: (me: MeResponse) => void
  onLogout: () => void
  /** 탈퇴가 끝났을 때. 세션은 이미 서버에서 폐기됐으므로 로그아웃 호출 없이 상태만 비운다. */
  onLeave: () => void
}

function pctText(r: number | null): string {
  return r === null ? '–' : `${(r * 100).toFixed(1)}%`
}

function formatDay(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

export default function MyPage({ me, onMeChange, onLogout, onLeave }: Props) {
  const navigate = useNavigate()
  const [data, setData] = useState<MyMenusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      setData(await fetchMyMenus())
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <ProfileCard me={me} onMeChange={onMeChange} />
        <MenusCard data={data} loading={loading} failed={loadFailed} onReload={load} />
        <AccountCard
          nickname={me.nickname}
          menuCount={data?.menus.length ?? 0}
          // 로그아웃·탈퇴 뒤에는 이 화면에 남을 이유가 없다 (남으면 로그인 안내가 뜬다).
          onLogout={() => {
            onLogout()
            navigate('/')
          }}
          onLeave={() => {
            onLeave()
            navigate('/')
          }}
        />
      </div>
    </main>
  )
}

/* ── 프로필 ─────────────────────────────────────────────── */

function ProfileCard({ me, onMeChange }: { me: MeResponse; onMeChange: (me: MeResponse) => void }) {
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(me.nickname)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const trimmed = nickname.trim()
  const tooShort = trimmed.length < NICKNAME_MIN
  const unchanged = trimmed === me.nickname

  function startEdit() {
    setNickname(me.nickname)
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setError(null)
  }

  async function saveNickname() {
    if (tooShort || unchanged || busy) return
    setBusy(true)
    setError(null)
    try {
      onMeChange(await updateNickname(trimmed))
      setEditing(false)
    } catch (err) {
      const e = errorOf(err)
      setError(
        e.code === 'NICKNAME_TAKEN'
          ? '이미 쓰고 있는 닉네임이에요.'
          : e.message ?? '닉네임을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
    e.target.value = ''
    if (!file) return

    // 서버도 같은 검사를 하지만, 확실한 거절을 왕복 없이 바로 보여준다.
    if (!AVATAR_MIME_TYPES.includes(file.type)) {
      setError('jpg / png / webp 만 올릴 수 있어요.')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('사진은 최대 2MB까지 올릴 수 있어요.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      onMeChange(await uploadProfileImage(file))
    } catch {
      setError('사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    setBusy(true)
    setError(null)
    try {
      onMeChange(await deleteProfileImage())
    } catch {
      setError('사진을 지우지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.profile}>
        <Avatar nickname={me.nickname} imageUrl={me.profileImageUrl} size={56} />

        {editing ? (
          <div className={styles.nickForm}>
            <input
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, NICKNAME_MAX))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveNickname()
                if (e.key === 'Escape') cancelEdit()
              }}
              maxLength={NICKNAME_MAX}
              aria-label="닉네임"
              autoFocus
            />
            <div className={styles.nickMeta}>
              <span className={styles.hint}>
                {NICKNAME_MIN}~{NICKNAME_MAX}자
              </span>
              <span className={styles.counter}>
                {[...trimmed].length} / {NICKNAME_MAX}
              </span>
            </div>
          </div>
        ) : (
          <div className={styles.identity}>
            <strong className={styles.nick}>{me.nickname}</strong>
            {/* 소셜 계정은 이메일이 없다. 자리를 비우지 않고 무엇으로 들어왔는지 적는다. */}
            <span className={styles.sub}>{me.email ?? '소셜 계정으로 로그인'}</span>
          </div>
        )}

        {!editing && (
          <button className={`${styles.btn} ${styles.sm}`} onClick={startEdit} disabled={busy}>
            편집
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {editing ? (
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.grow}`} onClick={cancelEdit} disabled={busy}>
            취소
          </button>
          <button
            className={`${styles.btn} ${styles.primary} ${styles.grow}`}
            onClick={saveNickname}
            disabled={busy || tooShort || unchanged}
          >
            저장
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            className={`${styles.btn} ${styles.grow}`}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {me.profileImageUrl ? '사진 변경' : '사진 등록'}
          </button>
          {me.profileImageUrl && (
            <button className={`${styles.btn} ${styles.grow}`} onClick={removePhoto} disabled={busy}>
              사진 삭제
            </button>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        className={styles.fileInput}
        type="file"
        accept={AVATAR_MIME_TYPES.join(',')}
        onChange={handleFile}
      />
    </section>
  )
}

/* ── 내가 등록한 메뉴 ────────────────────────────────────── */

function MenusCard({
  data,
  loading,
  failed,
  onReload,
}: {
  data: MyMenusResponse | null
  loading: boolean
  failed: boolean
  onReload: () => void
}) {
  const navigate = useNavigate()
  // 한 번에 하나만 펼친다. 여러 개가 열려 있으면 비교가 아니라 스크롤이 된다.
  const [openId, setOpenId] = useState<number | null>(null)

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>내가 등록한 메뉴</h2>
        {data && <span className={styles.count}>{data.menus.length}</span>}
      </div>

      {loading && <p className={styles.placeholder}>불러오는 중...</p>}

      {failed && (
        <div className={styles.retry}>
          <p className={styles.placeholder}>메뉴를 불러오지 못했어요.</p>
          <button className={`${styles.btn} ${styles.sm}`} onClick={onReload}>
            다시 시도
          </button>
        </div>
      )}

      {data && data.menus.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyArt} />
          <p>
            아직 등록한 메뉴가 없어요.
            <br />
            즐겨 가는 메뉴를 추가하면 다른 사람 추천에도 나옵니다.
          </p>
          <button className={`${styles.btn} ${styles.primary}`} onClick={() => navigate('/menus/new')}>
            첫 메뉴 등록하기
          </button>
        </div>
      )}

      {data && data.menus.length > 0 && (
        <>
          <div className={styles.legend}>
            <span>
              <i className={`${styles.dot} ${styles.segChosen}`} />
              채택
            </span>
            <span>
              <i className={`${styles.dot} ${styles.segSkipped}`} />
              넘김
            </span>
            <span className={styles.legendNote}>무응답은 빼고 그립니다</span>
          </div>

          <ul className={styles.menus}>
            {data.menus.map((menu) => (
              <MenuRow
                key={menu.id}
                menu={menu}
                minResponses={data.minResponses}
                avgChosenRate={data.avgChosenRate}
                open={openId === menu.id}
                onToggle={() => setOpenId((id) => (id === menu.id ? null : menu.id))}
                onChanged={onReload}
              />
            ))}
          </ul>

          <button className={`${styles.btn} ${styles.full}`} onClick={() => navigate('/menus/new')}>
            메뉴 등록하기
          </button>
        </>
      )}
    </section>
  )
}

function MenuRow({
  menu,
  minResponses,
  avgChosenRate,
  open,
  onToggle,
  onChanged,
}: {
  menu: MyMenu
  minResponses: number
  avgChosenRate: number | null
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  /** 서버가 CASCADE_NOT_CONFIRMED 와 함께 준 문구. 몇 건이 함께 지워지는지 여기 담겨 온다. */
  const [cascadeNotice, setCascadeNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { stats } = menu
  const answered = answeredCount(stats)
  const rate = adoptionRate(stats)
  const ranked = menu.rank !== null

  function closeConfirm() {
    setConfirming(false)
    setCascadeNotice(null)
    setError(null)
  }

  async function remove(confirmCascade: boolean) {
    setBusy(true)
    setError(null)
    try {
      await deleteMenu(menu.id, confirmCascade)
      closeConfirm()
      // 하나가 빠지면 남은 메뉴의 등수도 달라진다. 목록을 다시 받아온다.
      onChanged()
    } catch (err) {
      const e = errorOf(err)
      if (e.code === 'CASCADE_NOT_CONFIRMED') setCascadeNotice(e.message ?? '추천 기록도 함께 지워집니다.')
      else setError(e.message ?? '메뉴를 지우지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`${styles.menuRow} ${open ? styles.menuRowOpen : ''}`}>
      <button className={styles.menuHead} onClick={onToggle} aria-expanded={open}>
        <img className={styles.thumb} src={menu.imageUrl} alt="" />
        <span className={styles.menuIdentity}>
          <span className={styles.mname}>{menu.name}</span>
          <span className={styles.chips}>
            {menu.categories.map((c) => (
              <span className={styles.chip} key={c.id}>
                {c.name}
              </span>
            ))}
            <span className={styles.chip}>{budgetLabel(menu.budgetTier)}</span>
          </span>
        </span>
        {ranked ? (
          <span className={styles.rank}>
            {menu.rank!.position}위 / {menu.rank!.total}
          </span>
        ) : (
          <span className={`${styles.rank} ${styles.rankNone}`}>집계 중</span>
        )}
      </button>

      {answered > 0 ? (
        <div
          className={styles.bar}
          title={`채택 ${stats.chosen} · 넘김 ${stats.skipped}`}
        >
          <span className={styles.segChosen} style={{ flexGrow: stats.chosen }} />
          <span className={styles.segSkipped} style={{ flexGrow: stats.skipped }} />
        </div>
      ) : (
        <div className={styles.bar} />
      )}

      <div className={styles.rateLine}>
        {/*
          집계 기준에 못 미치면 비율을 아예 숨긴다. 응답 2건에 1건 채택이면 50% 인데,
          그 숫자를 보여주면 9건 중 4건(44%)보다 나은 메뉴처럼 읽힌다.
        */}
        <span className={`${styles.rate} ${ranked ? '' : styles.rateNone}`}>
          {ranked ? pctText(rate) : '–'}
        </span>
        <span className={styles.nums}>
          {answered === 0
            ? `추천 ${stats.recommended} · 아직 응답이 없어요`
            : ranked
              ? `응답 ${answered}건 중 채택 ${stats.chosen}${
                  avgChosenRate === null ? '' : ` · 평균 ${pctText(avgChosenRate)}`
                }`
              : `응답 ${answered}건 · ${minResponses}건부터 순위가 나와요`}
        </span>
      </div>

      {open && (
        <div className={styles.detail}>
          <dl className={styles.detailList}>
            <div className={styles.detailRow}>
              <dt>
                <i className={`${styles.dot} ${styles.segChosen}`} />
                채택
              </dt>
              <dd className={styles.good}>{stats.chosen}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>
                <i className={`${styles.dot} ${styles.segSkipped}`} />
                넘김
              </dt>
              <dd className={styles.warn}>{stats.skipped}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>
                <i className={`${styles.dot} ${styles.segNone}`} />
                무응답
              </dt>
              <dd>{stats.noResponse}</dd>
            </div>
            <div className={`${styles.detailRow} ${styles.detailTotal}`}>
              <dt>추천</dt>
              <dd>{stats.recommended}</dd>
            </div>
          </dl>

          <p className={styles.hint}>
            {menu.rank
              ? `집계된 ${menu.rank.total}개 중 ${menu.rank.position}위`
              : `응답 ${minResponses}건을 넘기면 순위가 나와요`}
            {menu.lastRecommendedAt && ` · 최근 추천 ${formatDay(menu.lastRecommendedAt)}`}
          </p>

          {error && <p className={styles.error}>{error}</p>}

          {cascadeNotice ? (
            <div className={styles.confirm}>
              <p>{cascadeNotice}</p>
              <div className={styles.actions}>
                <button className={`${styles.btn} ${styles.grow}`} onClick={closeConfirm} disabled={busy}>
                  취소
                </button>
                <button
                  className={`${styles.btn} ${styles.dangerSolid} ${styles.grow}`}
                  onClick={() => remove(true)}
                  disabled={busy}
                >
                  그래도 삭제
                </button>
              </div>
            </div>
          ) : confirming ? (
            <div className={styles.confirm}>
              <p>
                <strong>{menu.name}</strong>을(를) 지울까요? 되돌릴 수 없어요.
              </p>
              <div className={styles.actions}>
                <button className={`${styles.btn} ${styles.grow}`} onClick={closeConfirm} disabled={busy}>
                  취소
                </button>
                <button
                  className={`${styles.btn} ${styles.dangerSolid} ${styles.grow}`}
                  onClick={() => remove(false)}
                  disabled={busy}
                >
                  삭제
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button
                className={`${styles.btn} ${styles.grow}`}
                onClick={() => navigate(`/menus/${menu.id}/edit`)}
              >
                수정
              </button>
              <button className={`${styles.btn} ${styles.danger}`} onClick={() => setConfirming(true)}>
                삭제
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/* ── 계정 ───────────────────────────────────────────────── */

function AccountCard({
  nickname,
  menuCount,
  onLogout,
  onLeave,
}: {
  nickname: string
  menuCount: number
  onLogout: () => void
  onLeave: () => void
}) {
  const [leaving, setLeaving] = useState(false)

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>계정</h2>
      <button className={`${styles.btn} ${styles.full}`} onClick={onLogout}>
        로그아웃
      </button>

      <div className={styles.dangerZone}>
        <div className={styles.dangerText}>
          <strong>회원 탈퇴</strong>
          <span className={styles.hint}>계정과 프로필 사진이 지워집니다</span>
        </div>
        <button className={`${styles.btn} ${styles.sm} ${styles.danger}`} onClick={() => setLeaving(true)}>
          탈퇴
        </button>
      </div>

      {leaving && (
        <LeaveDialog
          nickname={nickname}
          menuCount={menuCount}
          onClose={() => setLeaving(false)}
          onDone={onLeave}
        />
      )}
    </section>
  )
}

/**
 * 탈퇴 확인.
 *
 * 닉네임을 다시 입력하게 하는 건 오타 클릭을 막기 위해서다 — 소셜 계정은 비밀번호가 없어
 * 비밀번호 재확인을 쓸 수 없고, 체크박스 하나는 너무 쉽게 통과된다.
 */
function LeaveDialog({
  nickname,
  menuCount,
  onClose,
  onDone,
}: {
  nickname: string
  menuCount: number
  onClose: () => void
  onDone: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * 탈퇴가 끝난 뒤의 인사. 화면을 따로 만들지 않고 이 모달을 그대로 바꿔 쓴다 —
   * 한 줄 안내 때문에 라우트를 늘릴 이유가 없다.
   */
  const [done, setDone] = useState(false)
  const matched = typed.trim() === nickname

  useEffect(() => {
    // 탈퇴가 끝난 뒤에는 Esc 로 닫아도 돌아갈 계정이 없다.
    if (done) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, done])

  async function leave() {
    if (!matched || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
      setDone(true)
    } catch (err) {
      setError(errorOf(err).message ?? '탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.')
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className={styles.scrim}>
        <div className={styles.modal} role="dialog" aria-modal="true">
          <h3>탈퇴가 완료됐어요</h3>
          <p className={styles.leaveBye}>
            그동안 점메추를 써주셔서 고맙습니다.
            <br />
            언제든 다시 가입할 수 있어요.
          </p>
          <button className={`${styles.btn} ${styles.primary} ${styles.full}`} onClick={onDone}>
            홈으로
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>정말 탈퇴하시겠어요?</h3>
        <ul>
          <li>계정과 프로필 사진이 지워지고 되돌릴 수 없어요.</li>
          {menuCount > 0 && (
            <li>
              등록한 메뉴 <strong>{menuCount}개</strong>는 남지만 등록자 표시는 사라져요.
            </li>
          )}
          {/*
            추천 기록은 탈퇴와 함께 사라진다 (recommendations.user_id 가 ON DELETE CASCADE).
            메뉴는 남는데 그 메뉴가 받았던 내 추천 기록이 빠지므로 성적이 소급해서 줄어든다.
            "성적을 못 본다"가 아니라 "숫자가 줄어든다"가 실제로 일어나는 일이다.
          */}
          <li>내가 받았던 추천 기록이 지워지면서 메뉴 성적도 그만큼 줄어들어요.</li>
        </ul>

        <label className={styles.leaveField}>
          <span className={styles.hint}>
            확인을 위해 닉네임 <strong>{nickname}</strong>을(를) 입력해 주세요
          </span>
          <input
            className={styles.input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="닉네임 입력"
            aria-label="닉네임 확인"
            autoFocus
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.grow}`} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className={`${styles.btn} ${styles.dangerSolid} ${styles.grow}`}
            onClick={leave}
            disabled={!matched || busy}
          >
            탈퇴하기
          </button>
        </div>
      </div>
    </div>
  )
}
