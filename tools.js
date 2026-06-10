// 메일링 에이전트 AI의 "도구" 역할을 담당하는 함수들을 모아둔 파일이에요.
// - TOOLS 상수: 도구 이름 정의
// - runAskUser: 부족한 정보를 사용자에게 질문하는 도구
// - runComposeEmail: LLM을 호출해 메일 초안을 작성하는 도구
// - showPreview: 메일 발송 전에 미리보기 카드를 보여주는 도구 (auto)
// - handleSendEmailClick/sendMail: 미리보기 + 확인을 거쳐 Mock 발송하는 도구 (ask)
// - checkSafety: 욕설/협박/개인정보 등 위험 요소를 간단히 검사하는 도구
//
// 이 파일은 app.js에 정의된 전역 상태/함수들을 사용해요.
// (agentState, conversation, taoLog, logTAO, callOpenAI, setStatus, renderChat 등)

// 사용 가능한 도구 이름 모음
const TOOLS = {
  ASK_USER: "askUser",
  COMPOSE_EMAIL: "composeEmail",
  SEND_EMAIL: "sendEmail",
  SAFETY_GUARD: "safetyGuard", // 안전 검사용 가드레일 도구
  TURN_SUMMARY: "turnSummary", // 한 턴 전체를 요약해서 TAO에 남길 때 쓰는 가상 도구
};

// 메일 시스템 도구 허용 목록 (외부 메일과 직접 연결되는 도구 이름)
const MAIL_TOOLS = ["composeMail", "showPreview", "sendMail"];

// 동일 도구 호출 안전 한도 (메일 관련 도구 기준)
const TOOL_CALL_LIMIT = 5;

// 메일 도구별 호출 횟수 기록용 객체
const mailToolCallCounts = {};

// Gmail OAuth로 받아온 액세스 토큰 (실제 Gmail API 호출에 사용)
let gmailAccessToken = null;

// 친구 메일 주소 화이트리스트
const FRIEND_EMAIL_WHITELIST = [
  "yangsy20813@gmail.com",
  "yangsy20813@gmail.com",
  "windows108888@gmail.com",
  "hanjiseo20629@gmail.com", 
  "blue270917@gmail.com",
  "mangoful0531@gmail.com",
  "son0yul6@gmail.com",
  "rlaxodb001@gmail.com",
  "jjjch825@gmail.com",
  "speedgojiho@gmail.com",
];

// =============================
// Gmail OAuth / API 헬퍼 함수들
// =============================

// Google Identity Services가 로드되었는지 확인
function isGoogleScriptLoaded() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

let gmailTokenClient = null;

// Gmail용 토큰 클라이언트 초기화
function initGoogleOAuth() {
  if (!isGoogleScriptLoaded()) {
    setStatus("구글 로그인 스크립트를 아직 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", true);
    return false;
  }

  if (!gmailTokenClient) {
    // Google Identity Services 토큰 클라이언트 생성
    gmailTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GMAIL_CLIENT_ID,
      scope: GMAIL_API_SCOPE,
      // callback은 loginWithGoogle에서 매번 덮어쓸 거라 여기서는 빈 함수로 둬요.
      callback: () => {},
    });
  }

  return true;
}

// 상단 "구글 로그인" 버튼 클릭 시 호출할 함수
function loginWithGoogle() {
  if (!initGoogleOAuth()) {
    return;
  }

  setStatus("구글 로그인 창을 열고 있어요…");

  // 토큰 발급 완료 시 실행되는 콜백을 여기서 설정해요.
  gmailTokenClient.callback = (response) => {
    if (response.error) {
      console.error("Google OAuth error", response);
      setStatus("구글 로그인에 실패했어요. 다시 시도해 주세요.", true);
      conversation.push({
        role: "assistant",
        content: "구글 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.",
      });
      renderChat();
      return;
    }

    // 액세스 토큰 저장
    gmailAccessToken = response.access_token;

    setStatus("Gmail 권한 연결이 완료됐어요. 이제 메일 보내기 버튼을 눌러 실제로 보낼 수 있어요.");
    conversation.push({
      role: "assistant",
      content:
        "구글 계정과 연결이 완료됐어요. 이제 위쪽의 '메일 보내기' 버튼을 누르면 Gmail로 실제 메일을 보낼 수 있어요.",
    });
    renderChat();
  };

  // 동의 화면을 띄워서 gmail.send 권한을 요청해요.
  try {
    gmailTokenClient.requestAccessToken({ prompt: "consent" });
  } catch (err) {
    console.error(err);
    setStatus("구글 로그인 중 오류가 발생했어요.", true);
  }
}

