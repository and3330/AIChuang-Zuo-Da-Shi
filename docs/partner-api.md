# 對外服務 API（Partner API）

給其他系統的**後端**呼叫，用服務權杖驗證，不走瀏覽器登入。生成流程與本站相同，只是入口不同。

- 路徑前綴：`/api/v1/partner`
- 驗證：`Authorization: Bearer <權杖>`
- 內容格式：`Content-Type: application/json`
- 全部非同步：建立端點回 `202` 與 `job_id`，再用 `GET /jobs/:id` 查結果
- 錯誤一律是 `{ "error": "中文說明", "code": "英文代碼" }`

下面範例的 `https://你的網域` 請換成本站網址，`$TOKEN` 換成後台建立的權杖。

## 重要行為

| 項目 | 行為 |
|---|---|
| 扣點 | 建立任務時先扣；每個權杖綁定一個帳號，扣那個帳號的積分 |
| 退點 | 失敗的部分自動退回，反映在任務的 `credits_refunded` |
| 浮水印 | 預設**不加**（`watermark: false`），圖片每張 8 積分；設為 `true` 為每張 3 積分 |
| NSFW 提示詞強化 | 預設**不套用**。必須權杖已開放，且該次請求帶 `"nsfw": true` 才會套用 |
| 結果網址 | 一律是已轉存 CDN 的 https 網址，不會回暫時網址 |
| 參考圖／首幀 | 只接受 https 公開網址；不可轉址；必須是圖片且小於 25MB；會先下載並轉存再使用 |
| 每日上限 | 網站的每日上限（圖 50、影片 10）**不適用**；可在後台針對權杖另外設定 |
| 頻率限制 | 每個權杖每分鐘可建立的任務數（預設 60）；查詢類請求為其 10 倍。超過回 `429` 與 `Retry-After` |
| 重送 | 建立端點支援 `Idempotency-Key`：同一個 key 在 24 小時內重送會回同一個 `job_id`，不會重複扣點或生成 |
| 瀏覽器 | 帶 `Origin` 標頭的請求一律拒絕（`403`） |

## 端點

### GET /api/v1/partner/pricing

目前的扣點規則、可用尺寸、姿勢代號、畫面質感，以及這個權杖的限制。建議啟動時讀一次並快取。

```bash
curl https://你的網域/api/v1/partner/pricing -H "Authorization: Bearer $TOKEN"
```

回應（節錄）：

```json
{
  "unit": "credits",
  "images": {
    "per_image": { "without_watermark": 8, "with_watermark": 3 },
    "default_watermark": false,
    "count": { "min": 1, "max": 4 },
    "max_reference_images": 10,
    "sizes": [
      { "size": "1776x2368", "ratio": "3:4", "quality": "2k", "width": 1776, "height": 2368 },
      { "size": "2048x2048", "ratio": "1:1", "quality": "2k", "width": 2048, "height": 2048 }
    ]
  },
  "videos": {
    "per_second": { "720p": 8, "1080p": 15 },
    "duration_seconds": { "min": 4, "max": 12, "default": 5 },
    "ratios": ["16:9", "9:16", "1:1"]
  },
  "photosets": {
    "per_image": { "without_watermark": 8, "with_watermark": 3 },
    "planning": 0,
    "count": { "min": 2, "max": 10 },
    "max_reference_images": 9,
    "quality_styles": [{ "id": "natural", "name": "自然寫實", "description": "相機原片感，保留皮膚紋理（推薦）" }],
    "poses": [{ "id": "stand-relaxed", "category": "站姿", "name": "自然站立", "framing": "全身" }]
  },
  "nsfw_allowed": false,
  "limits": { "requests_per_minute": 60, "read_requests_per_minute": 600, "daily_images": null, "daily_videos": null }
}
```

圖片所有畫質與比例的積分相同；`sizes` 共 24 種（8 種比例 × 2k／1.5k／1k）。

### GET /api/v1/partner/balance

```bash
curl https://你的網域/api/v1/partner/balance -H "Authorization: Bearer $TOKEN"
```

```json
{ "credits": 1000 }
```

### POST /api/v1/partner/images

| 欄位 | 必填 | 說明 |
|---|---|---|
| `prompt` | 是 | 1–4000 字 |
| `size` | 否 | `/pricing` 的 `sizes[].size` 之一，預設 `2048x2048` |
| `reference_image_urls` | 否 | 0–10 個 https 網址。有就走圖生圖，沒有就走文字生圖 |
| `count` | 否 | 1–4，預設 1 |
| `watermark` | 否 | 預設 `false` |
| `nsfw` | 否 | 預設 `false`，需權杖已開放 |
| `external_ref` | 否 | 最長 200 字，原樣存下並在查詢時回傳 |

費用：每張積分 × `count`。

