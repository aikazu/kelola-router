# Kiro CLI Reverse-Engineering Notes (agent playbook)

> **Audience: a future AI agent maintaining this repo.** This is the single source
> of truth for how the `cli` Kiro persona was reverse-engineered, what is verified
> vs assumed, and exactly how to re-verify or fix it when the Kiro CLI updates or
> the backend changes. Everything here was captured from **real kiro-cli 2.6.0
> traffic via mitmproxy** unless explicitly marked "assumed".

Last verified: 2026-06-09 against `kiro-cli 2.6.0`, region `us-east-1`, account type IDC.

---

## 1. Why this exists

Kiro upstream has two client "personas" the router can impersonate:

| Persona | Host | Fingerprint | Status |
|---------|------|-------------|--------|
| `ide` (default) | `codewhisperer.{region}.amazonaws.com` | aws-sdk-js + `KiroIDE` | legacy, battle-tested, leave alone |
| `cli` (experimental) | `runtime.{region}.kiro.dev` | aws-sdk-rust + `AmazonQ-For-CLI` | mirrors real `kiro-cli`, ban-risk-reduced |

The persona is stored per-account in `provider_data.persona` and toggled from the
dashboard (Upstream → Edit → Persona) or `PATCH /api/admin/accounts/:id {persona}`.
**Default is `ide`** — never change that default without explicit instruction.

The whole point of `cli` is to look byte-identical to the real CLI so the account
is less likely to get flagged/banned. **Accuracy of the wire format is the entire
value.** If you change it, re-verify against a real capture.

---

## 2. Code map (where everything lives)

```
src/providers/kiro/
├── constants.ts     # endpoints, persona type, CLI version constants, UA builders,
│                    #   toCliModelId(), management endpoint
├── transform.ts     # buildKiroPayload() — branches IDE vs CLI body shape
├── index.ts         # executeKiro() — picks endpoint + headers per persona,
│                    #   calls ensureProfileArn() for cli
├── profile.ts       # discoverProfileArn() + ensureProfileArn() (ListAvailableProfiles)
├── auth.ts          # ensureAccessToken() — token refresh + DB cache
├── tokenRefresh.ts  # KiroProviderData type (persona, profileArn, clientId, ...)
└── *.test.ts        # unit tests; profile.test.ts + transform/constants persona tests
src/api/admin/accounts.ts   # PATCH accepts {persona, profileArn} → merged into provider_data
client/src/pages/Accounts.tsx  # persona dropdown in Edit modal + IDE/CLI badge
```

**Key functions to look at first when something breaks:**
- `buildKiroPayload(model, body, {persona})` in `transform.ts` — the body shape.
- `buildKiroHeaders(auth, persona)` in `index.ts` — the headers.
- `resolveKiroEndpoint(persona, region)` in `constants.ts` — which host.
- `ensureProfileArn()` in `profile.ts` — profileArn discovery.

---

## 3. Verified CLI wire formats

### 3.1 Chat — `GenerateAssistantResponse`

```
POST https://runtime.{region}.kiro.dev/        (HTTP/1.1)
Content-Type:  application/x-amz-json-1.0
Accept:        */*
X-Amz-Target:  AmazonCodeWhispererStreamingService.GenerateAssistantResponse
User-Agent:    aws-sdk-rust/1.3.15 ua/2.1 api/codewhispererstreaming/0.1.16551 os/windows lang/rust/1.92.0 exec-env/AmazonQ-For-CLI Version/2.6.0 md/appVersion-2.6.0 app/AmazonQ-For-CLI
x-amz-user-agent: (same but tail is `m/F app/AmazonQ-For-CLI`, no md/appVersion)
x-amzn-codewhisperer-optout: false
Accept-Encoding: gzip
Authorization: Bearer <accessToken>
Amz-Sdk-Invocation-Id: <uuid>
Amz-Sdk-Request: attempt=1; max=3
```

Body (the parts that matter — **all verified against the full captured body**):

```jsonc
{
  "conversationState": {
    "chatTriggerType": "MANUAL",          // REQUIRED — do NOT drop for cli
    "conversationId": "<uuid>",
    "currentMessage": {
      "userInputMessage": {
        "content": "...",
        "modelId": "claude-sonnet-4.6",   // DOTTED, not hyphenated (see §3.3)
        "origin": "KIRO_CLI",
        "userInputMessageContext": {
          "envState": {
            "operatingSystem": "windows",
            "currentWorkingDirectory": "C:\\..."
          },
          "tools": [ ... ]                 // real CLI sends 14 tools; router omits — accepted
        }
      }
    },
    "history": [ ... ],                    // each user msg also carries origin + envState
    "agentContinuationId": "<uuid>",       // REQUIRED-ish: real CLI always sends it
    "agentTaskType": "vibe"                // REQUIRED-ish: real CLI always sends it
  },
  "profileArn": "arn:aws:codewhisperer:{region}:{acct}:profile/{id}"  // REQUIRED (see §4)
  // NOTE: NO `inferenceConfig` for cli. The IDE path sends it; the runtime host rejects it.
}
```

