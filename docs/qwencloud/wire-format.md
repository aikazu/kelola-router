# QwenCloud (Aliyun token-plan) Wire Format

`qwencloud` menyambung ke endpoint **Anthropic-Messages-compatible** dari
Aliyun Model Studio (token-plan / applicational-scenario `maas`), di-route
lewat gateway yang berada di region `ap-southeast-1`:

```
POST https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages
```

Semua response berformat **Anthropic Messages** (bukan OpenAI Chat Completions):
`type:"message"`, `role:"assistant"`, `content[]` berbentuk block, dan
`usage` memakai nama `input_tokens`/`output_tokens`. Provider ini cocok untuk
klien yang bicara Anthropic Messages API (Claude Code / Cline / dll).

## Auth header

```
Authorization: Bearer <key>
Content-Type: application/json
anthropic-version: 2023-06-01     # opsional, lihat docs/qwencloud/auth.md
```

Saat streaming tambahkan `Accept: text/event-stream` (response header menjadi
`content-type: text/event-stream; charset=utf-8`; tanpa ini kemungkinan tetap
berjalan, tapi disarankan selalu kirim).

## Model catalogue

Tiga model berikut **terkonfirmasi valid** dan membalas `200 OK` saat probe,
dengan field `model` di response meng-echo nama model persis seperti diminta.
Semua model ber-`context_window` **1M token input** dan `context_output`
**128K token output** (dikonfirmasi user), dengan harga **USD per 1M token**
(harga resmi token-plan Aliyun, dikonfirmasi user; cache leg tidak
dipublikasikan sehingga 0):

| Model id                  | Display                       | Context in | Context out | Input $/M | Output $/M |
|---------------------------|-------------------------------|-----------:|------------:|----------:|-----------:|
| `qwen3.8-max`             | Qwen 3.8 Max                  | 1M         | 128K        | $2.00     | $6.00      |
| `deepseek-v4-flash-0731`  | DeepSeek V4 Flash (0731)      | 1M         | 128K        | $0.44     | $1.32      |
| `deepseek-v4-pro-0813`    | DeepSeek V4 Pro (0813)        | 1M         | 128K        | $1.32     | $3.96      |

Nama model selain itu ditolak dengan `InvalidParameter` (HTTP 400):
`{"code":"InvalidParameter","message":"Model not exist."}`.

## Request shape (non-stream)

Mirip `messages.create`. Body minimal Anthropic cukup `model`, `max_tokens`,
dan `messages`:

```jsonc
{
  "model": "qwen3.8-max",
  "max_tokens": 32,
  "messages": [{ "role": "user", "content": "hi" }]
}
```

Untuk streaming, tambahkan `"stream": true` di body + header
`Accept: text/event-stream`.

## Response shape (non-stream)

Response lengkap (APA ADANYA — hasil probe `qwen3.8-max`, `max_tokens:32`):

```json
{
  "id": "msg_68abf450-e4f6-4c6a-94f2-0bf2ae7963c7",
  "type": "message",
  "role": "assistant",
  "model": "qwen3.8-max",
  "content": [
    { "type": "thinking", "signature": "", "thinking": "We need respond to user \"hi\". Need analysis in same language as user's request: user English. Need final brief greeting." },
    { "type": "text", "text": "Hi! How" }
  ],
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 62,
    "output_tokens": 34,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "prompt_tokens_details": { "cached_tokens": 0 }
  }
}
```

Poin penting:

- **`model`** meng-echo kembali nama model persis seperti di request
  (`qwen3.8-max`, bukan diganti nama lain).
- **`content[]`** bisa berisi lebih dari satu block. Model reasoning (qwen /
  deepseek) mengirim *paling depan* satu block `type:"thinking"` (dengan field
  `signature`) lalu satu block `type:"text"`; block teks itulah jawaban final.
- **`stop_reason`**: `"end_turn"` saat model selesai natural, atau
  `"max_tokens"` saat output terpotong oleh batas. `stop_sequence` selalu
  `null` bila tidak memakai `stop_sequences`.
- **`usage`** memakai nama model-Aliyun:

  | Field                        | Arti                                   |
  |------------------------------|----------------------------------------|
  | `input_tokens`               | token prompt (baca)                    |
  | `output_tokens`              | token generasi (tulis)                 |
  | `cache_creation_input_tokens`| token prompt yang di-cache (0 saat belum kebagian cache) |
  | `cache_read_input_tokens`    | token prompt yang dibaca dari cache    |
  | `prompt_tokens_details.cached_tokens` | jumlah token ter-cache (redundan dgn `cache_read_input_tokens`) |

  Tidak ada field `total_tokens` (tidak seperti OpenAI). Patch token
  memakai `input_tokens + output_tokens`.

### Response headers (non-stream)

```
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
grpc-encoding: identity
x-envoy-upstream-service-time: 1369
server: istio-envoy
x-request-id: 49d29b4a-cbd2-46c5-aed4-e236a23d7c41
```

Bagian belakang gateway ditulis dalam Go (gRPC/gloo + istio-envoy), bukan
nginx klasik.

## Response shape (stream / SSE)

Saat `stream:true`, gateway mengalirkan **native Anthropic Messages SSE** —
tiap blok diawali `event:<nama>` lalu satu baris `data:{json}` (tanpa spasi
setelah `data:`), dipisah blank line. Content-type-nya
`text/event-stream; charset=utf-8` (+ `cache-control: no-cache`).

Urutan event SSE terekam untuk `qwen3.8-max` adalah sebagai berikut
(baris mentah dari probe — `data:` diregang agar terbaca):

