# QwenCloud (Aliyun token-plan) Authentication

`qwencloud` memakai **satu API key panjang (long-lived)** dari dasbor Aliyun
Model Studio — tepatnya dari halaman **token-plan** ("token-plan" adalah nama
aplikasi/scenario di Aliyun `maaas`/Model Studio tempat key ini dibuat).
Tidak ada OAuth, tidak ada rotasi token jangka pendek. Key dikirim sebagai
**Bearer token** pada setiap request:

```
Authorization: Bearer <api_key>
```

## Getting a key

1. Buka dasbor Model Studio Aliyun dan masuk ke area **token-plan**
   (scenario/applicational-scenario `maas`).
2. Buat API key baru; nilainya ditampilkan hanya sekali saat pembuatan.
3. Copy nilai tersebut. Di dokumentasi ini ditulis `sk-sp-...` — key asli
   ber-prefix **`sk-sp-`**.

Key `qwencloud` memakai kredit **token-plan** (`credit_type` diisi
`token-plan`, bukan `payg`). Penggunaannya dihitung dari paket token-plan,
bukan bayar-per-token publik.

## Storage

Disimpan di baris `accounts` yang sudah ada dengan `provider='qwencloud'`.
Tidak ada kolom baru karena key panjang muat di `accounts.api_key`.

```ini
label       = "qwencloud-1"        # atau nama pilihan user
api_key     = "sk-sp-..."          # key asli ber-prefix sk-sp-
provider    = 'qwencloud'
credit_type = 'token-plan'         # billing token-plan (bukan payg)
enabled     = 1
base_url    = null                 # fallback ke default di module
```

## Apakah `anthropic-version` header wajib?

Saat probe, request **tanpa** header `anthropic-version` tetap membalas
`200 OK` dengan response valid penuh:

```
curl ... -X POST <endpoint> \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-max","max_tokens":32,"messages":[{"role":"user","content":"hi"}]}'
# → 200 OK, body Anthropic Messages lengkap
```

Jadi `anthropic-version: 2023-06-01` **tidak wajib** secara fungsional; gateway
tidak me-mandatkannya. Meski begitu, tetap **disarankan** mengirimnya (nilai
`2023-06-01`) demi kompatibilitas forward bila Aliyun menegakkannya kelak dan
agar perilaku mirip Anthropic resmi. Header tambahan yang relevan:
`Content-Type: application/json`, dan untuk stream `Accept: text/event-stream`.

## CLI (skema usulan)

```bash
# Tambah akun + seed model bawaan
npm run add-account -- --provider qwencloud --api-key sk-sp-... --label qwencloud-1

# Dengan gateway privat
npm run add-account -- --provider qwencloud --api-key sk-sp-... \
  --label qwencloud-private --base-url https://my-gateway.example/qwencloud

# Re-seed katalog model (upsert idempotent)
npm run seed-qwencloud-models
```

## Dashboard

Halaman Accounts (`client/src/pages/Accounts.tsx`) umumnya merender kartu per
provider; untuk `qwencloud`, "Add" lalu paste key `sk-sp-...` dan simpan.
Katalog model di-seed otomatis saat simpan (lihat `docs/qwencloud/wire-format.md`
untuk 3 model valid). Page Models menampilkan katalog di bawah seksi
"QwenCloud"/"Aliyun".

## Quota / billing model

`qwencloud` ditarik dari paket **token-plan** Aliyun — `credit_type='token-plan'`
pada baris accounts (bukan `payg`). Router menyimpan `pricing_input` /
`pricing_output` / `pricing_cache_read` di setiap baris `models` memakai
**harga resmi token-plan Aliyun per 1M token** (dikonfirmasi user):

| Model id                 | Context in | Context out | Input $/M | Output $/M |
|--------------------------|-----------:|------------:|----------:|-----------:|
| `qwen3.8-max`            | 1M         | 128K        | $2.00     | $6.00      |
| `deepseek-v4-flash-0731` | 1M         | 128K        | $0.44     | $1.32      |
| `deepseek-v4-pro-0813`   | 1M         | 128K        | $1.32     | $3.96      |

Cache leg tidak dipublikasikan sehingga `pricing_cache_read` = 0. Prabayar
(token-plan) dipakai dari saldo paket, jadi jumlah tagihan sebenarnya ditentukan
`usage` yang di-echo balik gateway (lihat wire-format untuk nama field
`input_tokens` / `output_tokens` / `cache_*`). Angka otoritatif untuk estimasi
biaya adalah harga per-M di atas; `usage` dari gateway menentukan berapa token
dikalikan dengannya. Billing sepenuhnya upstream; router tidak menegakkan kuota.

## Kesalahan auth

Kalau key salah, gateway membalas `401` dengan envelope Aliyun:

```json
{
  "request_id": "...",
  "code": "InvalidApiKey",
  "message": "Invalid API-key provided. For details, see: https://www.alibabacloud.com/help/en/model-studio/error-code#apikey-error"
}
```

Deteksi gagal-auth pakai HTTP `401` atau `code == "InvalidApiKey"`.