// Gmail REST API를 사용해 실제 메일을 보내는 함수
async function sendGmailMessage({ recipient, subject, body }) {
  // 토큰이 없으면 먼저 구글 로그인을 안내
  if (!gmailAccessToken) {
    const msg =
      "Gmail로 메일을 보내려면 먼저 위쪽의 '구글 로그인' 버튼을 눌러 계정을 연결해 주세요.";
    setStatus(msg, true);
    conversation.push({ role: "assistant", content: msg });
    renderChat();
    return { ok: false, error: "NO_TOKEN" };
  }

  // 간단한 MIME 메일 생성 (텍스트 메일)
  const normalize = (value, fallback) =>
    (value === undefined || value === null || String(value).trim() === "")
      ? fallback
      : String(value);

  const to = normalize(recipient, "(미지정)");
  const subj = normalize(subject, "(제목 없음)");
  const text = normalize(body, "(내용 없음)");

  // 한글 제목을 위한 UTF-8/Base64 인코딩 (RFC 2047 형식)
  function encodeSubject(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = "";
    utf8Bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    const base64 = btoa(binary);
    return `=?UTF-8?B?${base64}?=`;
  }

  // 본문도 UTF-8 → Base64
  function encodeBody(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = "";
    utf8Bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  const encodedSubject = encodeSubject(subj);
  const encodedBody = encodeBody(text);

  const mimeLines = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ];

  const mime = mimeLines.join("\r\n");

  // base64url 인코딩 (Gmail API 요구 형식)
  const base64Url = btoa(mime)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  try {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gmailAccessToken}`,
        },
        body: JSON.stringify({ raw: base64Url }),
      },
    );

    if (!response.ok) {
      // 401/403이면 토큰 문제일 가능성이 커요.
      if (response.status === 401 || response.status === 403) {
        const msg =
          "Gmail 권한이 만료되었거나 취소된 것 같아요. 상단의 '구글 로그인' 버튼을 다시 눌러 주세요.";
        setStatus(msg, true);
        conversation.push({ role: "assistant", content: msg });
        renderChat();
        return { ok: false, error: "AUTH" };
      }

      const errorText = await response.text();
      console.error("Gmail API error", response.status, errorText);
      setStatus("Gmail API 호출 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", true);
      return { ok: false, error: "HTTP_" + response.status };
    }

    const data = await response.json();
    console.log("Gmail send response", data);
    return { ok: true, data };
  } catch (err) {
    console.error("Gmail fetch error", err);
    setStatus("Gmail 서버와 통신하는 중 네트워크 오류가 발생했어요.", true);
    return { ok: false, error: "NETWORK" };
  }
}

// 메일 도구 허용 여부 검사
function ensureMailToolAllowed(toolName) {
  if (!MAIL_TOOLS.includes(toolName)) {
    return {
      ok: false,
      reason: "허용된 메일 도구가 아니라서 실행할 수 없어요.", // 한 줄 이유
    };
  }
  return { ok: true, reason: "" };
}

// 메일 도구 실행 래퍼: 목록 밖 도구는 한 줄 이유만 보여주고 실행하지 않음
function useMailTool(toolName, action) {
  // 비상 정지 상태에서는 메일 관련 도구를 실행하지 않아요.
  if (typeof emergencyStopped !== "undefined" && emergencyStopped) {
    const message =
      "지금은 비상 정지 상태라 메일 관련 도구를 실행하지 않아요. 상단의 '새 대화' 버튼을 눌러 다시 시작해 주세요.";
    conversation.push({ role: "assistant", content: message });
    renderChat();
    setStatus(message, true);

    // TAO 로그에 안전 가드 사용 기록 남기기
    logTAO({
      tool: TOOLS.SAFETY_GUARD,
      thought:
        "비상 정지 플래그가 켜져 있어서 메일 도구 실행을 막았다.",
      observation: `차단된 도구: ${toolName}`,
    });

    return;
  }

  // 허용된 메일 도구인지 확인
  const check = ensureMailToolAllowed(toolName);
  if (!check.ok) {
    const reason = check.reason;
    conversation.push({ role: "assistant", content: reason });
    renderChat();
    setStatus(reason, true);

    // TAO 로그에 허용되지 않은 도구 차단 기록 남기기
    logTAO({
      tool: TOOLS.SAFETY_GUARD,
      thought: "허용 목록에 없는 메일 도구 실행을 막았다.",
      observation: `요청된 도구: ${toolName}`,
    });

    return;
  }

  // 도구별 호출 횟수 증가 및 안전 한도 초과 여부 확인
  if (!mailToolCallCounts[toolName]) {
    mailToolCallCounts[toolName] = 0;
  }
  mailToolCallCounts[toolName] += 1;

  if (mailToolCallCounts[toolName] > TOOL_CALL_LIMIT) {
    const message =
      `안전 정책 때문에 같은 메일 도구를 ${TOOL_CALL_LIMIT}회 초과해서 사용할 수 없어요. ` +
      "필요하면 내용을 정리해서 다시 설명해 주세요.";

    conversation.push({ role: "assistant", content: message });
    renderChat();
    setStatus(message, true);

    logTAO({
      tool: TOOLS.SAFETY_GUARD,
      thought:
        "같은 메일 도구가 너무 많이 호출되어 안전 정책에 따라 추가 실행을 막았다.",
      observation: `도구: ${toolName}, 호출 횟수: ${mailToolCallCounts[toolName]}`,
    });

    return;
  }

  return action();
}

// 친구 메일 주소인지 확인하는 헬퍼
function isFriendEmail(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return FRIEND_EMAIL_WHITELIST.some(
    (addr) => addr.toLowerCase() === normalized,
  );
}

/**
 * checkSafety 도구: 텍스트에서 위험 신호를 간단히 찾아내요.
 * - 욕설/심한 비난
 * - 협박/자해·타해 암시
 * - 전화번호 형태(개인정보 과다 가능성)
 * 결과: { issues: string[], hasSevere: boolean }
 */
function checkSafety(text) {
  const lowered = text.toLowerCase();
  const issues = [];

  // 아주 간단한 욕설/비난 키워드 (학습용 예시)
  const insultKeywords = [
    "죽어",
    "죽여버",
    "개새",
    "병신",
    "씨발",
    "좆",
  ];

  if (insultKeywords.some((w) => lowered.includes(w))) {
    issues.push("욕설/심한 비난 표현이 포함되어 있어요.");
  }

  // 협박/자해·타해 암시 (간단 패턴)
  const threatKeywords = ["죽여", "해칠", "자살", "스스로 목숨"]; // 예시
  if (threatKeywords.some((w) => lowered.includes(w))) {
    issues.push("협박 또는 자해·타해를 암시하는 표현이 포함되어 있어요.");
  }

  // 한국 전화번호 패턴 (010-0000-0000 / 01000000000 형태 등)
  const phoneRegex = /(01[0-9])[ -]?(\d{3,4})[ -]?(\d{4})/g;
  if (phoneRegex.test(text)) {
    issues.push("전화번호처럼 보이는 개인정보가 포함되어 있어요.");
  }

  const hasSevere = issues.length > 0;

  return { issues, hasSevere };
}

/**
 * composeEmail 도구: LLM을 사용해 메일 초안을 작성해요.
 * - agentState에 있는 userRequest/recipient/subject/keyPoints를 바탕으로 프롬프트 구성
 * - callOpenAI를 통해 OpenAI 호환 API를 호출
 * - draftEmail과 phase를 업데이트하고, 대화/TAO 로그를 남김
 */
async function runComposeEmail() {
  setStatus("메일 초안을 작성 중이에요…");

  const systemMessage = {
    role: "system",
    content:
      "너는 한국 중고등학생을 돕는 메일 작성 보조 에이전트야. " +
      "항상 존댓말(요체)로 정중한 메일을 작성해 줘. 인사말과 마무리 인사까지 포함해서 자연스러운 한국어 메일을 만들어 줘. " +
      "욕설, 비방, 괴롭힘, 협박, 자해·타해를 부추기는 내용, 사실이 확인되지 않은 소문을 퍼뜨리는 메일은 절대 작성하지 말고, " +
      "대신 예의를 지키는 표현이나 대화를 통한 해결 방법을 제안해 줘.",
  };

  const userContent = [
    `사용자 원래 요청: ${agentState.userRequest}`,
    `받는 사람(역할): ${agentState.recipient}`,
    `메일 제목: ${agentState.subject}`,
    "본문에 꼭 들어가야 할 핵심 내용:",
    ...agentState.keyPoints.map((p, idx) => `${idx + 1}. ${p}`),
    "",
    "위 정보를 바탕으로 하나의 완성된 메일 초안을 작성해 줘.",
  ].join("\n");

  const messages = [
    systemMessage,
    {
      role: "user",
      content: userContent,
    },
  ];

  try {
    const draft = await callOpenAI(messages);
    agentState.draftEmail = draft;
    agentState.phase = "composed";

    const replyText =
      "아래는 지금까지 정보를 바탕으로 작성한 메일 초안이에요.\n" +
      "마음에 들지 않는 부분이 있으면 수정 요청을 한글로 적어서 보내 주세요.\n\n" +
      draft;

    conversation.push({ role: "assistant", content: replyText });
    renderChat();

    logTAO({
      tool: TOOLS.COMPOSE_EMAIL,
      thought: "수집한 정보를 바탕으로 LLM에게 메일 초안을 작성하도록 요청했다.",
      observation: "메일 초안이 생성되어 사용자에게 보여졌다.",
    });

    setStatus("");
  } catch (error) {
    console.error(error);
    setStatus("메일 초안을 만드는 중 오류가 발생했어요.", true);
  }
}

/**
 * askUser 도구: 부족한 정보를 사용자에게 직접 질문해요.
 * nextField: "recipient" | "subject" | "keyPoints"
 */
function runAskUser(nextField) {
  let question = "";
  let thought = "";

  if (nextField === "recipient") {
    question =
      "이 메일을 보낼 친구의 메일 주소를 써 주세요. (다음 중 하나만 사용할 수 있어요. 등록된 메일로만 보낼수 있어요.)";
    thought =
      "수신자 이메일이 친구 메일 화이트리스트에 있는지 알아야 발송 가능 여부를 판단할 수 있다.";
  } else if (nextField === "subject") {
    question =
      "메일 제목으로 어떤 문장을 쓰고 싶나요? 한 줄로 편하게 적어 주세요.";
    thought = "메일 제목을 먼저 정하면 전체 톤과 내용을 더 잘 맞출 수 있다.";
  } else if (nextField === "keyPoints") {
    question =
      "메일 본문에 꼭 들어갔으면 하는 핵심 내용을 적어 주세요. 여러 줄로 적어도 돼요.";
    thought = "본문에 들어갈 핵심 내용을 알아야 메일 초안을 구체적으로 쓸 수 있다.";
  }

  logTAO({
    tool: TOOLS.ASK_USER,
    thought,
    observation: `질문: ${question}`,
  });

  conversation.push({ role: "assistant", content: question });
  renderChat();
}

// 도구 관련 상태를 초기화하는 헬퍼 (새 대화 시작 시 사용)
function resetToolState() {
  Object.keys(mailToolCallCounts).forEach((key) => {
    mailToolCallCounts[key] = 0;
  });
}

// composeMail 도구: 내부적으로 runComposeEmail을 사용해 메일 초안을 작성
function composeMail() {
  return useMailTool("composeMail", () => runComposeEmail());
}

/**
 * showPreview 도구: 메일 발송 전에 미리보기 카드를 화면에 띄워요.
 * - payload: { recipient, subject, body }
 * - onConfirm: 확인 버튼 클릭 시 실행할 콜백
 * 이 도구 자체는 외부에 쓰기를 하지 않으므로 auto(자유) 등급이에요.
 */
function showPreview(payload = {}, onConfirm) {
  return useMailTool("showPreview", () => {
    // 미리보기 카드 관련 DOM 요소를 찾기
    const cardEl = document.getElementById("preview-card");
    const recipientEl = document.getElementById("preview-recipient");
    const subjectEl = document.getElementById("preview-subject");
    const bodyEl = document.getElementById("preview-body");
    const confirmBtn = document.getElementById("preview-confirm");
    const cancelBtn = document.getElementById("preview-cancel");

    // 필수 요소가 없으면 미리보기 대신 경고만 표시
    if (!cardEl || !recipientEl || !subjectEl || !bodyEl || !confirmBtn || !cancelBtn) {
      setStatus("미리보기 UI를 찾을 수 없어서 발송 전 확인을 보여줄 수 없어요.", true);
      return;
    }

    // payload가 비어 있으면 agentState 값을 기본값으로 사용
    const recipient =
      (payload.recipient ?? agentState.recipient ?? "(미지정)") || "(미지정)";
    const subject =
      (payload.subject ?? agentState.subject ?? "(제목 없음)") || "(제목 없음)";
    const body = (payload.body ?? agentState.draftEmail ?? "") || "(내용 없음)";

    // 미리보기 내용 채우기
    recipientEl.textContent = recipient;
    subjectEl.textContent = subject;
    bodyEl.textContent = body;

    // 카드 표시
    cardEl.classList.remove("hidden");

    // 여러 번 클릭되는 것을 막기 위한 플래그
    let handled = false;

    // 이전에 등록된 클릭 핸들러 초기화
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;

    // 확인 버튼: 카드를 숨기고 onConfirm 콜백 실행
    confirmBtn.onclick = () => {
      if (handled) return;
      handled = true;
      cardEl.classList.add("hidden");

      if (typeof onConfirm === "function") {
        onConfirm({ recipient, subject, body });
      }
    };

    // 취소 버튼: 카드를 숨기고 상태 문구만 업데이트
    cancelBtn.onclick = () => {
      if (handled) return;
      handled = true;
      cardEl.classList.add("hidden");

      logTAO({
        tool: TOOLS.SEND_EMAIL,
        thought:
          "사용자가 미리보기 카드를 보고 발송을 취소했으므로 실제 Mock 발송을 하지 않는다.",
        observation: "미리보기 단계에서 '취소'를 눌러 발송이 중단되었다.",
      });

      setStatus("발송을 취소했어요.");
    };
  });
}

// sendMail 도구: 친구 메일 화이트리스트 + 안전 검사 + 미리보기 카드 확인 후 Mock 발송
function sendMail() {
  return useMailTool("sendMail", () => {
    // 초안이 없으면 발송 불가
    if (!agentState.draftEmail) {
      setStatus("먼저 메일 초안을 만들어 주세요.", true);
      logTAO({
        tool: TOOLS.SEND_EMAIL,
        thought: "초안이 없어서 Mock 발송을 진행할 수 없다.",
        observation:
          "사용자가 발송을 시도했지만 초안이 없어 경고만 표시됨.",
      });
      return;
    }

    // 발송 직전 안전 검사: 초안 내용에 위험 요소가 있는지 다시 확인
    const safety = checkSafety(agentState.draftEmail || "");
    if (safety.hasSevere) {
      const warning = [
        "⚠️ 안전 경고: 지금 작성된 메일 초안에는 그대로 보내기 어려운 표현이 있어요.",
        "- " + safety.issues.join("\n- "),
        "",
        "상대방을 상처 주지 않는 표현으로 바꾸거나, 신뢰할 수 있는 어른과 먼저 상의해 보는 게 좋아요.",
        "수정하고 싶다면, 어떤 부분을 어떻게 바꾸고 싶은지 챗창에 적어 주세요.",
      ].join("\n");

      // TAO 로그에 안전 가드 도구 사용 기록 남기기
      logTAO({
        tool: TOOLS.SAFETY_GUARD,
        thought:
          "발송 직전에 메일 초안 내용을 다시 확인했고, 위험한 표현을 발견해서 Mock 발송을 막았다.",
        observation: safety.issues.join("; "),
      });

      conversation.push({ role: "assistant", content: warning });
      renderChat();
      setStatus(
        "위험한 표현이 포함된 메일은 Mock 발송도 하지 않아요.",
        true,
      );
      return; // 안전 검사를 통과하지 못하면 발송하지 않음
    }

    // 친구 메일 주소 화이트리스트 검사
    const recipientEmail = agentState.recipient;
    if (!isFriendEmail(recipientEmail)) {
      const reason = "등록된 친구 메일 주소가 아니라서 발송할 수 없어요.";
      logTAO({
        tool: TOOLS.SEND_EMAIL,
        thought:
          "수신자 이메일이 친구 메일 화이트리스트에 없어서 발송을 막았다.",
        observation: `입력된 주소: ${recipientEmail || "(비어 있음)"}`,
      });
      conversation.push({ role: "assistant", content: reason });
      renderChat();
      setStatus(reason, true);
      return;
    }

    // 여기까지 통과했다면, 실제 쓰기(write)를 하기 전에 반드시 미리보기 카드를 거친다.
    const previewPayload = {
      recipient: recipientEmail,
      subject: agentState.subject,
      body: agentState.draftEmail,
    };

    // TAO 로그에 "승인(ask) 단계에 들어갔다"는 기록 남기기
    logTAO({
      tool: TOOLS.SEND_EMAIL,
      thought:
        "친구 메일 주소와 안전 검사를 모두 통과했으므로, 발송 전에 미리보기 카드를 띄워 최종 확인을 받는다.",
      observation:
        "받는 사람, 제목, 본문을 미리보기 카드에 채워 넣고 사용자의 확인을 기다리는 중이다.",
    });

    // showPreview는 auto 도구, 실제 쓰기(write)는 onConfirm 콜백 안에서만 실행
    showPreview(previewPayload, async (confirmed) => {
      const result = {
        recipient: confirmed.recipient || "(미지정)",
        subject: confirmed.subject || "(제목 없음)",
        time: new Date().toLocaleString("ko-KR"),
      };

      // 실제 Gmail 발송 시도
      const sendResult = await sendGmailMessage({
        recipient: result.recipient,
        subject: result.subject,
        body: confirmed.body,
      });

      if (!sendResult.ok) {
        // 실패한 경우 TAO 로그에 남기고, 여기서 종료
        logTAO({
          tool: TOOLS.SEND_EMAIL,
          thought:
            "사용자의 확인을 받았지만 Gmail API 호출에 실패해서 메일 발송을 완료하지 못했다.",
          observation: `오류 코드: ${sendResult.error || "UNKNOWN"}`,
        });
        return;
      }

      // 상태에 실제 발송 결과 저장
      agentState.mockSendResult = result;

      // 우측 패널에 발송 기록 추가
      const sendResultEl = document.getElementById("send-result");
      if (sendResultEl) {
        const entry = document.createElement("div");
        entry.className = "send-result-entry";
        entry.textContent = `Gmail 발송 완료 → 받는 사람: ${result.recipient} | 제목: ${result.subject} | 시간: ${result.time}`;
        sendResultEl.appendChild(entry);
      }

      // TAO 로그에 실제 Gmail 발송이 일어났음을 기록
      logTAO({
        tool: TOOLS.SEND_EMAIL,
        thought:
          "사용자의 확인을 받은 뒤 메일 초안을 기반으로 실제 Gmail 발송을 실행했다.",
        observation: `받는 사람: ${result.recipient}, 제목: ${result.subject}, 시간: ${result.time}`,
      });

      setStatus("Gmail로 메일을 보냈어요.");
    });
  });
}

/**
 * sendEmail 도구: 실제 발송은 하지 않고 Mock 결과만 화면에 남겨요.
 * "메일 Mock 발송" 버튼 클릭 시 호출돼요.
 */
function handleSendEmailClick() {
  sendMail();
}
