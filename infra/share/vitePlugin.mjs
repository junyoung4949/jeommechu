import { parseMenuId, shareHtml } from './shareHtml.mjs'

/**
 * 개발 서버에서 /share/{id} 를 처리하는 Vite 플러그인.
 *
 * 배포에서는 CloudFront 가 이 경로를 Lambda(infra/share/index.mjs)로 보낸다. 개발에 이 경로가
 * 없으면 SPA 의 index.html 이 떠서 "되는 것처럼" 보이지만 OG 태그는 전혀 다른 내용이 된다.
 * Lambda 와 **같은 shareHtml() 을 쓰므로** 로컬에서 확인한 결과가 곧 배포 결과다.
 *
 * .mjs 인 이유: vite.config.ts 는 @types/node 없이 타입 검사되어 fetch/URL 을 모른다.
 * 이 파일은 어차피 배포 산출물이라 타입 검사 대상에서 빼는 편이 자연스럽다.
 *
 * @param {string} apiTarget Supabase 프로젝트 주소
 */
export function shareDevPlugin(apiTarget) {
  return {
    name: 'jeommechu-share-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const menuId = parseMenuId(pathname)
        if (menuId === null) return next()

        const siteUrl = `http://localhost:${server.config.server.port ?? 5173}`
        const goHome = () => {
          res.writeHead(302, { Location: `${siteUrl}/` })
          res.end()
        }

        try {
          const upstream = await fetch(`${apiTarget}/functions/v1/api/menus/${menuId}`)
          if (!upstream.ok) return goHome()
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(shareHtml(await upstream.json(), siteUrl))
        } catch {
          goHome()
        }
      })
    },
  }
}
