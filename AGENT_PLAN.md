# 메일링 에이전트 AI – 5요소 정의

## 1. 목표 (Goal)

- 한 줄 목표: **학생이 쓰고 싶은 메일 내용을 정리해서, 정중한 한국어 메일 초안과 Mock 발송까지 도와주는 에이전트**

## 2. 계획 (Plan)

한 세션에서 에이전트가 따르는 기본 단계는 다음과 같아요.

1. **사용자 요청 수집**  
   - 사용자가 보내고 싶은 메일 상황을 자유롭게 설명해요.  
   - 예: “담임 선생님께 수행평가 관련 상담 메일 보내고 싶어.”

2. **부족한 정보 질문 (askUser 도구)**  
   순서대로 필요한 정보를 물어봐요.
   1) 받는 사람(역할) 질문 → `recipient` 채우기  
   2) 메일 제목 질문 → `subject` 채우기  
   3) 본문 핵심 내용 질문 → `keyPoints` 배열 채우기

3. **메일 초안 작성 (composeEmail 도구 + LLM)**  
   - `agentState`에 모인 정보를 바탕으로 OpenAI 호환 API를 호출해 한 편의 메일 초안을 생성해요.
   - 초안을 채팅 말풍선으로 보여주고, TAO 로그에 `TOOL: composeEmail`, Thought/Observation을 남겨요.

4. **사용자 피드백 반영**  
   - 초안이 만들어진 뒤 사용자가 추가로 입력하는 내용은 `userRequest` 뒤에 “추가 요청”으로 붙여요.  
   - 다시 `composeEmail` 도구를 실행해서 수정된 초안을 만들어 줘요.

5. **메일 Mock 발송 (sendEmail 도구)**  
   - 사용자가 "메일 Mock 발송" 버튼을 누르면 `handleSendEmailClick`이 실행돼요.  
   - 실제 메일은 보내지 않고, 수신자/제목/시간 정보를 `send-result` 영역에 기록해요.  
   - TAO 로그에 `TOOL: sendEmail` Thought/Observation을 남겨요.

## 3. 상태 (State)

코드에서 유지하는 주요 상태는 `agentState`와 로그 배열들이에요.

- `conversation: Array<{ role: "user" | "assistant", content: string }>`  
  - 채팅 말풍선에 표시할 전체 대화 기록

- `agentState: { ... }`
  - `userRequest: string`  
    - 사용자의 원래 요청 문장 + 이후 추가 요청들을 누적 저장
  - `recipient: string`  
    - 메일을 누구에게 보내는지 (예: 담임 선생님, 진로 상담 선생님, 미래의 나 등)
  - `subject: string`  
    - 메일 제목 한 줄
  - `keyPoints: string[]`  
    - 메일 본문에 꼭 들어가야 할 핵심 내용 목록  
    - 줄바꿈/쉼표/불릿 문자 등을 기준으로 잘라서 배열로 저장
  - `missingInfo: string[]`  
    - 아직 수집하지 못한 정보 종류 목록 (예: ["recipient", "subject"])  
    - 현재 구현에서는 단계 전환에 참고용으로만 사용
  - `draftEmail: string`  
    - LLM이 만들어 준 메일 초안 전체 텍스트
  - `mockSendResult: { recipient, subject, time } | null`  
    - 마지막 Mock 발송 기록 (받는 사람, 제목, 시간)
  - `phase: "idle" | "collectRecipient" | "collectSubject" | "collectKeyPoints" | "readyToCompose" | "composed"`  
    - 에이전트가 현재 어떤 단계에 있는지 나타내는 상태 값

- `taoLog: Array<{ id, tool, thought, observation, timestamp }>`  
  - Thought-Action-Observation 로그를 담는 배열  
  - `renderTAO()`를 통해 우측 패널에 시각화돼요.

## 4. 도구 (Tools)

코드에서 정의한 도구들은 `TOOLS` 상수와 각각의 함수로 표현돼요.