```bash
curl -X POST https://你的網域/api/v1/partner/images \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: ws12-post88-img" \
  -d '{"prompt":"一隻橘貓坐在窗邊，午後陽光","size":"1776x2368","count":2,"external_ref":"ws_12/post_88"}'
```

成功（`202`）：

```json
{ "job_id": "0b7a4f0e-5d0c-4c58-9d0e-2f6b3a1c9e11", "status": "queued", "credits_charged": 16 }
```

### POST /api/v1/partner/videos

| 欄位 | 必填 | 說明 |
|---|---|---|
| `type` | 是 | `image-to-video` 或 `text-to-video` |
| `prompt` | 是 | 1–4000 字 |
| `image_url` | image-to-video 必填 | https 網址，作為首幀。text-to-video 不可帶 |
| `duration` | 否 | 4–12 秒，預設 5 |
| `ratio` | 否 | `16:9`／`9:16`／`1:1`，預設 `16:9`。只對 text-to-video 生效，image-to-video 跟隨首幀比例 |
| `quality` | 否 | `720p` 或 `1080p`，預設 `1080p` |
| `nsfw`、`external_ref` | 否 | 同圖片 |

費用：每秒積分 × `duration`（720p 每秒 8、1080p 每秒 15）。

```bash
curl -X POST https://你的網域/api/v1/partner/videos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"image-to-video","prompt":"人物緩慢轉頭微笑，髮絲被風吹動","image_url":"https://cdn.example.com/first.jpg","duration":5,"quality":"1080p","external_ref":"post_9"}'
```

```json
{ "job_id": "5f1d7b9a-2a53-4a0e-8a11-7b1f0f6f2c33", "status": "queued", "credits_charged": 75 }
```

### POST /api/v1/partner/photosets

後端自己完成「規劃 → 批次生成」，送一次即可。

| 欄位 | 必填 | 說明 |
|---|---|---|
| `mode` | 是 | `scene`（情境寫真）或 `character`（角色九宮格） |
| `scene_image_url` | scene 必填 | https 網址，決定場景與氛圍。character 不可帶 |
| `reference_image_urls` | character 必填 | 最多 9 個 https 網址，決定畫面裡的人物 |
| `quality_style` | 否 | `natural`（預設）／`phone`／`film`／`studio` |
| `poses` | 否 | `/pricing` 的姿勢代號，2–10 個。提供時一個姿勢出一張，張數以姿勢數為準 |
| `count` | 否 | 2–10，預設 6 |
| `size` | 否 | 預設 `1776x2368` |
| `planner` | 否 | 只對 character 有效：`ai`（預設）或 `preset`（固定九宮格，不經 AI，此時忽略 `poses`） |
| `outfit_from` | 否 | scene 且有參考圖時：`character`（預設）或 `scene` |
| `direction` | 否 | 風格方向，最長 500 字 |
| `watermark`、`nsfw`、`external_ref` | 否 | 同圖片 |

費用：每張積分 × 張數，規劃不另外收費。若規劃出的張數少於要求，差額會退回。

```bash
curl -X POST https://你的網域/api/v1/partner/photosets \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"scene","scene_image_url":"https://cdn.example.com/scene.jpg","reference_image_urls":["https://cdn.example.com/model1.jpg"],"quality_style":"natural","count":4,"size":"1776x2368","external_ref":"post_set_1"}'
```

```json
{ "job_id": "a3e0c2d4-91b7-4c1f-b0aa-64c6d0f5e7a2", "status": "queued", "credits_charged": 32 }
```

### GET /api/v1/partner/jobs/:id

只能查到同一個帳號建立的任務，其他一律 `404`。建議每 3–5 秒查一次；圖片約 1–3 分鐘，影片約 2–10 分鐘。

```bash
curl https://你的網域/api/v1/partner/jobs/0b7a4f0e-5d0c-4c58-9d0e-2f6b3a1c9e11 -H "Authorization: Bearer $TOKEN"
```

成功：

```json
{
  "job_id": "0b7a4f0e-5d0c-4c58-9d0e-2f6b3a1c9e11",
  "type": "image",
  "status": "succeeded",
  "results": [
    { "url": "https://cdn.你的網域/users/svc/images/xxxx_0.jpg", "type": "image", "width": 1776, "height": 2368 },
    { "url": "https://cdn.你的網域/users/svc/images/xxxx_1.jpg", "type": "image", "width": 1776, "height": 2368 }
  ],
  "credits_charged": 16,
  "credits_refunded": 0,
  "external_ref": "ws_12/post_88",
  "error": null,
  "code": null,
  "created_at": "2026-11-11T08:00:00.000Z",
  "finished_at": "2026-11-11T08:02:10.000Z"
}
```

任務失敗（HTTP 仍是 `200`，看 `status`）：

