import { useEffect, useState } from 'react'
import styles from './Avatar.module.css'

interface Props {
  nickname: string
  imageUrl: string | null
  size?: number
  className?: string
}

/** 이니셜 배경색. 닉네임이 같으면 항상 같은 색이 나오도록 해시로 고른다. */
const PALETTE = ['#ff6b35', '#3d9970', '#4a7bd6', '#b05fd0', '#d4a017', '#e05262']

function colorFor(nickname: string): string {
  let hash = 0
  for (const ch of nickname) hash = (hash * 31 + ch.codePointAt(0)!) % 100000
  return PALETTE[hash % PALETTE.length]
}

/**
 * 프로필 사진. 없거나 깨지면 닉네임 첫 글자로 대체한다.
 *
 * 깨짐 처리를 두는 이유: 사진 URL 은 소셜 공급자의 외부 도메인일 수 있고
 * (구글 lh3 링크는 계정 사진을 바꾸면 죽는다) 그때 빈 네모가 남으면 안 된다.
 */
export default function Avatar({ nickname, imageUrl, size = 32, className }: Props) {
  const [broken, setBroken] = useState(false)

  // 사진을 바꾸면 새 URL 로 다시 시도해야 한다.
  useEffect(() => setBroken(false), [imageUrl])

  const style = { width: size, height: size, fontSize: Math.round(size * 0.44) }
  const classes = [styles.avatar, className].filter(Boolean).join(' ')

  if (!imageUrl || broken) {
    return (
      <span
        className={classes}
        style={{ ...style, background: colorFor(nickname) }}
        aria-label={nickname}
      >
        {[...nickname][0] ?? '?'}
      </span>
    )
  }

  return (
    <img
      className={classes}
      style={style}
      src={imageUrl}
      alt={nickname}
      onError={() => setBroken(true)}
    />
  )
}
