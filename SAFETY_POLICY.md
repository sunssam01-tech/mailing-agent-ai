# 메일링 에이전트 AI – SAFETY_POLICY

이 파일은 메일링 에이전트 AI가 **코드에서 실제로 강제하는 안전 규칙**만 정리한 문서예요.
모든 규칙은 If-Then(만약 ~라면 → 그러면 ~한다) 형태로 적고, `app.js`·`tools.js`의 동작과 1:1로 연결돼요.

---

## 1. 허용된 메일 도구 / 친구 메일 수신자만 사용

### 1-1. 메일 도구 허용 목록 (MAIL_TOOLS)

- 허용된 메일 도구 이름 (`tools.js`):
  - `"composeMail"`
  - `"showPreview"`
  - `"sendMail"`

**If** 에이전트가 이 목록에 없는 메일 도구 이름으로 `useMailTool(toolName, ...)`을 실행하려 하면,
**Then**:

1. 실제 도구 동작은 실행하지 않고,
2. 사용자에게 `"허용된 메일 도구가 아니라서 실행할 수 없어요."` 라는 한 줄 안내를 말풍선과 상태 텍스트로 보여주고,
3. TAO 로그에 `tool: safetyGuard`로
   - Thought: "허용 목록에 없는 메일 도구 실행을 막았다."
   - Observation: `요청된 도구: <toolName>`
   를 남긴다.

> 구현 위치: `tools.js` – `MAIL_TOOLS`, `ensureMailToolAllowed`, `useMailTool`

### 1-2. 친구 메일 화이트리스트 (FRIEND_EMAIL_WHITELIST)

- 친구 메일 주소 리스트 (`tools.js`):
  1. `grayegg@gmail.com`
  2. `blackegg@daum.net`
  3. `sunny.icmhs@gmail.com`

**If** `sendMail()` 도구가 실행될 때 `agentState.recipient`에 들어 있는 이메일 주소가 이 목록 안에 **없으면**,
**Then**:

1. Mock 발송을 하지 않고,
2. 사용자에게 `"등록된 친구 메일 주소가 아니라서 발송할 수 없어요."` 라는 한 줄 이유를 말풍선과 상태 텍스트로 보여주며,
3. TAO 로그에 `tool: sendEmail`로
   - Thought: "수신자 이메일이 친구 메일 화이트리스트에 없어서 발송을 막았다."
   - Observation: `입력된 주소: <recipientEmail>`
   를 남긴다.

> 구현 위치: `tools.js` – `FRIEND_EMAIL_WHITELIST`, `isFriendEmail`, `sendMail`

---

## 2. sendMail 실행 전, 반드시 showPreview + 사용자 승인

메일 Mock 발송은 언제나 **미리보기 카드 + 확인 버튼**을 거쳐야만 실행돼요.

**If** 사용자가 상단의 "메일 Mock 발송" 버튼을 눌러 `handleSendEmailClick()` → `sendMail()` 도구가 호출되면,
**Then** `sendMail()`은 다음 순서를 강제해요.

1. **초안 존재 확인**
   - If `agentState.draftEmail`이 비어 있으면,
   - Then `"먼저 메일 초안을 만들어 주세요."` 라는 안내와 함께 TAO에
     - Thought: "초안이 없어서 Mock 발송을 진행할 수 없다."
     - Observation: "사용자가 발송을 시도했지만 초안이 없어 경고만 표시됨."
     을 남기고 종료한다.

2. **발송 직전 안전 검사** (`checkSafety`)
   - If 초안 내용에 욕설/협박/전화번호 등 위험 요소가 있으면,
   - Then Mock 발송을 하지 않고,
     1) 안전 경고 메시지를 말풍선으로 보여주고,
     2) 상태 텍스트에 "위험한 표현이 포함된 메일은 Mock 발송도 하지 않아요."를 표시하고,
     3) TAO에 `tool: safetyGuard`로 "발송 직전에 위험 표현을 발견해서 Mock 발송을 막았다." 기록을 남긴다.

3. **친구 메일 화이트리스트 검사** (1-2와 동일)

4. **미리보기 카드(showPreview)로 승인(ask) 단계 진입**
   - 위 조건들을 모두 통과하면,
   - Then `showPreview(previewPayload, onConfirm)`를 호출해,
     - 미리보기 카드에 받는 사람/제목/본문을 채워 넣고,
     - 사용자의 선택을 기다리는 승인 단계로 들어간다.

