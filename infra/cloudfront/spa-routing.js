// 기본 동작(*)에 붙는 viewer-request 함수. 두 가지 일을 한다.
//
// 1) www -> apex 301
//    소셜 로그인 때문에 필수다. 서버(Edge Function)는 KAKAO_REDIRECT_URI /
//    GOOGLE_REDIRECT_URI 환경변수 **하나**로 토큰을 교환하는데, 클라이언트는
//    window.location.origin 으로 redirect_uri 를 만든다. www 로 로그인하면
//    인가 때와 교환 때의 redirect_uri 가 달라져 INVALID_AUTH_CODE 로 실패한다.
//    그래서 origin 을 apex 하나로 강제한다.
//
// 2) SPA 클라이언트 라우팅: 확장자 없는 경로는 index.html 을 돌려준다.
//    CustomErrorResponses(403/404 -> /index.html)를 쓰지 않는 이유는 그 설정이
//    **배포 전체**에 적용돼 /api/* 의 진짜 404 까지 index.html 로 바꿔버리기 때문이다.
//
// 기본 동작에만 붙으므로 /api/* 와 /share/* 는 영향을 받지 않는다.
// /api/* 를 리다이렉트하지 않는 것은 의도적이다 — POST 를 301 하면 메서드가
// 바뀔 수 있다. www 진입은 여기서 이미 apex 로 넘어가므로 API 요청도 apex 에서 난다.
function handler(event) {
    var request = event.request;

    var host = request.headers.host ? request.headers.host.value : '';
    if (host === 'www.jeommechu.co.kr') {
        // 쿼리스트링을 보존해야 한다. OAuth 콜백의 ?code=... 가 여기로 온다.
        var parts = [];
        for (var name in request.querystring) {
            var q = request.querystring[name];
            if (q.multiValue) {
                for (var i = 0; i < q.multiValue.length; i++) {
                    parts.push(name + '=' + q.multiValue[i].value);
                }
            } else if (q.value === '') {
                parts.push(name);
            } else {
                parts.push(name + '=' + q.value);
            }
        }
        var qs = parts.length > 0 ? '?' + parts.join('&') : '';

        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://jeommechu.co.kr' + request.uri + qs }
            }
        };
    }

    if (request.uri.indexOf('.') === -1) {
        request.uri = '/index.html';
    }
    return request;
}
