import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error — 배포 산출물용 순수 JS 모듈이라 타입 선언이 없다.
import { shareDevPlugin } from './infra/share/vitePlugin.mjs'

// API 프록시: /api/* → Supabase Edge Function `api`
//
// 클라이언트는 axios baseURL '/api' 로 호출한다 (예: /api/auth/login).
// 명세의 '/v1' 은 붙지 않으므로 '^/api' 를 그대로 '/functions/v1/api' 로 치환한다.
// 서버 라우터가 '/v1' 을 선택적으로 처리하므로 나중에 클라이언트를 '/api/v1' 로
// 바꾸더라도 여기 치환 규칙만 맞춰주면 된다.
//
// 프록시를 두는 이유: 브라우저 입장에서 동일 출처 요청이 되어
// CORS 설정 없이 HttpOnly 쿠키가 그대로 오간다.
// (쿠키에 Secure 속성이 붙지만 브라우저는 localhost 를 신뢰 출처로 취급한다.)
const API_TARGET = 'https://pwfevsslxkituyfktmqe.supabase.co'

export default defineConfig({
  plugins: [react(), shareDevPlugin(API_TARGET)],
  build: {
    rollupOptions: {
      // api-docs.html 은 앱과 별개의 진입점이다. 명시하지 않으면 빌드에서 빠진다.
      input: { main: 'index.html', 'api-docs': 'api-docs.html' },
    },
  },
  server: {
    proxy: {
      // 정규식 키를 쓴다. 문자열 '/api' 는 접두사 매칭이라 '/api-docs.html' 같은
      // 무관한 경로까지 프록시로 빨려 들어간다.
      '^/api/': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/functions/v1/api'),
      },
    },
  },
})
