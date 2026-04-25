# 에스보냥 (SVOCAt) 개인정보 처리방침

*Privacy Policy for SVOCAt Chrome Extension*

**최종 수정일 / Last Updated**: 2026-04-18
**버전 / Version**: 2.1.0

---

## 한국어

### 요약

- 본 확장은 사용자의 개인정보를 **수집하지 않으며**, 개발자 소유의 서버로 전송하지 않습니다.
- 모든 설정(API 키, 모델 선택, 분석 히스토리)은 사용자의 **브라우저 로컬 저장소**에만 보관됩니다.
- 텍스트 분석 요청은 사용자가 선택한 AI 제공사(Google, Groq 등)로 **직접** 전송됩니다.

### 1. 수집하는 정보

본 확장은 다음 정보만을 사용자로부터 입력받으며, 모두 `chrome.storage.local`(브라우저 로컬 저장소)에 저장됩니다:

| 항목 | 설명 | 저장 위치 |
|---|---|---|
| API 키 | Google Gemini, Groq, Vertex AI 등 AI 제공사의 키 | `chrome.storage.local` |
| 모델 선택 | 분석에 사용할 AI 모델 | `chrome.storage.local` |
| 분석 히스토리 | 최근 분석한 문장/결과 (최대 10건) | `chrome.storage.local` |

본 확장은 사용자의 이메일, 이름, 위치 등 **개인 식별 정보를 수집하지 않습니다**.

### 2. 정보의 사용

- **API 키**: 사용자가 텍스트 분석을 요청할 때, 사용자가 선택한 AI 제공사의 API 엔드포인트로만 전송됩니다.
- **선택한 텍스트(분석 대상)**: 동일한 AI 제공사로 전송되어 문법 구조 분석 및 번역에 사용됩니다.
- **분석 히스토리**: 사이드패널의 "최근 분석" 기능을 위해 로컬에만 보관됩니다. 외부로 전송되지 않습니다.
- 개발자(서비스 제공자)는 이 정보에 **접근할 수 없습니다**.

### 3. 외부 서비스 (제3자 제공)

사용자가 텍스트 분석을 요청하면, 해당 텍스트가 사용자 본인이 선택한 다음 AI 제공사 중 하나로 전송됩니다:

