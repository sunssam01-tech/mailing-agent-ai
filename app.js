// 메일링 에이전트 AI용 상태와 로직을 관리해요.
// 대화 UI는 그대로 두되, 내부에서는 3가지 도구(askUser, composeEmail, sendEmail)
// 와 TAO(Thought-Action-Observation) 로그를 별도로 기록합니다.

// 채팅 말풍선용 대화 기록
// 각 원소는 { role: "user" | "assistant", content: string }
const conversation = [];

// 비상 정지 플래그 (true가 되면 도구 실행을 멈춰요)
let emergencyStopped = false;

// 에이전트 상태 (State)
// 도구(tools.js)에서도 이 상태를 참조해요.
const agentState = {
  userRequest: "", // 사용자의 원래 요청
  recipient: "", // 받는 사람
  subject: "", // 메일 제목
  keyPoints: [], // 본문에 들어갈 핵심 내용 배열
  missingInfo: [], // 아직 부족한 정보 목록
  draftEmail: "", // 생성된 메일 초안 전문
  mockSendResult: null, // 마지막 Mock 발송 결과
  phase: "idle", // idle | collectRecipient | collectSubject | collectKeyPoints | readyToCompose | composed
};

// TAO 로그: { id, tool, thought, observation, timestamp }
const taoLog = [];

/**
 * 채팅 영역을 다시 그리는 함수
 */
