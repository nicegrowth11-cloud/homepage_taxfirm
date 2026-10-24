# 보안 검토 기록 — 2026-10-24

대상: 현재 저장소의 공개 배포 HTML/CSS/JS와 Vercel 설정.

- PHP 런타임·PHP 파일·DB·SQL 실행·서버 API 없음. PHP-CGI 관련 취약점 패치 대상 런타임을 사용하지 않음.
- SQL을 구성하거나 실행하는 경로 없음. 확인한 소스에서 SQL injection 진입점 미발견.
- 외부 입력의 innerHTML 삽입, eval, document.write 없음. 동적 텍스트는 textContent로 표시.
- 상담 메모는 메모리에만 유지하고 닫을 때 초기화. 개인정보 온라인 접수 및 저장 없음. 기존 법인설립 데모의 localStorage 저장 동작 제거. 이전 브라우저에 이미 저장된 값은 브라우저 사이트 데이터 설정에서 삭제 가능.
- CSP(default-src none, script/style/font/img self, connect/form/frame none), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS 추가.
- 자체 호스팅 폰트와 이미지 사용. 외부 분석/추적/위젯 스크립트 없음.

한계: 코드와 설정의 제한된 검토이며, 침투 테스트·GitHub/Vercel 계정·운영기기·공급망 전체에 대한 무결성 보증은 아님. 이후 서버 접수/DB/YouTube embed를 추가할 때 입력 검증, 매개변수화 SQL, 접근 제어, 보관/삭제 정책, CSP를 재검토할 것.

참고: https://www.php.net/ChangeLog-8.php , https://owasp.org/www-community/attacks/SQL_Injection , https://vercel.com/docs/cdn-security/security-headers