| 제공사 | 엔드포인트 | 개인정보처리방침 |
|---|---|---|
| Google (Gemini API) | `generativelanguage.googleapis.com` | [https://policies.google.com/privacy](https://policies.google.com/privacy) |
| Google (Vertex AI) | `aiplatform.googleapis.com` | [https://cloud.google.com/terms/cloud-privacy-notice](https://cloud.google.com/terms/cloud-privacy-notice) |
| Groq | `api.groq.com` | [https://groq.com/privacy-policy](https://groq.com/privacy-policy) |

각 제공사의 약관과 개인정보처리방침이 해당 전송에 적용됩니다. **본 확장은 이 전송의 단순 중계자**이며, 전송되는 텍스트의 내용을 열람·저장·가공하지 않습니다.

### 4. 쿠키 및 추적

본 확장은:
- **쿠키를 사용하지 않습니다**.
- 사용자 활동을 **추적하지 않습니다** (click, scroll, usage telemetry 등 없음).
- Google Analytics, Mixpanel 등의 **분석 도구를 포함하지 않습니다**.
- 광고 또는 마케팅 목적의 정보 수집을 하지 않습니다.

### 5. 데이터 저장 및 삭제

- 모든 데이터는 사용자의 **브라우저 로컬 저장소**(`chrome.storage.local`)에만 저장됩니다.
- 확장을 제거하면 관련 데이터가 함께 삭제됩니다.
- **개별 삭제**: 옵션 페이지의 "저장된 키 삭제" 버튼으로 API 키를 삭제할 수 있습니다.
- **히스토리 삭제**: 브라우저의 `chrome.storage.local` 초기화 또는 확장 제거로 가능합니다.
- **완전한 보안**: 삭제 후 잔존 데이터가 우려되면 발급처(Groq/Google)에서 API 키를 직접 폐기(rotate)하세요.

### 6. 보안

- 사용자의 API 키는 암호화되지 않은 상태로 `chrome.storage.local`에 저장됩니다 (Chrome의 자체 암호화 정책을 따름).
- HTTPS를 통해서만 AI 제공사 API와 통신합니다.
- 기기 도난·유출 위험을 방지하려면 OS 수준 암호화(BitLocker, FileVault 등)를 권장합니다.

### 7. 어린이

본 확장은 만 13세 미만 어린이를 대상으로 하지 않으며, 어린이로부터 고의적으로 개인정보를 수집하지 않습니다.

### 8. 변경 사항

본 방침은 향후 수정될 수 있습니다. 중요한 변경사항은 확장 업데이트 릴리스 노트에 공지됩니다. 최신 버전은 본 문서의 상단 "최종 수정일"로 확인할 수 있습니다.

### 9. 연락처

문의 사항이 있으시면 GitHub 레포지토리의 Issues를 통해 전달해주세요:
[https://github.com/joyof-living/englishgrammar2/issues](https://github.com/joyof-living/englishgrammar2/issues)

---

## English

### Summary

- This extension **does not collect** any personal data, and does not transmit any data to servers owned by the developer.
- All settings (API key, model selection, analysis history) are stored only in the user's **browser local storage**.
- Text analysis requests are sent **directly** to the AI provider chosen by the user (Google, Groq, etc.).

### 1. Data We Collect

The extension stores only the following information, all in `chrome.storage.local` (browser-local storage):

| Item | Description | Storage |
|---|---|---|
| API Key | Key for Google Gemini, Groq, Vertex AI, etc. | `chrome.storage.local` |
| Model Selection | Chosen AI model for analysis | `chrome.storage.local` |
| Analysis History | Recently analyzed sentences/results (max 10) | `chrome.storage.local` |

We do **not collect** email, name, location, or other personally identifiable information.

### 2. How Information Is Used

- **API Key**: Sent only to the AI provider's API endpoint when the user requests an analysis.
- **Selected text**: Sent to the same AI provider for grammar analysis and translation.
- **Analysis history**: Stored locally only, for the sidepanel's "Recent Analyses" feature. Never transmitted externally.
- The developer **has no access** to any of this data.

### 3. Third-Party Services

When a user requests analysis, the selected text is sent to one of the following AI providers (chosen by the user):

| Provider | Endpoint | Privacy Policy |
|---|---|---|
| Google (Gemini API) | `generativelanguage.googleapis.com` | [https://policies.google.com/privacy](https://policies.google.com/privacy) |
| Google (Vertex AI) | `aiplatform.googleapis.com` | [https://cloud.google.com/terms/cloud-privacy-notice](https://cloud.google.com/terms/cloud-privacy-notice) |
| Groq | `api.groq.com` | [https://groq.com/privacy-policy](https://groq.com/privacy-policy) |

The terms and privacy policies of each provider apply to such transmissions. **This extension is merely a relay** for these requests and does not read, store, or process the text content.

### 4. Cookies and Tracking

This extension:
- Does **not use cookies**.
- Does **not track** user activity (no click, scroll, or usage telemetry).
- Does **not include** any analytics tools (Google Analytics, Mixpanel, etc.).
- Does not collect data for advertising or marketing purposes.

### 5. Data Storage and Deletion

- All data is stored only in the user's **browser local storage** (`chrome.storage.local`).
- Uninstalling the extension removes all associated data.
- **Individual deletion**: Use the "Delete saved key" button on the options page to remove the API key.
- **History deletion**: Clear `chrome.storage.local` in Chrome settings, or uninstall the extension.
- **Complete security**: If you are concerned about residual data after deletion, rotate (revoke) your API key at the issuing provider (Groq/Google) directly.

### 6. Security

- API keys are stored unencrypted in `chrome.storage.local` (following Chrome's own encryption policies).
- Communication with AI providers happens only over HTTPS.
- To protect against device theft or leaks, OS-level encryption (BitLocker, FileVault, etc.) is recommended.

### 7. Children

This extension is not directed at children under 13, and we do not knowingly collect personal information from children.

### 8. Changes

This policy may be updated from time to time. Significant changes will be announced in the extension's update release notes. The latest version can be identified by the "Last Updated" date at the top of this document.

### 9. Contact

For inquiries, please use GitHub Issues:
[https://github.com/joyof-living/englishgrammar2/issues](https://github.com/joyof-living/englishgrammar2/issues)