```json
{
  "job_id": "7c2e…",
  "type": "image",
  "status": "failed",
  "results": [],
  "credits_charged": 8,
  "credits_refunded": 8,
  "external_ref": null,
  "error": "內容未通過安全審查，請調整提示詞或更換圖片後再試。",
  "code": "content_rejected",
  "created_at": "2026-11-11T08:00:00.000Z",
  "finished_at": "2026-11-11T08:00:40.000Z"
}
```

`status`：

| 值 | 意思 |
|---|---|
| `queued` | 已受理，尚未開始 |
| `processing` | 生成中（寫真套圖的規劃階段也算） |
| `succeeded` | 至少有一筆結果。部分失敗時 `results` 只含成功的，失敗部分的積分在 `credits_refunded` |
| `failed` | 沒有任何結果 |

`type` 為 `image`、`video` 或 `photoset`。`results[].width/height` 是要求的尺寸；image-to-video 的實際比例跟隨首幀，寬高為依 `quality` 與 `ratio` 推算的標稱值。

## 錯誤

驗證失敗（`401`）：

```json
{ "error": "權杖無效或已撤銷。", "code": "unauthorized" }
```

積分不足（`402`，不會扣點、不會建立任務）：

```json
{ "error": "積分不足：需要 16，目前 5。", "code": "insufficient_credits" }
```

輸入有誤（`400`）：

```json
{ "error": "請求內容有誤：size：size 必須是 /pricing 列出的尺寸之一", "code": "invalid_request" }
```

頻率超過（`429`，帶 `Retry-After: 秒數`）：

```json
{ "error": "請求過於頻繁，請稍後再試。", "code": "rate_limited" }
```

| HTTP | code | 何時發生 |
|---|---|---|
| 400 | `invalid_request` | 欄位缺少、格式錯、不支援的欄位、Idempotency-Key 格式不對 |
| 400 | `invalid_image_url` | 圖片網址不是 https、指向內部位址 |
| 401 | `unauthorized` | 沒帶權杖、權杖錯誤或已撤銷 |
| 402 | `insufficient_credits` | 綁定帳號積分不足 |
| 403 | `browser_requests_not_allowed` | 請求帶 `Origin` 標頭 |
| 403 | `nsfw_not_allowed` | 請求帶 `nsfw: true` 但權杖未開放 |
| 403 | `account_unavailable` | 權杖綁定的帳號不存在 |
| 404 | `not_found` | 任務不存在、不屬於這個帳號，或端點不存在 |
| 409 | `idempotency_key_conflict` | 同一個 Idempotency-Key 用在內容不同的請求 |
| 422 | `image_download_failed` | 圖片下載不到、會轉址、不是圖片或超過 25MB |
| 429 | `rate_limited` | 超過每分鐘請求數，或驗證失敗次數過多 |
| 429 | `daily_limit_reached` | 超過後台為這個權杖設定的每日上限 |
| 502 | `image_download_failed` | 取得參考圖時發生非預期錯誤 |
| 503 | `storage_unavailable` | CDN 尚未設定，暫時無法受理 |
| 500 | `internal_error` | 伺服器錯誤；已扣的積分會退回 |

任務層級的 `code`（出現在 `GET /jobs/:id`）：`content_rejected`（未通過安全審查）、`generation_timeout`（逾時）、`generation_failed`（其他生成失敗）、`planning_failed`（寫真套圖規劃失敗）、`storage_failed`（已生成但轉存失敗，這種情況**不會自動退點**，請聯絡管理員）。

## 後台操作：建立與撤銷權杖

前置：第一次使用前要建立兩張新資料表。在 Replit 的 Shell 執行：

```bash
npm run db:push
```

這只會新增 `partner_tokens` 與 `partner_jobs`，不會更動既有資料表。

建立：

1. 用管理員帳號登入，進入「後台」。
2. 點上方的「對外 API」分頁。
3. 填「權杖名稱」，選「綁定帳號」（建議為對方系統另開一個專用帳號並儲值）。
4. 視需要調整每分鐘任務數、每日圖片／影片上限（留空為不限制）。
5. 「允許 NSFW 提示詞強化」預設不勾；成品要發到公開社群的用途請保持不勾。
6. 按「建立權杖」。黃色區塊會顯示權杖全文，**只顯示這一次**，請立刻複製給對方存入機密設定。

撤銷：

1. 同一個分頁的「現有權杖」列表找到該權杖。
2. 按右側「撤銷」並確認。撤銷立即生效，無法復原；要恢復只能建立新的權杖。

調整：在列表點「限制」欄的數字可修改；點 NSFW 欄的標籤可開關。

## 給串接方的建議

- 權杖只放在後端的機密設定，不要放進前端或版本庫。
- 每個建立請求都帶 `Idempotency-Key`（例如「貼文代號＋用途」），逾時重送就不會重複扣點。
- 向客戶收費時以 `credits_charged − credits_refunded` 為準，並等任務到 `succeeded` 或 `failed` 再結算。
- `results[].url` 是永久網址，可直接使用，也可以自行下載另存。
