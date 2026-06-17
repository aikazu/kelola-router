# Notion Desktop Capture Notes

**Source HAR:** `capture.har`
**Total Notion entries (non-static):** 1080

## Counts by Category

- `auth_otp_send`: 0
- `auth_otp_verify`: 4
- `auth_token_refresh`: 0
- `ai_chat`: 8
- `user_workspace`: 0
- `other`: 1068

---

## Authentication
- Token field path: `loginOptionsToken`
- refresh_token: NOT PRESENT (re-auth via OTP only)

### Send OTP

(no entries found)


### Verify OTP

#### Entry 1: POST /api/v3/getLoginOptions
- Status: 200
- Response Content-Type: `application/json; charset=utf-8`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:6ZoD9Ow25YOmn3iAz3BgeTEmz9XCFE9TS6VuK89DHUtHbKr4V68ntjbhBJzX8j1zcsBEuP0b085QGyeDWoNYfQ2jbgX8LHm-55LpwgEmtjZSDbJTyf9TGz04meQQip86j9ipOx3WJmb30Dv8oCYWaZO4"
}
```

**Response body** (first 600 chars):
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:6ZoD9Ow25YOmn3iAz3BgeTEmz9XCFE9TS6VuK89DHUtHbKr4V68ntjbhBJzX8j1zcsBEuP0b085QGyeDWoNYfQ2jbgX8LHm-55LpwgEmtjZSDbJTyf9TGz04meQQip86j9ipOx3WJmb30Dv8oCYWaZO4"
}
```

#### Entry 2: POST /api/v3/getLoginOptions
- Status: 200
- Response Content-Type: `application/json; charset=utf-8`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:6ZoD9Ow25YOmn3iAz3BgeTEmz9XCFE9TS6VuK89DHUtHbKr4V68ntjbhBJzX8j1zcsBEuP0b085QGyeDWoNYfQ2jbgX8LHm-55LpwgEmtjZSDbJTyf9TGz04meQQip86j9ipOx3WJmb30Dv8oCYWaZO4"
}
```

**Response body** (first 600 chars):
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:6ZoD9Ow25YOmn3iAz3BgeTEmz9XCFE9TS6VuK89DHUtHbKr4V68ntjbhBJzX8j1zcsBEuP0b085QGyeDWoNYfQ2jbgX8LHm-55LpwgEmtjZSDbJTyf9TGz04meQQip86j9ipOx3WJmb30Dv8oCYWaZO4"
}
```

#### Entry 3: POST /api/v3/loginWithEmail
- Status: 200
- Response Content-Type: `application/json; charset=utf-8`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
{
  "isNewSignup": false,
  "userId": "382d872b-594c-81ff-b89c-00021216a6b0"
}
```

**Response body** (first 600 chars):
```json
{
  "isNewSignup": false,
  "userId": "382d872b-594c-81ff-b89c-00021216a6b0"
}
```

#### Entry 4: POST /api/v3/loginWithEmail
- Status: 200
- Response Content-Type: `application/json; charset=utf-8`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
{
  "isNewSignup": false,
  "userId": "382d872b-594c-81ff-b89c-00021216a6b0"
}
```

**Response body** (first 600 chars):
```json
{
  "isNewSignup": false,
  "userId": "382d872b-594c-81ff-b89c-00021216a6b0"
}
```


### Token Refresh

(no entries found)


---

## AI Chat

### Chat Requests

#### Entry 1: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-81d9-a7d4-00aaa76c719b\",\"type\":\"agent-instruction-state\",\"owner\":\"regular\",\"root\":{\"type\":\"none\"},\"sources\":[],\"selectedSkillPageIds\":[],\"trackedInstructionTreePages\":[]}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-8104-aeb3-00aac2e28f3e\",\"type\":\"agent-turn-full-record-map\"}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-81a1-8564-00aa88e61912\",\"type\":\"agent-tool-result\",\"toolName\":"
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-81d9-a7d4-00aaa76c719b","type":"agent-instruction-state","owner":"regular","root":{"type":"none"},"sources":[],"selectedSkillPageIds":[],"trackedInstructionTreePages":[]}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-8104-aeb3-00aac2e28f3e","type":"agent-turn-full-record-map"}}]}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-81a1-8564-00aa88e61912","type":"agent-tool-result","toolName":"callFunction","toolType":"callFunction","traceId":"a86f5dec-9ad4-4d7c-aca7-cc6bb181f4df","startedAt
```

#### Entry 2: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-81d9-a7d4-00aaa76c719b\",\"type\":\"agent-instruction-state\",\"owner\":\"regular\",\"root\":{\"type\":\"none\"},\"sources\":[],\"selectedSkillPageIds\":[],\"trackedInstructionTreePages\":[]}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-8104-aeb3-00aac2e28f3e\",\"type\":\"agent-turn-full-record-map\"}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-81a1-8564-00aa88e61912\",\"type\":\"agent-tool-result\",\"toolName\":"
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-81d9-a7d4-00aaa76c719b","type":"agent-instruction-state","owner":"regular","root":{"type":"none"},"sources":[],"selectedSkillPageIds":[],"trackedInstructionTreePages":[]}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-8104-aeb3-00aac2e28f3e","type":"agent-turn-full-record-map"}}]}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-81a1-8564-00aa88e61912","type":"agent-tool-result","toolName":"callFunction","toolType":"callFunction","traceId":"a86f5dec-9ad4-4d7c-aca7-cc6bb181f4df","startedAt
```

