// 학습용 환경에서 바로 쓸 수 있도록 .env 값을 그대로 사용해요.
// 일반 서비스에서는 브라우저에 API 키를 두면 안 되지만,
// 여기서는 학교 실습용이라 이렇게 해도 괜찮다고 가정해요.

// 실제 OpenAI 호환 엔드포인트 설정
const OPENAI_API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzk0NDM1OTksIm5hZmUi6MTc3OTQ0MzU0SwiZWhwIjoxNzk4Nzk3MTk5LCJrZXlfaWQiOiIxZTcwOTFmYS0xMmZlLTQ1ZDktYmE0MS00ZTkxMTQ0ZmY3YmEifQ.1VdAWRDLQ21Gqf1ibqI73Wi8K0ZoN76L9ePMM__Oq0Y";
const OPENAI_BASE_URL =
  "https://mlapi.run/6ba9f739-79e5-4a3f-9b02-fb8ca7c15a76/v1";
const OPENAI_MODEL = "openai/gpt-5.1";

// Gmail API OAuth 설정 (학습용: 브라우저에서 바로 사용)
// - GMAIL_CLIENT_ID: 학생이 제공한 OAuth 클라이언트 ID
// - GMAIL_API_SCOPE: gmail.send 권한만 요청

const GMAIL_CLIENT_ID =
  "572727663978-1e1fa1r6asdkevb40pl8tvhg113nsihr.apps.googleusercontent.com";
const GMAIL_API_SCOPE = "https://www.googleapis.com/auth/gmail.send";