function renderChat() {
  const chatHistoryEl = document.getElementById("chat-history");
  chatHistoryEl.innerHTML = "";

  conversation.forEach((msg) => {
    const row = document.createElement("div");
    row.classList.add("chat-message-row");
    row.classList.add(msg.role === "user" ? "user" : "assistant");

    const avatar = document.createElement("div");
    avatar.classList.add("avatar");
    avatar.textContent = msg.role === "user" ? "👤" : "AI";

    const bubble = document.createElement("div");
    bubble.classList.add("chat-message");
    bubble.classList.add(msg.role === "user" ? "user-bubble" : "bot-bubble");
    bubble.textContent = msg.content;

    if (msg.role === "user") {
      row.appendChild(bubble);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(bubble);
    }

    chatHistoryEl.appendChild(row);
  });

  // 항상 가장 아래가 보이도록 스크롤
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

/**
 * TAO 로그를 화면에 그리는 함수
 */
function renderTAO() {
  const taoEl = document.getElementById("tao-log");
  if (!taoEl) return;

  taoEl.innerHTML = "";

  taoLog.forEach((entry) => {
    const wrap = document.createElement("div");
    wrap.className = "tao-entry";

    const header = document.createElement("div");
    header.className = "tao-entry-header";

    const toolSpan = document.createElement("span");
    toolSpan.className = "tao-entry-tool";
    toolSpan.textContent = `TOOL: ${entry.tool}`;

    const timeSpan = document.createElement("span");
    timeSpan.className = "tao-entry-label";
    timeSpan.textContent = entry.timestamp;

    header.appendChild(toolSpan);
    header.appendChild(timeSpan);

    const body = document.createElement("div");
    body.className = "tao-entry-body";

    const thoughtP = document.createElement("div");
    thoughtP.className = "tao-thought";
    thoughtP.textContent = `Thought: ${entry.thought}`;

    const obsP = document.createElement("div");
    obsP.className = "tao-observation";
    obsP.textContent = `Observation: ${entry.observation}`;

    body.appendChild(thoughtP);
    body.appendChild(obsP);

    wrap.appendChild(header);
    wrap.appendChild(body);

    taoEl.appendChild(wrap);
  });
}

/**
 * TAO 로그 한 항목을 추가하는 헬퍼
 */
function logTAO({ tool, thought, observation }) {
  const entry = {
    id: taoLog.length + 1,
    tool,
    thought,
    observation,
    timestamp: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
  };
  taoLog.push(entry);
  renderTAO();
}

/**
 * 상태 텍스트를 갱신하는 함수
 */
function setStatus(message, isError = false) {
  const statusEl = document.getElementById("status-text");
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

/**
 * OpenAI 호환 API를 호출하는 공통 함수
 * messages: OpenAI chat 형식 배열
 * tools.js의 runComposeEmail 도구에서도 이 함수를 사용해요.
 */
async function callOpenAI(messages) {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  // LLM 응답이 비어 있으면 결과를 지어내지 않고 실패로 처리해요.
  if (!content || !String(content).trim()) {
    throw new Error("LLM 응답이 비어 있어서 신뢰할 수 없어요.");
  }

  return String(content).trim();
}

/**
 * 사용자의 입력 한 번에 대해 에이전트가 어떤 도구를 쓸지 결정하는 함수
 */
async function runAgentStep(userText) {
  // 아직 아무 것도 없는 초기 상태: 사용자의 전체 요청으로 간주
  if (agentState.phase === "idle") {
    agentState.userRequest = userText;
    agentState.missingInfo = ["recipient", "subject", "keyPoints"];
    agentState.phase = "collectRecipient";
    runAskUser("recipient");
    return;
  }

  if (agentState.phase === "collectRecipient") {
    agentState.recipient = userText;
    agentState.missingInfo = ["subject", "keyPoints"];
    agentState.phase = "collectSubject";
    runAskUser("subject");
    return;
  }

  if (agentState.phase === "collectSubject") {
    agentState.subject = userText;
    agentState.missingInfo = ["keyPoints"];
    agentState.phase = "collectKeyPoints";
    runAskUser("keyPoints");
    return;
  }

  if (agentState.phase === "collectKeyPoints") {
    // 줄바꿈/쉼표/•/‑ 등으로 나눠 핵심 내용 배열 구성
    agentState.keyPoints = userText
      .split(/\n|,|·|•|\-|\u2022/)
      .map((s) => s.trim())
      .filter(Boolean);

    agentState.missingInfo = [];
    agentState.phase = "readyToCompose";
    await runComposeEmail();
    return;
  }

  // 이미 초안이 만들어진 뒤에는, 추가 메시지를 "수정 요청"으로 보고 다시 composeEmail 실행
  if (agentState.phase === "readyToCompose" || agentState.phase === "composed") {
    agentState.userRequest += `\n추가 요청: ${userText}`;
    await runComposeEmail();
  }
}

/**
 * 폼 제출(메시지 전송) 핸들러
 */
async function handleSubmit(event) {
  event.preventDefault();
  const inputEl = document.getElementById("user-input");
  const text = inputEl.value.trim();
  if (!text) return;

  // 비상 정지 상태에서는 새로운 요청을 처리하지 않고 안내만 보여줘요.
  if (typeof emergencyStopped !== "undefined" && emergencyStopped) {
    // 사용자가 입력한 내용은 대화 기록에 남기되, 에이전트 추론은 하지 않음
    conversation.push({ role: "user", content: text });
    renderChat();
    inputEl.value = "";

    const message =
      "지금은 비상 정지 상태라 새로운 요청을 처리하지 않아요. 상단의 '새 대화' 버튼을 눌러 다시 시작해 주세요.";

    conversation.push({ role: "assistant", content: message });
    renderChat();
    setStatus(message, true);

    logTAO({
      tool: TOOLS.SAFETY_GUARD,
      thought:
        "비상 정지 플래그가 켜져 있어서 사용자 입력에 대해 추가 추론이나 도구 실행을 하지 않았다.",
      observation: "사용자 입력은 기록만 하고 에이전트 동작을 중단했다.",
    });

    return;
  }

   // 1차 안전 검사: 사용자가 보낸 원문에 위험 요소가 있는지 확인
  const safety = checkSafety(text);
  if (safety.hasSevere) {
    const warning = [
      "⚠️ 안전 경고: 지금 입력하신 내용에는 바로 메일로 보내기 어려운 부분이 있어요.",
      "- " + safety.issues.join("\n- "),
      "",
      "상대방을 상처 주지 않는 표현으로 바꾸거나, 신뢰할 수 있는 어른과 먼저 상의해 보는 게 좋아요.",
    ].join("\n");

    // TAO 로그에도 남기기
    logTAO({
      tool: TOOLS.SAFETY_GUARD,
      thought: "사용자 입력에서 위험 표현을 감지해서 직접적인 메일 작성을 막았다.",
      observation: safety.issues.join("; "),
    });

    conversation.push({ role: "assistant", content: warning });
    renderChat();
    setStatus("위험한 표현을 감지해서 메일 작성을 멈췄어요.", true);
    return; // 이 입력은 runAgentStep으로 넘기지 않음
  }

  // 입력 잠깐 비활성화
  inputEl.disabled = true;
  document.getElementById("send-btn").disabled = true;
  setStatus("에이전트가 다음 행동을 고민하고 있어요…");

  // 화면에 유저 메시지 먼저 추가
  conversation.push({ role: "user", content: text });
  renderChat();
  inputEl.value = "";

  try {
    // 이번 입력 이전의 phase를 기록해 두기 (턴 요약용)
    const beforePhase = agentState.phase;

    await runAgentStep(text);

    // 턴 요약 TAO: 이번 입력 한 번으로 에이전트 상태와 단계가 어떻게 정리되었는지 남겨요.
    let observation = "";
    switch (agentState.phase) {
      case "collectRecipient":
        observation =
          "사용자의 전체 상황 설명을 저장했고, 다음 턴에 친구 메일 주소를 물어보기로 했어요.";
        break;
      case "collectSubject":
        observation =
          "친구 메일 주소를 저장했고, 다음 턴에 메일 제목을 물어보기로 했어요.";
        break;
      case "collectKeyPoints":
        observation =
          "메일 제목을 저장했고, 다음 턴에 본문에 들어갈 핵심 내용을 물어보기로 했어요.";
        break;
      case "readyToCompose":
        observation =
          "본문에 들어갈 핵심 내용을 정리해서 LLM에게 메일 초안을 부탁할 준비가 되었어요.";
        break;
      case "composed":
        observation =
          "LLM이 메일 초안을 생성했거나, 기존 초안에 대한 수정 요청을 반영한 새 초안을 만들었어요.";
        break;
      default:
        observation =
          "에이전트 상태가 업데이트되었지만, 특별한 단계 전환은 없었어요.";
    }

    logTAO({
      tool: TOOLS.TURN_SUMMARY,
      thought:
        `사용자의 이번 입력 한 번을 하나의 턴으로 보고, 에이전트 상태와 다음 단계(phase)를 정리했어요. (이전: ${beforePhase}, 현재: ${agentState.phase})`,
      observation,
    });
  } catch (err) {
    console.error(err);
    setStatus("에이전트 동작 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", true);
  } finally {
    inputEl.disabled = false;
    document.getElementById("send-btn").disabled = false;
    inputEl.focus();
  }
}

/**
 * 새 대화 시작
 */
function resetChat() {
  conversation.length = 0;
  taoLog.length = 0;
  agentState.userRequest = "";
  agentState.recipient = "";
  agentState.subject = "";
  agentState.keyPoints = [];
  agentState.missingInfo = [];
  agentState.draftEmail = "";
  agentState.mockSendResult = null;
  agentState.phase = "idle";

   // 비상 정지/도구 호출 상태도 함께 초기화
  emergencyStopped = false;
  if (typeof resetToolState === "function") {
    resetToolState();
  }

  const stopBtn = document.getElementById("stop-btn");
  if (stopBtn) {
    stopBtn.disabled = false;
    stopBtn.textContent = "비상 정지";
  }

  const sendResultEl = document.getElementById("send-result");
  if (sendResultEl) sendResultEl.innerHTML = "";

  renderChat();
  renderTAO();
  setStatus("새 대화를 시작했어요.");

  // 안내 메시지 다시 추가
  conversation.push({
    role: "assistant",
    content:
      "메일로 보내고 싶은 상황을 한 번에 설명해 주세요. 예: '담임 선생님께 수행평가 관련해서 상담 메일 보내고 싶어.'",
  });
  renderChat();
}

/**
 * Enter = 전송, Shift+Enter = 줄바꿈
 */
function setupKeyboardShortcuts() {
  const inputEl = document.getElementById("user-input");
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("send-btn").click();
    }
  });
}