- `TOOLS` 상수
  - `ASK_USER: "askUser"`
  - `COMPOSE_EMAIL: "composeEmail"`
  - `SEND_EMAIL: "sendEmail"`
  - `SAFETY_GUARD: "safetyGuard"` (위험 표현을 막는 안전 가드 도구)
  - `TURN_SUMMARY: "turnSummary"` (실제 도구 호출이 아니라, **각 사용자 입력 한 번을 하나의 턴으로 보고 요약 TAO를 남길 때만 사용하는 가상 도구 이름**)

- `runAskUser(nextField)`  
  - 역할: 부족한 정보를 사용자에게 질문하는 도구  
  - 입력: `nextField` (`"recipient" | "subject" | "keyPoints"`)  
  - 내부 동작:
    - 어떤 필드를 물어볼지에 따라 다른 질문 문장을 만든 뒤, `conversation`에 assistant 메시지로 추가
    - `logTAO`를 사용해 TAO 로그에 Thought(왜 이 질문을 하는지)와 Observation(실제 질문 문장)을 남김
    - `renderChat()`으로 화면을 다시 그림

- `runComposeEmail()`  
  - 역할: OpenAI 호환 LLM API를 호출해서 메일 초안을 만드는 도구  
  - 입력: 없음 (전역 `agentState`를 사용)  
  - 내부 동작:
    - 시스템 프롬프트(메일 작성 에이전트 역할 설명)와 사용자 메시지(원래 요청, recipient, subject, keyPoints)를 합쳐 `messages` 배열 생성
    - `callOpenAI(messages)`로 `/chat/completions` 엔드포인트 호출
    - 응답으로 받은 메일 초안을 `agentState.draftEmail`에 저장하고, `phase`를 `"composed"`로 변경
    - 초안을 사용자에게 말풍선으로 보여주고, TAO 로그에 `TOOL: composeEmail` Thought/Observation 기록

- `handleSendEmailClick()`  
  - 역할: 메일을 실제로 보내는 대신 Mock으로 발송했다고 기록하는 도구  
  - 입력: 없음 (버튼 클릭 이벤트 핸들러로 사용)  
  - 내부 동작:
    - `agentState.draftEmail`이 없으면 경고 메시지를 보여주고 TAO에 실패 Observation 기록
    - `window.confirm`로 한 번 더 사용자에게 확인
    - 확인 시 `recipient`, `subject`, 현재 시간을 모아 `mockSendResult`에 저장하고, 화면 우측 `send-result` 영역에 로그를 추가
    - TAO 로그에 `TOOL: sendEmail` Thought/Observation 기록 후 상태 문구 업데이트

## 5. 결과 (Done / 종료 조건)

이 에이전트에서 한 세션이 "끝났다"고 볼 수 있는 기준은 다음과 같아요.

1. 사용자가 메일 초안에 만족해서 더 이상 수정 요청을 하지 않을 때  
   - 사용자가 “이 정도면 됐어”, “좋아요”와 같이 추가 입력을 멈추면 사실상 세션 종료로 볼 수 있어요.

2. 사용자가 "메일 Mock 발송" 버튼을 눌러 발송까지 마쳤을 때  
   - `handleSendEmailClick()`이 성공적으로 실행되고, `send-result` 영역에 Mock 발송 로그가 남았을 때를 하나의 종료 지점으로 볼 수 있어요.

3. 사용자가 "새 대화" 버튼을 눌러 상태를 초기화할 때  
   - `resetChat()`이 호출되면 `conversation`, `taoLog`, `agentState`가 모두 초기화되고, 새로운 세션이 시작돼요.

최종 산출물 형태:

- 채팅 영역에 남은 대화 기록
- `agentState.draftEmail`에 저장된 최종 메일 초안
- 우측 패널의 TAO 로그(`taoLog`)와 Mock 발송 기록(`mockSendResult` / `send-result` 영역)

## 6. 안전 패턴 & 가드레일

이 메일링 에이전트에는 기본적인 안전 패턴과 가드레일이 들어있어요. 
구현된 부분은 모두 **If-Then 규칙** 형태로 정리할 수 있어요.

### 6.1 적용된 규칙 (If-Then)

