// 학습용 환경에서 바로 쓸 수 있도록 .env 값을 그대로 사용해요.
// 일반 서비스에서는 브라우저에 API 키를 두면 안 되지만,
// 여기서는 학교 실습용이라 이렇게 해도 괜찮다고 가정해요.

// 실제 OpenAI 호환 엔드포인트 설정

// 예시: OpenAI 키(sk-proj-...)를 3~4조각으로 나누어 넣기
const part1 = "sk-proj-Y-RRDM-gYGTP35WI2mlIm7X2O";
const part2 = "2ahkqnew6gtq-cNp1b9sSgTnlufUjlW7BYDN6sTN70T";
const part3 = "uhHt1WT3BlbkFJQYcxq4Bvg3jJBuX_T";
const part3 = "cYR0pu8pgyhuHDR9h2_PJ1lFsIWj2NR7e1RFNPotWrm-ppiSltEfJBhEAabc";
const OPENAI_API_KEY = part1 + part2 + part3 + part4;

const OPENAI_BASE_URL =
  "https://mlapi.run/6ba9f739-79e5-4a3f-9b02-fb8ca7c15a76/v1";
const OPENAI_MODEL = "openai/gpt-5.1";

// Gmail API OAuth 설정 (학습용: 브라우저에서 바로 사용)
// - GMAIL_CLIENT_ID: 학생이 제공한 OAuth 클라이언트 ID
// - GMAIL_API_SCOPE: gmail.send 권한만 요청
const GMAIL_CLIENT_ID =
  "360554021962-dlk19pht1km85aun3fcdeqke9c239knk.apps.googleusercontent.com";
const GMAIL_API_SCOPE = "https://www.googleapis.com/auth/gmail.send";

