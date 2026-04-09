# Chrome Extension Side Panel 제어 메커니즘

Chrome MV3 확장프로그램에서 사이드 패널을 열고, content script와 통신하고,
패널이 닫혀있을 때 자동으로 열면서 작업을 이어가는 패턴을 정리한 문서.

---

## 핵심 문제

`chrome.sidePanel.open()`은 **user gesture 컨텍스트**에서만 호출 가능하다.
content script에서 `chrome.runtime.sendMessage()`로 보낸 메시지의 핸들러에서는
user gesture가 전파되지 않아 `sidePanel.open()`이 실패할 수 있다.

해결: **content script에서 `mousedown` 이벤트**(gesture 시작점)에서 메시지를 보내고,
background에서 `sender.tab.id`를 사용하면 gesture가 전파된다.

---

## 아키텍처 (3개 파일)

```
[content.js]          [background.js]           [sidepanel.js]
웹페이지 위            서비스 워커                 사이드 패널 UI
                      (메시지 허브)
   mousedown ──sendMessage──▶ onMessage
                              │
                              ├─ panelPort 있음? → handleAnalyze()
                              │                     │
                              │                     ▼
                              │                   sendToPanel()
                              │                     │
                              │              port.postMessage() ──▶ onMessage
                              │
                              └─ panelPort 없음?
                                  │
                                  ├─ pendingAnalysis = text  (대기열 저장)
                                  ├─ sidePanel.open()        (패널 열기)
                                  │
                                  │  ... 패널이 열리면 ...
                                  │
                                  └─ onConnect 발생
                                      ├─ panelPort 설정
                                      └─ pendingAnalysis 처리
```

---

## 핵심 코드 설명

### 1. content.js — `mousedown`으로 user gesture 전파

```js
// click이 아니라 mousedown을 써야 한다.
// mousedown → mouseup → click 순서에서,
// mousedown 시점에 user gesture가 살아있어
// background의 sidePanel.open()까지 전파된다.
popup.addEventListener('mousedown', (e) => {
  e.preventDefault();    // 텍스트 선택 해제 방지
  e.stopPropagation();   // 다른 mousedown 핸들러 차단
  chrome.runtime.sendMessage({ type: 'analyze', text });
  removePopup();
});
```

**왜 `click`이 아니라 `mousedown`인가?**
- `click` 이벤트는 `mouseup` 이후에 발생한다.
- 이 사이에 다른 `mouseup` 핸들러(텍스트 선택 감지 등)가 끼어들어
  user gesture 컨텍스트가 소실될 수 있다.
- `mousedown`은 gesture 체인의 시작점이라 가장 확실하다.

---

### 2. background.js — 대기열(pending) 패턴

3가지 상태 변수:

```js
let panelPort = null;        // 사이드 패널과의 포트 연결 (null = 패널 닫힘)
let pendingAnalysis = null;  // 패널이 열리길 기다리는 분석 텍스트
let currentController = null; // 진행 중인 API 요청의 AbortController
```

#### 메시지 수신 — 패널 유무에 따른 분기:

```js
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'analyze') {

    if (panelPort) {
      // ✅ 패널이 이미 열려있음 → 바로 분석 시작
      handleAnalyze(message.text);

    } else {
      // ❌ 패널이 닫혀있음 → 대기열에 저장 후 패널 열기
      pendingAnalysis = message.text;

      if (sender.tab?.id) {
        // sender.tab.id를 사용해야 user gesture가 전파됨
        chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {
          // 패널 열기 실패 시 (gesture 소실 등) 그냥 분석 시도
          pendingAnalysis = null;
          handleAnalyze(message.text);
        });
      }
    }
  }
  return false;
});
```

#### 패널 연결 시 — 대기열 처리:

```js
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;

  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });

  // 🔑 핵심: 패널이 열리길 기다리던 분석 요청이 있으면 즉시 실행
  if (pendingAnalysis) {
    const text = pendingAnalysis;
    pendingAnalysis = null;
    handleAnalyze(text);
  }
});
```