1. **사용자 입력 단계 가드레일**  
   - If 사용자가 입력한 문장에 `checkSafety(text)` 기준으로 아래와 같은 요소가 하나라도 있으면:  
     - 욕설/심한 비난 표현  
     - 협박 또는 자해·타해를 암시하는 표현  
     - 전화번호 형태의 개인정보  
   - Then 에이전트는:
     - 메일 작성 흐름(`runAgentStep`)을 시작하지 않고,  
     - 위험 요소 목록을 포함한 경고 메시지를 assistant 말풍선으로 보여주며,  
     - `TOOL: safetyGuard`로 TAO 로그에 "사용자 입력에서 위험 표현을 감지해 작성을 막았다"고 기록해요.

2. **발송 직전(메일 초안) 가드레일**  
   - If 사용자가 "메일 Mock 발송" 버튼을 눌렀을 때, 현재 `agentState.draftEmail` 내용에 `checkSafety` 기준의 위험 요소가 하나라도 있으면:  
     - 욕설/심한 비난 표현  
     - 협박 또는 자해·타해를 암시하는 표현  
     - 전화번호 형태의 개인정보  
   - Then 에이전트는:
     - Mock 발송을 진행하지 않고,  
     - "지금 작성된 메일 초안에는 그대로 보내기 어려운 표현이 있다"는 경고 메시지를 assistant 말풍선으로 보여주며,  
     - 표현을 바꾸거나 신뢰할 수 있는 어른과 상담하라고 안내하고,  
     - `TOOL: safetyGuard`로 TAO 로그에 "발송 직전에 위험 표현을 발견해 Mock 발송을 막았다"고 기록해요.

3. **LLM 시스템 프롬프트 내 정책**  
   - If LLM이 메일 초안을 작성할 때, 사용자가 준 요청에 공격적인 내용이 포함돼 있더라도,  
   - Then 시스템 프롬프트에 따라:
     - 욕설, 비방, 괴롭힘, 협박, 자해·타해를 부추기는 메일, 확인되지 않은 소문을 퍼뜨리는 메일은 작성하지 말고,  
     - 예의를 지키는 표현이나 대화를 통한 해결 방법을 제안하도록 유도해요.

### 6.2 TAO 로그에서의 안전 도구 기록

- 안전 검사에 사용되는 도구 이름: `TOOLS.SAFETY_GUARD` (`"safetyGuard"`)  
- 사용 위치:
  1) `app.js`의 `handleSubmit`에서 사용자 입력을 검사할 때  
  2) `tools.js`의 `handleSendEmailClick`에서 초안 내용을 검사할 때  
- 각 때마다 `logTAO`를 통해 Thought(왜 막았는지)와 Observation(구체적인 이슈 목록)을 남겨,  
  학생이 **"에이전트가 어떤 기준으로 멈췄는지"**를 우측 TAO 패널에서 직접 확인할 수 있게 했어요.

### 6.3 메일 도구 허용 목록 & 친구 메일 화이트리스트

이 에이전트가 **외부 메일 시스템과 직접 연결되는 도구**는 세 가지만 허용돼요.

- 허용된 메일 도구 이름 목록(`MAIL_TOOLS`):  
  - `"composeMail"`  
  - `"showPreview"`  
  - `"sendMail"`

If 에이전트가 이 목록에 없는 이름의 메일 도구를 실행하려고 하면,  
Then `ensureMailToolAllowed` / `useMailTool` 헬퍼가 
"허용된 메일 도구가 아니라서 실행할 수 없어요." 라는 **한 줄 이유만 보여주고 실제 실행은 하지 않아요.**

또한, 실제(또는 Mock) 발송에 해당하는 `sendMail` 도구는 **쓰기(write) 동작만 허용**되고,  
메일 읽기(read)나 삭제(delete)에 해당하는 도구는 아예 구현하지 않아서 사용할 수 없어요.

#### 친구 메일 주소 화이트리스트

실습을 위해, 메일 수신자는 **친구 메일 주소 3개로만 제한**돼요.

- 친구 메일 주소 리스트 (`FRIEND_EMAIL_WHITELIST`)
  1. `grayegg@gmail.com`
  2. `blackegg@daum.net`
  3. `sunny.icmhs@gmail.com`

If `sendMail`을 호출할 때 `agentState.recipient`에 들어 있는 주소가 위 목록에 **포함돼 있으면**,  
Then 발송(write)을 진행할 수 있고, Mock 발송 기록에 남겨요.