5. **미리보기 카드에서의 사용자 선택**
   - If 사용자가 카드에서 **"확인" 버튼**을 누르면,
     - Then 그때에만 Mock 발송(write)을 실행하고,
       - `agentState.mockSendResult`에 결과를 기록하고,
       - 우측 `#send-result` 영역에 "Mock 발송 완료" 로그를 추가하며,
       - TAO에 `tool: sendEmail`로 실제 Mock 발송 완료 기록을 남긴다.

   - If 사용자가 카드에서 **"취소" 버튼**을 누르면,
     - Then Mock 발송을 하지 않고 카드를 닫고,
       - 상태 텍스트에 "발송을 취소했어요."를 표시하며,
       - TAO에
         - Thought: "사용자가 미리보기 카드를 보고 발송을 취소했으므로 실제 Mock 발송을 하지 않는다."
         - Observation: "미리보기 단계에서 '취소'를 눌러 발송이 중단되었다."
         를 남긴다.

> 구현 위치: `tools.js` – `sendMail`, `showPreview`

---

## 3. 동일 메일 도구 5회 호출 제한

### 3-1. 한도와 카운터

- 한도 상수 (`tools.js`):
  - `TOOL_CALL_LIMIT = 5`

- 메일 도구별 호출 횟수 기록 객체:
  - `const mailToolCallCounts = {}`

- 카운터 초기화 헬퍼:
  - `resetToolState()` – 새 대화 시작 시 각 도구 호출 횟수를 0으로 되돌림

### 3-2. 정책 (useMailTool)

**If** 어떤 메일 도구(`"composeMail"`, `"showPreview"`, `"sendMail"`)가 `useMailTool`을 통해 호출될 때마다,
**Then**:

1. `mailToolCallCounts[toolName]`를 1 증가시키고,
2. 만약 그 값이 `TOOL_CALL_LIMIT`를 **초과**하면 (즉, 6번째 호출부터),
   - Then
     1) 실제 도구 동작은 실행하지 않고,
     2) 사용자에게
        - `안전 정책 때문에 같은 메일 도구를 5회 초과해서 사용할 수 없어요. 필요하면 내용을 정리해서 다시 설명해 주세요.`
        라는 안내를 말풍선과 상태 텍스트로 보여주고,
     3) TAO 로그에 `tool: safetyGuard`로
        - Thought: "같은 메일 도구가 너무 많이 호출되어 안전 정책에 따라 추가 실행을 막았다."
        - Observation: `도구: <toolName>, 호출 횟수: <count>`
        를 남긴다.

> 구현 위치: `tools.js` – `TOOL_CALL_LIMIT`, `mailToolCallCounts`, `useMailTool`, `resetToolState`, `resetChat()`에서 resetToolState 호출

---

## 4. 비상 정지 버튼 (Emergency Stop)

비상 정지는 학생이 원할 때 **에이전트의 모든 추가 도구 실행·추론을 멈추는 안전 장치**예요.

### 4-1. 플래그와 버튼

- 전역 플래그 (`app.js`):
  - `let emergencyStopped = false;`

- HTML 버튼 (`index.html`):
  - 헤더의 버튼 영역에 비상 정지 버튼 추가
    - `<button id="stop-btn" class="secondary-btn" type="button">비상 정지</button>`

### 4-2. 비상 정지 버튼을 눌렀을 때

**If** 사용자가 상단의 "비상 정지" 버튼을 클릭하면,
**Then**:

1. `emergencyStopped = true;` 로 플래그를 켜고,
2. 버튼 자체를 비활성화하고 라벨을 `"비상 정지됨"`으로 바꾸며,
3. 사용자에게
   - `"비상 정지를 눌러서 에이전트 동작을 멈췄어요. 상단의 '새 대화' 버튼을 눌러 다시 시작할 수 있어요."`
   라는 안내를 말풍선과 상태 텍스트로 보여주고,
4. TAO 로그에 `tool: safetyGuard`로
   - Thought: "사용자가 비상 정지 버튼을 눌러 이후 도구 실행과 추론을 중단하기로 했다."
   - Observation: "에이전트는 새 대화로 초기화되기 전까지 메일 도구와 에이전트 단계를 더 진행하지 않는다."
   를 남긴다.

### 4-3. 비상 정지 상태에서의 동작 제한

1) **handleSubmit (사용자 입력 처리)**

**If** `emergencyStopped === true`인 상태에서 사용자가 채팅창에 새 메시지를 보내면,
**Then**:

1. 사용자의 입력 문장은 대화 기록(`conversation`)에만 추가하고,
2. `runAgentStep`이나 메일 도구 같은 **추론/도구 실행은 전혀 하지 않으며**,
3. 에이전트가
   - `"지금은 비상 정지 상태라 새로운 요청을 처리하지 않아요. 상단의 '새 대화' 버튼을 눌러 다시 시작해 주세요."`
   라는 안내를 말풍선과 상태 텍스트로 보여주고,
4. TAO 로그에 `tool: safetyGuard`로
   - Thought: "비상 정지 플래그가 켜져 있어서 사용자 입력에 대해 추가 추론이나 도구 실행을 하지 않았다."
   - Observation: "사용자 입력은 기록만 하고 에이전트 동작을 중단했다."
   를 남긴다.