#### 아이콘 클릭 — 패널 수동 열기:

```js
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
```

> `setPanelBehavior({ openPanelOnActionClick: true })`도 가능하지만,
> `action.onClicked`를 쓰면 열기 전후에 추가 로직을 넣을 수 있다.

---

### 3. sidepanel.js — 포트 연결 + 자동 재연결

MV3 서비스 워커는 유휴 시 종료된다.
종료되면 포트 연결이 끊어지고, `panelPort`가 `null`이 된다.
패널은 화면에 남아있지만 background와 통신이 불가능해진다.

```js
function connectPort() {
  port = chrome.runtime.connect({ name: 'sidepanel' });

  port.onMessage.addListener((msg) => {
    // 메시지 처리 (loading, result, error 등)
  });

  // 🔑 서비스 워커 재시작 시 자동 재연결
  port.onDisconnect.addListener(() => connectPort());
}

connectPort(); // 초기 연결
```

**왜 재연결이 필요한가?**
1. 사용자가 패널을 열어둔 채 한동안 사용하지 않음
2. 서비스 워커가 유휴 종료됨 → 포트 끊김
3. 사용자가 텍스트를 선택하고 분석 버튼 클릭
4. 서비스 워커가 재시작됨 → `panelPort`는 `null`
5. 패널의 `onDisconnect` → `connectPort()` → 새 포트 연결
6. `onConnect`에서 `panelPort` 재설정 → 통신 복구

---

## 타임라인 (패널이 닫혀있을 때)

```
시간 →

[사용자]     텍스트 선택 → 버튼 클릭(mousedown)
                              │
[content.js]  sendMessage({ type: 'analyze', text })
                              │
[background]  onMessage 수신
              panelPort === null → pendingAnalysis = text
              sidePanel.open({ tabId: sender.tab.id })
                              │
              ... Chrome이 사이드 패널을 열고 sidepanel.html 로드 ...
                              │
[sidepanel]   <script> 실행 → connectPort()
              chrome.runtime.connect({ name: 'sidepanel' })
                              │
[background]  onConnect 발생
              panelPort = port
              pendingAnalysis !== null → handleAnalyze(text)
              sendToPanel({ type: 'loading' })
                              │
[sidepanel]   onMessage: 'loading' → 스켈레톤 UI 표시
                              │
[background]  ... Gemini API 호출 ...
              sendToPanel({ type: 'result', data })
                              │
[sidepanel]   onMessage: 'result' → 문법 분석 렌더링
```

---

## manifest.json 필수 설정

```json
{
  "permissions": ["sidePanel", "activeTab", "storage"],
  "host_permissions": [
    "https://generativelanguage.googleapis.com/*",
    "https://aiplatform.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "ET Grammar"
  }
}
```

- `sidePanel` 권한: `chrome.sidePanel` API 사용
- `activeTab` 권한: `sender.tab.id` 접근
- `action`: 아이콘 클릭 이벤트 활성화 (`default_popup` 없어야 `onClicked` 발생)
- `side_panel.default_path`: 패널에 로드할 HTML

---

## 흔한 실수와 해결

| 실수 | 증상 | 해결 |
|------|------|------|
| `click` 이벤트 사용 | `sidePanel.open()` 실패 (gesture 소실) | `mousedown` + `preventDefault()` 사용 |
| `setPanelBehavior` + `action.onClicked` 동시 사용 | `onClicked` 발생 안 함 | 둘 중 하나만 사용 |
| 포트 재연결 없음 | SW 재시작 후 패널에 결과 안 옴 | `onDisconnect`에서 `connectPort()` |
| `pendingAnalysis` 없음 | 패널 닫힌 상태에서 분석하면 결과 유실 | 대기열 패턴 사용 |
| `host_permissions` 누락 | `Failed to fetch` | API 도메인 추가 |
| 포트 연결 전 `postMessage` | 메시지 유실 (에러 없음) | `panelPort` null 체크 |
