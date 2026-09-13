// 개발의 Vite 프록시와 같은 일을 한다: /api/* -> /functions/v1/api/*
//
// 이렇게 해야 브라우저 입장에서 동일 출처 요청이 되어 HttpOnly 쿠키가 그대로 오간다.
// 클라이언트가 Supabase 를 직접 부르면 CORS 와 SameSite=None 을 떠안아야 한다.
//
// CloudFront Functions 는 네트워크 호출이 불가능하지만 URI 재작성은 가능하다.
function handler(event) {
    var request = event.request;
    request.uri = request.uri.replace(/^\/api\//, '/functions/v1/api/');
    return request;
}