// 초기 설정
window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("chat-form");
  const resetBtn = document.getElementById("reset-btn");
  const sendEmailBtn = document.getElementById("send-email-btn");
  const stopBtn = document.getElementById("stop-btn");
  const googleLoginBtn = document.getElementById("google-login-btn");

  form.addEventListener("submit", handleSubmit);
  resetBtn.addEventListener("click", resetChat);
  if (sendEmailBtn) {
    sendEmailBtn.addEventListener("click", handleSendEmailClick);
  }

  // 구글 로그인 버튼: Gmail OAuth를 통해 토큰을 받아와요.
  if (googleLoginBtn && typeof loginWithGoogle === "function") {
    googleLoginBtn.addEventListener("click", loginWithGoogle);
  }

  // 비상 정지 버튼: 이후 에이전트 동작을 멈추는 플래그를 켜요.
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (emergencyStopped) return; // 이미 정지 상태면 다시 처리하지 않음

      emergencyStopped = true;
      stopBtn.disabled = true;
      stopBtn.textContent = "비상 정지됨";

      const message =
        "비상 정지를 눌러서 에이전트 동작을 멈췄어요. 상단의 '새 대화' 버튼을 눌러 다시 시작할 수 있어요.";

      conversation.push({ role: "assistant", content: message });
      renderChat();
      setStatus(message, true);

      logTAO({
        tool: TOOLS.SAFETY_GUARD,
        thought:
          "사용자가 비상 정지 버튼을 눌러 이후 도구 실행과 추론을 중단하기로 했다.",
        observation:
          "에이전트는 새 대화로 초기화되기 전까지 메일 도구와 에이전트 단계를 더 진행하지 않는다.",
      });
    });
  }

  setupKeyboardShortcuts();

  // 첫 안내 메시지
  conversation.push({
    role: "assistant",
    content:
      "안녕하세요! 메일링 에이전트 AI예요. 메일로 보내고 싶은 상황을 편하게 설명해 주시면, 필요한 정보를 차례대로 물어보고 메일 초안을 같이 만들어 줄게요.",
  });
  renderChat();
  renderTAO();
});