> 구현 위치: `app.js` – `handleSubmit` 함수 상단

2) **메일 도구(useMailTool)**

**If** `emergencyStopped === true`인 상태에서 어떤 메일 도구가 `useMailTool`을 통해 실행되려고 하면,
**Then**:

1. 실제 도구 동작은 실행하지 않고,
2. 사용자에게
   - `"지금은 비상 정지 상태라 메일 관련 도구를 실행하지 않아요. 상단의 '새 대화' 버튼을 눌러 다시 시작해 주세요."`
   라는 안내를 말풍선과 상태 텍스트로 보여주며,
3. TAO 로그에 `tool: safetyGuard`로
   - Thought: "비상 정지 플래그가 켜져 있어서 메일 도구 실행을 막았다."
   - Observation: `차단된 도구: <toolName>`
   를 남긴다.

> 구현 위치: `tools.js` – `useMailTool`

3) **새 대화(resetChat)로 비상 정지 해제 + 도구 상태 초기화**

**If** 사용자가 상단의 "새 대화" 버튼을 눌러 `resetChat()`을 실행하면,
**Then**:

1. `conversation`, `taoLog`, `agentState`를 초기화하고,
2. `emergencyStopped = false;` 로 비상 정지 플래그를 끄고,
3. `resetToolState()`를 호출해 도구 호출 카운터를 모두 0으로 되돌리며,
4. 비상 정지 버튼 UI를
   - 비활성화 해제(`disabled = false`),
   - 라벨을 `"비상 정지"`로 되돌린 후,
5. "새 대화를 시작했어요." 안내와 함께 첫 안내 메시지를 다시 보여준다.

> 구현 위치: `app.js` – `resetChat`, `window.addEventListener("DOMContentLoaded", ...)` 초기 설정

---

## 5. 실패 시 결과를 지어내지 않기 (LLM/도구 오류 처리)

이 정책의 핵심은 **API나 도구가 실패했을 때, 에이전트가 없는 내용을 마음대로 만들어 내지 않는 것**이에요.

### 5-1. LLM 호출(callOpenAI) 응답 검사

- LLM 호출 함수 (`app.js`): `async function callOpenAI(messages)`

**If** OpenAI 호환 API 응답에서 `data.choices[0].message.content`가 없거나, 공백뿐이라서 **신뢰할 수 없는 경우**,
**Then**:

1. 기본 문구(예: "응답을 제대로 받지 못했어요...")를 지어내서 반환하지 않고,
2. `throw new Error("LLM 응답이 비어 있어서 신뢰할 수 없어요.");` 로 실패를 던진다.

즉, LLM이 아무 말을 하지 않으면 에이전트도 초안을 억지로 만들어 내지 않아요.

### 5-2. 메일 초안 생성(runComposeEmail) 실패 처리

- 메일 초안 작성 도구 (`tools.js`): `async function runComposeEmail()`

**If** `callOpenAI(messages)` 호출이 위 이유(API 오류, 빈 응답 등)로 실패해서 `catch (error)` 블록에 들어가면,
**Then**:

1. 기존에 있던 `agentState.draftEmail`과 `agentState.phase`는 **변경하지 않고 그대로 둔 채**,
2. 상태 텍스트에 `"메일 초안을 만드는 중 오류가 발생했어요."`를 표시해서 실패 사실만 알리고,
3. 새로운 초안 텍스트를 사용자에게 보여주지 않는다.

즉, 실패 상황에서는 이전에 가지고 있던 상태(초안/단계)만 유지하고, 새 메일 내용을 꾸며서 보여주지 않아요.

> 구현 위치: `app.js` – `callOpenAI`, `tools.js` – `runComposeEmail`

---

## 6. 요약

이 SAFETY_POLICY.md에 적힌 If-Then 규칙들은 모두 실제 코드에 연결돼 있어요.

- 허용 외 메일 도구 / 친구 목록 밖 수신자 → 실행·발송 차단 + 한 줄 이유 + TAO 로그
- sendMail 전에는 항상 showPreview 카드 → 확인(ask) 버튼을 눌러야 Mock 발송
- 동일 메일 도구 5회 호출 제한 → 6번째부터는 실행 차단 + 안내 + TAO 로그
- 비상 정지 버튼 → 플래그 켜고, 새 대화로 초기화하기 전까지 모든 추론·도구 실행 차단
- LLM/도구 실패 시 → 응답이 없으면 초안을 지어내지 않고, 기존 상태를 유지하며 실패만 보고

이 문서를 기준으로, 학생은 코드(app.js, tools.js, index.html)를 열어 실제 구현이 어떻게 연결돼 있는지 직접 확인할 수 있어요.
