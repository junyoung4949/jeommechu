/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

interface ImportMetaEnv {
  /** 카카오 로그인용 **REST API 키**. 인가 코드 요청의 client_id 다. */
  readonly VITE_KAKAO_CLIENT_ID: string
  /**
   * 카카오톡 공유용 **JavaScript 키**. 위의 REST API 키와 다른 값이다 —
   * 섞어 쓰면 SDK 가 init 은 통과하고 공유 시점에야 실패한다.
   */
  readonly VITE_KAKAO_JS_KEY: string
  readonly VITE_GOOGLE_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
