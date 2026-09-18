/**
 * 업로드 직전에 사진을 화면에서 쓰는 크기로 줄인다.
 *
 * 폰 카메라 사진은 4000×3000 / 4MB 가 예사인데, 메뉴 사진이 실제로 그려지는 폭은
 * 커야 640px 남짓이다. 원본을 그대로 올리면 픽셀의 대부분은 버려지면서 목록을 여는
 * 모든 사람이 그 용량을 내려받는다.
 *
 * 줄이지 못하는 상황(디코딩 실패, 캔버스가 막힌 브라우저)에서는 원본을 그대로 돌려준다.
 * 업로드를 막는 것보다 큰 파일이라도 올라가는 편이 낫고, 크기 상한은 어차피 서버가 본다.
 */

/** 긴 변 기준 상한. 2배 밀도 화면에서 640px 로 그려도 선명한 값이다. */
const MAX_EDGE = 1280
/** JPEG 품질. 0.8 아래로 내리면 사진에서 눈에 띄게 뭉개진다. */
const QUALITY = 0.82
/** 이 크기 이하이면서 상한도 안 넘으면 다시 굽지 않는다 — 되레 커지기 쉽다. */
const KEEP_AS_IS_BYTES = 300 * 1024

export async function shrinkImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    return await shrink(file)
  } catch {
    return file
  }
}

async function shrink(file: File): Promise<File> {
  const image = await loadImage(file)
  try {
    const { naturalWidth: width, naturalHeight: height } = image
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) return file

    const canvas = downscale(image, Math.round(width * scale), Math.round(height * scale))
    const blob = await toJpeg(canvas)
    // 이미 잘 압축된 작은 사진은 다시 구우면 커질 수 있다. 그럴 땐 원본이 낫다.
    if (!blob || blob.size >= file.size) return file

    return new File([blob], withJpgExt(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } finally {
    URL.revokeObjectURL(image.src)
  }
}

/**
 * createImageBitmap 이 아니라 <img> 로 읽는 이유: 세로로 찍은 폰 사진은 픽셀이
 * 가로로 저장되고 EXIF 방향값으로 세운다. <img> 는 그 방향을 적용해서 캔버스에도
 * 바로 선 채로 그려지지만, createImageBitmap 은 기본값이 '방향 무시' 라 사진이 눕는다.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => resolve(image)
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('이미지를 읽지 못했습니다.'))
    }
    image.src = url
  })
}

/**
 * 한 번에 1/3 이하로 줄이면 브라우저 보간이 픽셀을 건너뛰어 지저분해진다.
 * 절반씩 여러 번 줄인 뒤 마지막에 목표 크기로 맞춘다.
 */
function downscale(image: HTMLImageElement, targetWidth: number, targetHeight: number) {
  let source: CanvasImageSource = image
  let width = image.naturalWidth
  let height = image.naturalHeight

  while (width > targetWidth * 2) {
    width = Math.max(targetWidth, Math.round(width / 2))
    height = Math.max(targetHeight, Math.round(height / 2))
    source = paint(source, width, height)
  }

  return paint(source, targetWidth, targetHeight)
}

function paint(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 쓸 수 없습니다.')

  ctx.imageSmoothingQuality = 'high'
  // JPEG 에는 투명이 없다. 배경을 깔지 않으면 투명한 PNG 가 검게 나온다.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)

  return canvas
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
}

function withJpgExt(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return `${base || 'image'}.jpg`
}