**Gotchas learned the hard way (each caused a 400 until fixed):**
1. Dropping `chatTriggerType` → `400 REQUEST_BODY_INVALID`. The first capture was
   truncated at 30 KB and hid this field; I wrongly removed it. **Keep `MANUAL`.**
2. Sending `inferenceConfig` → contributes to `REQUEST_BODY_INVALID`. The IDE host
   accepts it; the runtime host does not. Omit for cli.
3. Missing `agentContinuationId` / `agentTaskType` → the real CLI always sends them;
   include them for cli to stay identical.
4. Hyphenated modelId → `400 INVALID_MODEL_ID` (see §3.3).
5. Missing `profileArn` → `400 "profileArn is required for this request."` (see §4).

### 3.2 Profile discovery — `ListAvailableProfiles` / `GetProfile`

```
POST https://management.{region}.kiro.dev/
Content-Type: application/x-amz-json-1.0
X-Amz-Target: AmazonCodeWhispererService.ListAvailableProfiles
User-Agent:   ...api/codewhispererruntime/0.1.16551...   // NOTE: "runtime", not "streaming"
Authorization: Bearer <accessToken>
Body: {}
```
Response:
```json
{"profiles":[{"arn":"arn:aws:codewhisperer:us-east-1:730335587721:profile/X7UKYWNDQVV7","profileName":"KiroProfile-us-east-1"}]}
```

- The CLI probes **multiple regions** (saw `us-east-1` + `eu-central-1`); empty regions
  return no profiles. The router only probes the account's region (default `us-east-1`).
- `GetProfile` takes a `profileArn` as **input** (`{"profileArn":"..."}`) and returns
  full profile details incl. the model catalog. It is **not** a discovery call — the
  CLI already had the ARN cached. Use `ListAvailableProfiles` to discover.
- The management UA uses `api/codewhispererruntime/...` whereas chat uses
  `api/codewhispererstreaming/...`. This is why `kiroCliUserAgent()` takes an
  `'streaming' | 'runtime'` arg.

### 3.3 Model id format

The runtime host rejects hyphenated version ids (`claude-sonnet-4-6`) with
`400 INVALID_MODEL_ID`. The CLI uses **dotted** ids (`claude-sonnet-4.6`).
`toCliModelId()` in `constants.ts` converts the trailing `-N-M` → `-N.M`.
`auto` / `auto-thinking` have no version and pass through unchanged.

Verified model catalog from `GetProfile` (2026-06-09, defaultModel = `claude-opus-4.8`):

```
auto, claude-opus-4.8, claude-opus-4.7, claude-opus-4.6, claude-sonnet-4.6,
claude-opus-4.5, claude-sonnet-4.5, claude-sonnet-4, claude-haiku-4.5,
deepseek-3.2, minimax-m2.5, minimax-m2.1, glm-5, qwen3-coder-next
```

Router-side seeded models use hyphenated ids (e.g. `claude-sonnet-4-6`); the dotting
happens only in the cli payload. If a new model appears upstream, seed it hyphenated
and `toCliModelId` will handle the rest — **as long as it follows the `name-N-M`
shape.** Odd names (e.g. `deepseek-3.2`, `minimax-m2.5`, `glm-5`) do NOT match the
`-N-M$` regex, so if you ever route those through cli you must map them explicitly.

---

## 4. profileArn auto-discovery

- `runtime.kiro.dev` **requires** `profileArn`; the IDE/codewhisperer host does not.
- Accounts onboarded via OAuth device-code (Builder ID / IDC) or raw refresh token
  do **not** have a profileArn in `provider_data`.
- `ensureProfileArn()` (in `profile.ts`) is called from `executeKiro()` only when
  `persona === 'cli'`. If `provider_data.profileArn` is missing, it discovers via
  `ListAvailableProfiles`, persists it into `provider_data`, and mutates the in-memory
  `auth.providerData` so the current request uses it. Discovery then runs once.
- A user can also set it manually: `PATCH /accounts/:id {profileArn:"arn:..."}`.

---

## 5. Version constants to bump when the CLI updates