#### Entry 3: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-8170-86ef-00aa33477967\",\"type\":\"agent-turn-full-record-map\"}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-81da-8318-00aad193e909\",\"type\":\"agent-inference\",\"value\":[{\"type\":\"text\",\"content\":\"Halo, Attila!\"}],\"traceId\":\"c5cee9ca-dd84-49b2-893a-a2283fc1970a\",\"startedAt\":1781725646413,\"previousAttemptValues\":[]}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"x\",\"p\":\"/s/1/value/0/content\",\"v\":\" 👋 Senang ngobrol sama kamu. Ada "
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-8170-86ef-00aa33477967","type":"agent-turn-full-record-map"}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-81da-8318-00aad193e909","type":"agent-inference","value":[{"type":"text","content":"Halo, Attila!"}],"traceId":"c5cee9ca-dd84-49b2-893a-a2283fc1970a","startedAt":1781725646413,"previousAttemptValues":[]}}]}
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":" 👋 Senang ngobrol sama kamu. Ada yang"}]}
{"type":"patch-sync","version":1,"data":{"s":[{"id":"382966f7-8a76-8170-86ef-00aa33477967",
```

#### Entry 4: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-8170-86ef-00aa33477967\",\"type\":\"agent-turn-full-record-map\"}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-81da-8318-00aad193e909\",\"type\":\"agent-inference\",\"value\":[{\"type\":\"text\",\"content\":\"Halo, Attila!\"}],\"traceId\":\"c5cee9ca-dd84-49b2-893a-a2283fc1970a\",\"startedAt\":1781725646413,\"previousAttemptValues\":[]}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"x\",\"p\":\"/s/1/value/0/content\",\"v\":\" 👋 Senang ngobrol sama kamu. Ada "
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-8170-86ef-00aa33477967","type":"agent-turn-full-record-map"}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-81da-8318-00aad193e909","type":"agent-inference","value":[{"type":"text","content":"Halo, Attila!"}],"traceId":"c5cee9ca-dd84-49b2-893a-a2283fc1970a","startedAt":1781725646413,"previousAttemptValues":[]}}]}
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":" 👋 Senang ngobrol sama kamu. Ada yang"}]}
{"type":"patch-sync","version":1,"data":{"s":[{"id":"382966f7-8a76-8170-86ef-00aa33477967",
```

#### Entry 5: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-8177-adba-00aa53d7bef4\",\"type\":\"agent-instruction-state\",\"owner\":\"regular\",\"root\":{\"type\":\"none\"},\"sources\":[],\"selectedSkillPageIds\":[],\"trackedInstructionTreePages\":[]}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-813b-913f-00aacc977725\",\"type\":\"agent-turn-full-record-map\"}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-8142-b5dc-00aaccbc23d9\",\"type\":\"agent-tool-result\",\"toolName\":"
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-8177-adba-00aa53d7bef4","type":"agent-instruction-state","owner":"regular","root":{"type":"none"},"sources":[],"selectedSkillPageIds":[],"trackedInstructionTreePages":[]}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-813b-913f-00aacc977725","type":"agent-turn-full-record-map"}}]}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-8142-b5dc-00aaccbc23d9","type":"agent-tool-result","toolName":"callFunction","toolType":"callFunction","traceId":"f69587c6-56ac-4a55-be03-04fd46339bd7","startedAt
```

#### Entry 6: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-8177-adba-00aa53d7bef4\",\"type\":\"agent-instruction-state\",\"owner\":\"regular\",\"root\":{\"type\":\"none\"},\"sources\":[],\"selectedSkillPageIds\":[],\"trackedInstructionTreePages\":[]}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-813b-913f-00aacc977725\",\"type\":\"agent-turn-full-record-map\"}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-8142-b5dc-00aaccbc23d9\",\"type\":\"agent-tool-result\",\"toolName\":"
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-8177-adba-00aa53d7bef4","type":"agent-instruction-state","owner":"regular","root":{"type":"none"},"sources":[],"selectedSkillPageIds":[],"trackedInstructionTreePages":[]}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-813b-913f-00aacc977725","type":"agent-turn-full-record-map"}}]}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-8142-b5dc-00aaccbc23d9","type":"agent-tool-result","toolName":"callFunction","toolType":"callFunction","traceId":"f69587c6-56ac-4a55-be03-04fd46339bd7","startedAt
```