If `sendMail`을 호출할 때 수신자 주소가 친구 메일 목록에 **없으면**,  
Then 발송을 하지 않고,  
"등록된 친구 메일 주소가 아니라서 발송할 수 없어요." 라는 한 줄 이유를 사용자에게 보여주며,  
TAO 로그에는 `TOOL: sendEmail` Thought/Observation으로  
"수신자 이메일이 친구 메일 화이트리스트에 없어서 발송을 막았다"는 내용을 남겨요.

### 6.4 메일 도구 등급 (auto / ask)

이 에이전트에서 사용하는 메일 관련 도구는 **자유(auto)** 와 **승인(ask)** 두 등급으로 나눌 수 있어요.

1. **자유(auto) 도구 – 외부에 직접 쓰기(write)를 하지 않는 도구**

   - `composeMail()`
     - If 메일 초안을 만들기 위해 LLM에게 내용을 부탁할 때,  
       Then `composeMail` 도구를 바로 실행해도 돼요.  
       (실제 메일 시스템에 쓰기를 하지 않고, 초안 텍스트만 `agentState.draftEmail`에 저장해요.)

   - `showPreview(payload, onConfirm)`
     - If 메일을 보내기 전에 "받는 사람 / 제목 / 내용"을 카드 형태로 보여주고 싶을 때,  
       Then `showPreview` 도구를 바로 실행해도 돼요.  
       (이 도구는 화면에 미리보기 카드를 띄워 줄 뿐, 실제 발송 같은 쓰기(write)는 하지 않아요.)

2. **승인(ask) 도구 – 외부에 쓰기(write)가 일어날 수 있는 도구**

   - `sendMail()`
     - If 학생이 "메일 Mock 발송" 버튼을 눌러 발송을 시도하면,  
       Then `sendMail` 도구는 바로 쓰기를 하지 않고, 다음 단계를 차례로 거쳐요.

       1) If 메일 초안이 없으면,  
          Then "먼저 메일 초안을 만들어 주세요."라고 알려주고 발송을 중단해요.

       2) If 초안 내용에 `checkSafety` 기준의 위험 표현이 있으면,  
          Then 안전 경고 메시지를 보여주고 Mock 발송도 진행하지 않아요.

       3) If 수신자 이메일이 친구 메일 화이트리스트에 없으면,  
          Then "등록된 친구 메일 주소가 아니라서 발송할 수 없어요."라고 알려주고 발송을 막아요.

       4) If 위 조건들을 모두 통과했다면,  
          Then 실제 Mock 발송(write)을 하기 **직전 단계**로, `showPreview` 도구를 호출해요.

          - `showPreview`는 미리보기 카드에 다음 내용을 채워 넣어요.  
            - 받는 사람: `agentState.recipient`  
            - 제목: `agentState.subject`  
            - 내용: `agentState.draftEmail`
          - 그리고 카드 안의 버튼으로 **학생의 선택을 다시 한 번 묻는 승인(ask) 단계**를 만들어요.

          - If 학생이 미리보기 카드에서 **"확인" 버튼**을 누르면,  
            Then 그때에만 Mock 발송(write)을 실행하고,  
            `send-result` 패널에 "Mock 발송 완료" 기록을 남겨요.

          - If 학생이 미리보기 카드에서 **"취소" 버튼**을 누르면,  
            Then 발송을 하지 않고 카드를 닫으며,  
            TAO 로그에 "미리보기 단계에서 취소하여 발송이 중단되었다"는 Observation을 남겨요.

3. **새 도구 설계 시의 기본 정책**

   - If 새로 만드는 도구가 **외부에 영향을 주지 않는 도구**(예: 내부 상태만 수정, 화면에만 표시 등)라면,  
     Then 기본적으로 **자유(auto) 도구**로 두고 바로 실행해도 돼요.

   - If 새 도구가 **외부에 쓰기(write)를 하거나, 중요한 행동을 일으키는 도구**(예: 실제 메일 발송, 파일 저장, 다른 시스템에 요청 등)라면,  
     Then 이 에이전트처럼 **승인(ask) 도구**로 설계해서,  
     최소 한 번 이상 학생의 "확인"을 받는 단계를 넣는 것을 원칙으로 해요.