When `kiro-cli` ships a new version, the User-Agent + protocol versions change.
Update these in `src/providers/kiro/constants.ts` after capturing the new UA:

```ts
KIRO_CLI_VERSION = '2.6.0'              // exec-env Version/ + md/appVersion-
KIRO_CLI_SDK_VERSION = '1.3.15'        // aws-sdk-rust/<this>
KIRO_CLI_STREAMING_API_VERSION = '0.1.16551'  // api/codewhisperer{streaming|runtime}/<this>
KIRO_CLI_APP_NAME = 'AmazonQ-For-CLI'  // exec-env/ + app/
```

The IDE persona has its own pin in `src/providers/kiro/index.ts`:
```ts
KIRO_IDE_VERSION = '0.12.292'   // KiroIDE-<this>-<machineId>
```

Find the current installed CLI version:
```powershell
& "$env:LOCALAPPDATA\Kiro-Cli\kiro-cli.exe" --version
```

---

## 6. Re-capture procedure (mitmproxy) — verified, copy-paste

The real CLI uses **reqwest + rustls**, which loads **native Windows certs** and
respects `HTTPS_PROXY`. So: trust the mitmproxy CA in the Windows user root store,
point `HTTPS_PROXY` at mitmdump, run the CLI. Keep each command short — PowerShell
chokes on long bundled commands and `Start-Process` with redirects.

> ⚠️ Security: this trusts a MITM CA on your machine. **Always undo it** (§6.5).

### 6.1 Install + start mitmdump (background)
```powershell
pip install mitmproxy
$mitm = "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\mitmdump.exe"
Start-Process -FilePath $mitm -ArgumentList "-p","8888","--set","confdir=$PWD\data\mitm","-s","$PWD\data\mitm\profile_addon.py","-q" -WindowStyle Hidden
```
The CA cert is generated at `data/mitm/mitmproxy-ca-cert.cer` on first run.

### 6.2 Trust the CA (user root store — no admin needed)
```powershell
certutil -user -addstore Root data/mitm/mitmproxy-ca-cert.cer
```

### 6.3 Capture addon (`data/mitm/profile_addon.py`)
A minimal addon: log every host+`x-amz-target` to `hosts.log`, and dump full
request+response bodies for any `management.*` / `*Profile*` / `*GenerateAssistantResponse*`
call to a JSON file. (Recreate it — `data/mitm/` is gitignored / cleaned after use.)
Key point: capture the **full** body — the streaming chat body is ~60 KB and an
early truncation hid `chatTriggerType` and cost a debugging cycle.

### 6.4 Trigger the CLI through the proxy (short, standalone commands)
```powershell
$env:HTTPS_PROXY="http://127.0.0.1:8888"; $env:HTTP_PROXY="http://127.0.0.1:8888"
& "$env:LOCALAPPDATA\Kiro-Cli\kiro-cli.exe" chat --no-interactive "hi"
& "$env:LOCALAPPDATA\Kiro-Cli\kiro-cli.exe" profile     # triggers ListAvailableProfiles (errors on TTY, but the call fires)
```
Inspect `data/mitm/hosts.log` for hosts + targets, then read the dumped JSON.

### 6.5 CLEANUP (mandatory)
```powershell
Get-Process mitmdump -EA SilentlyContinue | Stop-Process -Force
certutil -user -delstore Root "mitmproxy"     # removes by subject; verify count is 0 after
pip uninstall mitmproxy -y
Remove-Item -Recurse -Force data/mitm
```
Verify the cert is gone:
```powershell
(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -match 'mitmproxy' }).Count   # must be 0
```

---

## 7. Live test against the router (no proxy needed)

The router itself talks to the real endpoint. To verify a cli-persona account:
```powershell
$body = @{model="auto";messages=@(@{role="user";content="reply only: pong"})} | ConvertTo-Json -Depth 5
Invoke-WebRequest -Uri http://127.0.0.1:20137/v1/chat/completions -Method POST `
  -Headers @{"Authorization"="Bearer <client_key>"} -ContentType "application/json" -Body $body