#### Entry 7: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-8194-8271-00aa0729c1e1\",\"type\":\"agent-turn-full-record-map\"}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-81d1-97fe-00aabebb61f5\",\"type\":\"agent-inference\",\"value\":[{\"type\":\"text\",\"content\":\"Hi\"}],\"traceId\":\"5e82eff1-461a-4490-8928-04ed98db6ce5\",\"startedAt\":1781725877655,\"previousAttemptValues\":[]}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"x\",\"p\":\"/s/1/value/0/content\",\"v\":\" Attila! 👋 What can I help you with?\"}]}\n{\"t"
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-8194-8271-00aa0729c1e1","type":"agent-turn-full-record-map"}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-81d1-97fe-00aabebb61f5","type":"agent-inference","value":[{"type":"text","content":"Hi"}],"traceId":"5e82eff1-461a-4490-8928-04ed98db6ce5","startedAt":1781725877655,"previousAttemptValues":[]}}]}
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":" Attila! 👋 What can I help you with?"}]}
{"type":"patch","v":[{"o":"a","p":"/s/1/finishedAt","v":1781725881807},{"o":"a","p":"/s/1/inputTokens",
```

#### Entry 8: POST /api/v3/runInferenceTranscript
- Status: 200
- Response Content-Type: `application/x-ndjson`

**Request headers (filtered):**
- `notion-client-version`: `23.13.20260617.1538`
- `content-type`: `application/json`

**Request body:**
```json
"{\"type\":\"patch-start\",\"data\":{\"s\":[{\"id\":\"382966f7-8a76-8194-8271-00aa0729c1e1\",\"type\":\"agent-turn-full-record-map\"}]},\"version\":1}\n{\"type\":\"patch\",\"v\":[{\"o\":\"a\",\"p\":\"/s/-\",\"v\":{\"id\":\"382966f7-8a76-81d1-97fe-00aabebb61f5\",\"type\":\"agent-inference\",\"value\":[{\"type\":\"text\",\"content\":\"Hi\"}],\"traceId\":\"5e82eff1-461a-4490-8928-04ed98db6ce5\",\"startedAt\":1781725877655,\"previousAttemptValues\":[]}}]}\n{\"type\":\"patch\",\"v\":[{\"o\":\"x\",\"p\":\"/s/1/value/0/content\",\"v\":\" Attila! 👋 What can I help you with?\"}]}\n{\"t"
```

**Response body** (first 600 chars):
```
{"type":"patch-start","data":{"s":[{"id":"382966f7-8a76-8194-8271-00aa0729c1e1","type":"agent-turn-full-record-map"}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"382966f7-8a76-81d1-97fe-00aabebb61f5","type":"agent-inference","value":[{"type":"text","content":"Hi"}],"traceId":"5e82eff1-461a-4490-8928-04ed98db6ce5","startedAt":1781725877655,"previousAttemptValues":[]}}]}
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":" Attila! 👋 What can I help you with?"}]}
{"type":"patch","v":[{"o":"a","p":"/s/1/finishedAt","v":1781725881807},{"o":"a","p":"/s/1/inputTokens",
```

### Model IDs Observed
(none — capture didn't include model field)

---

## Error Responses
- 401 POST https://app.notion.com/api/v3/getExternalOrgData
- 401 POST https://app.notion.com/api/v3/getExternalOrgData

---

## Other Notion Traffic (context only)

### User/Workspace Lookups

(no entries found)


### Other

#### Entry 1: POST /v1/rgstr
- Status: 202
- Response Content-Type: `application/json`

**Request headers (filtered):**

**Request body:**
```json
{
  "success": true
}
```

**Response body** (first 600 chars):
```json
{
  "success": true
}
```

#### Entry 2: POST /v1/rgstr
- Status: 202
- Response Content-Type: `application/json`

**Request headers (filtered):**

**Request body:**
```json
{
  "success": true
}
```

**Response body** (first 600 chars):
```json
{
  "success": true
}
```

#### Entry 3: POST /v1/rgstr
- Status: 202
- Response Content-Type: `application/json`

**Request headers (filtered):**

**Request body:**
```json
{
  "success": true
}
```

**Response body** (first 600 chars):
```json
{
  "success": true
}
```

#### Entry 4: POST /v1/rgstr
- Status: 202
- Response Content-Type: `application/json`

**Request headers (filtered):**

**Request body:**
```json
{
  "success": true
}
```

**Response body** (first 600 chars):
```json
{
  "success": true
}
```

#### Entry 5: POST /v1/rgstr
- Status: 202
- Response Content-Type: `application/json`

**Request headers (filtered):**

**Request body:**
```json
{
  "success": true
}
```

**Response body** (first 600 chars):
```json
{
  "success": true
}
```