```
event:ping
data:{"type":"ping"}

event:message_start
data:{"type":"message_start","message":{"id":"msg_ed6bc3df-...","type":"message",
     "role":"assistant","model":"qwen3.8-max","content":[],"stop_reason":null,
     "stop_sequence":null,"usage":{"input_tokens":2,"output_tokens":0}}}

event:content_block_start
data:{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event:content_block_delta
data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"We"}}

event:content_block_delta
data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" need to respond to"}}

event:content_block_delta
data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" user \"Say ok\". Need"}}

event:content_block_delta
data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" final answer ok."}}

event:content_block_delta
data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" Simple.\n"}}

event:content_block_delta
data:{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":""}}

event:content_block_stop
data:{"type":"content_block_stop","index":0}

event:content_block_start
data:{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event:content_block_delta
data:{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ok"}}

event:content_block_stop
data:{"type":"content_block_stop","index":1}

event:message_delta
data:{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},
     "usage":{"input_tokens":63,"output_tokens":23,"cache_creation_input_tokens":0,
              "cache_read_input_tokens":0,"prompt_tokens_details":{"cached_tokens":0}}}

event:message_stop
data:{"type":"message_stop"}
```

Urutan kanoniknya:

```
ping
  → message_start            (message.usage hanya berisi input_tokens & output_tokens)
  → content_block_start      (index 0, block thinking)
  → content_block_delta      (thinking_delta … berulang per chunk)
  → content_block_delta      (signature_delta — penutup blok thinking)
  → content_block_stop       (index 0)
  → content_block_start      (index 1, block text)
  → content_block_delta      (text_delta … berulang per chunk jawaban)
  → content_block_stop       (index 1)
  → message_delta            (delta.stop_reason = "end_turn"; usage LENGKAP termasuk
                              cache_creation_input_tokens / cache_read_input_tokens /
                              prompt_tokens_details)
  → message_stop
```

Catatan penting untuk parser:

- **`message_start`** membawa `usage` **minimal** (`input_tokens`,
  `output_tokens`) — field cache belum ada di sini.
- **`message_delta`** (event terminal, setelah `content_block_stop` terakhir)
  membawa `usage` **lengkap** (termasuk `cache_creation_input_tokens`,
  `cache_read_input_tokens`, `prompt_tokens_details.cached_tokens`). Inilah
  angka final yang tepat dipakai untuk akumulasi cost.
- **`message_stop`** selalu jadi event penutup; tanda selesai stream adalah
  message_stop (bukan EOF mentah).
- Event `ping` dikirim di awal; abaikan aman.
- `thinking` block: bila klien tidak mau memakai EOT (extended thinking) /
  reasoning, filter blok `type:"thinking"` dan hanya render blok `type:"text"`.
  `signature` dipakai untuk verifikasi EOT (cost to human) — klien wajib
  meneruskannya ke Anthropic bernilai non-kosong bila memakai thinking.

## Error shape

Kesalahan dibungkus **bukan** di `error.message` ala OpenAI, melainkan envelope
Aliyun/flask-studio:

```json
{ "request_id": "...", "code": "...", "message": "..." }
```

| Kondisi                    | HTTP | `code`            | `message`                                      |
|----------------------------|------|-------------------|-------------------------------------------------|
| API key salah / tidak valid| 401  | `InvalidApiKey`   | `Invalid API-key provided. For details, see: https://www.alibabacloud.com/help/en/model-studio/error-code#apikey-error` |
| Nama model tidak dikenal   | 400  | `InvalidParameter`| `Model not exist.`                              |

Contoh nyata 401:

```json
{
  "request_id": "20a7caee-94d2-4834-8f37-86f5e4dd26fc",
  "code": "InvalidApiKey",
  "message": "Invalid API-key provided. For details, see: https://www.alibabacloud.com/help/en/model-studio/error-code#apikey-error"
}
```

Contoh nyata 400 (model tidak ada):

```json
{
  "request_id": "a34a0eab-771a-4bfe-af86-47cb11f34773",
  "code": "InvalidParameter",
  "message": "Model not exist."
}
```

Untuk deteksi salah kredensial, pakai HTTP status (`401`) atau
`code == "InvalidApiKey"`; untuk jeda sementara pakai `429`; untuk
`5xx` terapkan cooldown.

## Cakupan format

QwenCloud mengekspos **satu endpoint native Anthropic-Messages**
(`/v1/messages`), dan transform module memaksa `stream:true` ke upstream,
jadi upstream selalu mengembalikan **native Anthropic Messages SSE**. Cakupan
per format klien:

| Format klien  | Stream  | Perilaku                                                                    |
|---------------|---------|-----------------------------------------------------------------------------|
| `anthropic`   | ya      | Passthrough upstream Anthropic SSE (usage tee)                              |
| `anthropic`   | non     | `aggregateAnthropicSSE` → response `message` JSON                           |
| `openai`      | non     | `bodyOpenAIToAnthropic` → `aggregateAnthropicSSE` → `responseAnthropicToOpenAI` |
| `openai`      | **ya**  | **DITOLAK (501)** — tidak ada konverter Anthropic-SSE → OpenAI-SSE          |

OpenAI **streaming ditolak dengan 501** karena belum ada assembler yang
menerjemahkan Anthropic SSE (thinking/text blocks) ke OpenAI SSE delta.

## Konversi ke/modul router

Karena bentuknya Anthropic-native, `qwencloud` tidak butuh assembler
konversi SSE seperti provider OpenAI (lihat `codebuddy/stream-convert` pada
provider lain) — event di atas bisa diteruskan hampir verbatim ke klien
Anthropic, cukup dikelola index block `thinking` vs `text`.