```
Expect `200` and `pong`. Test each catalog model + `auto-thinking` + `stream=$true`.

> The dashboard on :20137 is baked into the Docker image. After changing
> `client/src` **or** server code, rebuild:
> ```powershell
> docker compose build
> docker compose up -d --force-recreate
> ```

---

## 8. Troubleshooting playbook (error → cause → fix)

| Upstream error | Most likely cause | Fix |
|----------------|-------------------|-----|
| `400 ValidationException · REQUEST_BODY_INVALID · "Improperly formed request"` | Body shape drift: missing `chatTriggerType`/`agentContinuationId`/`agentTaskType`, or stray `inferenceConfig` | Re-capture chat body (§6), diff against `buildKiroPayload` cli branch in `transform.ts` |
| `400 · "profileArn is required for this request."` | Account has no profileArn and discovery failed/disabled | Check `ensureProfileArn()` ran; verify `ListAvailableProfiles` still returns profiles (§3.2); set manually via PATCH |
| `400 · INVALID_MODEL_ID` | Hyphenated modelId reached runtime host, or model not in catalog | Confirm `toCliModelId()` applied; check model exists in `GetProfile` catalog (§3.3); add explicit mapping for odd names |
| `403` on chat or ListAvailableProfiles | Expired/invalid bearer, or UA/version too stale and rejected | Check token refresh (`auth.ts`); bump CLI version constants (§5) after capturing fresh UA |
| `200` but garbled/empty stream | event-stream decoder drift (`eventstream.ts` / assemblers) | Capture raw `application/vnd.amazon.eventstream` bytes and compare frame parsing |
| Router says `unknown model: X` (not an upstream error) | Model not seeded in DB | `npx tsx scripts/seed-kiro-models.ts` or add the model |

**General method when the backend changes:** re-capture (§6) → diff the real request
against what `buildKiroPayload` + `buildKiroHeaders` produce (a quick `tsx` script that
prints `buildKiroPayload('auto', {...}, {persona:'cli'})` is the fastest diff) → patch
→ add/adjust a test in `transform.test.ts` / `constants.test.ts` / `profile.test.ts` →
`npm run typecheck && npx vitest run src/providers/kiro` → rebuild Docker → live test (§7).

---

## 9. Things that are ASSUMED / not fully verified

- **Multi-region profile probing.** Router only probes the account region; the real CLI
  probes several. If a user's profile lives in a non-default region and `provider_data.region`
  is unset, discovery may miss it. Fix: store region at onboarding, or probe a region list.
- **Tools array.** The real CLI sends 14 tool specs in `userInputMessageContext.tools`;
  the router omits them and the endpoint still accepts the request. If upstream starts
  requiring tools, capture and replicate them.
- **`agentTaskType: "vibe"`.** Observed constant in captures; meaning unknown. Other
  values may exist for different CLI modes (e.g. non-chat agent tasks).
- **Prompt caching fields.** `GetProfile` advertises `promptCaching` per model; the
  router does not yet send cache checkpoints on the cli path.


---

## 10. OS fingerprint consistency (cross-platform / Linux Docker)

**The whole router runs cross-platform fine** (no Windows-only syscalls; `better-sqlite3`
builds on Linux/macOS; the Docker base image is Linux; `process.platform`/`process.cwd()`/
`homedir()`/`path.join()` are all portable; auto-import degrades gracefully when
`~/.aws/sso/cache` is absent). So "does it run on Linux?" → **yes**.

**But the cli persona fingerprint must stay internally consistent.** The cli User-Agent
hardcodes `os/windows` (in `kiroCliUserAgent()` / `kiroCliAmzUserAgent()` in `constants.ts`)
because that is the exact wire format captured from a real **Windows** kiro-cli. The IDE
persona UA likewise hardcodes `os/windows#10.0.26200` in `index.ts`.

Originally `buildEnvState()` derived `operatingSystem` from `process.platform`. Since the
router actually runs in a **Linux** container, that produced a request with:

- `User-Agent: ... os/windows ...`  (hardcoded)
- `envState.operatingSystem: "linux"`  (dynamic)
- `envState.currentWorkingDirectory: "/app"`

i.e. **UA says Windows, envState says Linux** — a combination a real kiro-cli never emits,
which is exactly the kind of inconsistency that raises ban risk for the cli persona.

**Decision (2026-06-09): pin the cli fingerprint to the verified Windows profile.**
`buildEnvState()` now returns the constants `KIRO_CLI_OPERATING_SYSTEM = 'windows'` +
`KIRO_CLI_WORKING_DIRECTORY = 'C:\\Users\\user'` (both in `constants.ts`), so UA + envState
all agree and match the one capture we actually verified — regardless of host OS.

**If you ever want true Linux/macOS-native mimicry:** do NOT just flip `os/windows` →
`os/linux` from memory. Capture a real kiro-cli on that OS first (§6) — the UA tail differs
(kernel/version suffixes, possibly a different `lang/rust` build), and getting it wrong is
worse than a consistent Windows profile. Then make UA **and** envState **and** cwd all derive
from the same verified per-OS source together.
