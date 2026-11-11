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
| 浮水印 | 預設**不加**（`watermark: false`），圖片每張 6 積分（5 + 去除浮水印 1）；設為 `true` 為每張 5 積分 |
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
    "per_image": { "without_watermark": 6, "with_watermark": 5 },
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
    "per_image": { "without_watermark": 6, "with_watermark": 5 },
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
{ "job_id": "0b7a4f0e-5d0c-4c58-9d0e-2f6b3a1c9e11", "status": "queued", "credits_charged": 12 }
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
{ "job_id": "a3e0c2d4-91b7-4c1f-b0aa-64c6d0f5e7a2", "status": "queued", "credits_charged": 24 }
```

### GET /api/v1/partner/jobs/:id

只能查到同一個帳號建立的任務，其他一律 `404`。建立任務時有帶 `owner_ref` 的，查詢時必須帶同一個 `?owner_ref=`，沒帶或不符也是 `404`。回傳多了 `owner_ref`（沒有就是 `null`）與 `character_ids`（沒有就是空陣列）。建議每 3–5 秒查一次；圖片約 1–3 分鐘，影片約 2–10 分鐘。

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
  "credits_charged": 12,
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
  "credits_charged": 6,
  "credits_refunded": 6,
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
{ "error": "積分不足：需要 12，目前 5。", "code": "insufficient_credits" }
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
| 400 | `consent_required` | 建立角色時沒有 `consent: true` |
| 400 | `nsfw_not_allowed_with_characters` | 帶了 `character_ids` 又帶 `nsfw: true` |
| 403 | `character_disabled` | 角色已被管理員停用 |
| 404 | `not_found` | 任務或角色不存在、不屬於這個帳號、`owner_ref` 不符，或端點不存在 |
| 409 | `four_views_in_progress` | 角色的四視圖還在生成（重做四視圖或刪除角色時） |
| 409 | `embed_session_open` | 這個 `owner_ref` 還有未結算的嵌入工作階段 |
| 409 | `embed_settle_in_progress` | 嵌入工作階段正在結算 |
| 409 | `character_limit_reached` | 這個 `owner_ref` 的角色已達 50 個 |
| 409 | `character_not_ready` | 角色沒有可用的參考圖 |
| 413 | `file_too_large` | 上傳檔案超過 10 MB |
| 415 | `unsupported_file_type` | 上傳的檔案實際內容不是 JPG／PNG／WEBP |
| 422 | `invalid_image` | 檔頭像圖片但無法解碼，或像素過大 |
| 422 | `image_too_small` | 上傳的圖片短邊小於 256 像素 |
| 409 | `idempotency_key_conflict` | 同一個 Idempotency-Key 用在內容不同的請求 |
| 422 | `image_download_failed` | 圖片下載不到、會轉址、不是圖片或超過 25MB |
| 429 | `rate_limited` | 超過每分鐘請求數，或驗證失敗次數過多 |
| 429 | `daily_limit_reached` | 超過後台為這個權杖設定的每日上限 |
| 502 | `image_download_failed` | 取得參考圖時發生非預期錯誤 |
| 503 | `storage_unavailable` | CDN 尚未設定，暫時無法受理 |
| 500 | `internal_error` | 伺服器錯誤；已扣的積分會退回 |

任務層級的 `code`（出現在 `GET /jobs/:id`）：`content_rejected`（未通過安全審查）、`generation_timeout`（逾時）、`generation_failed`（其他生成失敗）、`planning_failed`（寫真套圖規劃失敗）、`storage_failed`（已生成但轉存失敗，這種情況**不會自動退點**，請聯絡管理員）。

## AI 角色（依 owner_ref 分開）

客戶小鎮的每個工作區可以建立自己的 AI 角色，之後生圖、生影片、寫真套圖都能指定使用。所有工作區共用同一個服務帳號，所以**每個角色端點都要帶 `owner_ref`**（工作區代號）。

### 數字一覽

| 項目 | 值 |
|---|---|
| 上傳單檔上限 | **10 MB** |
| 上傳支援格式 | **JPG、PNG、WEBP**（以檔案實際內容判斷，不看副檔名或宣告的類型） |
| 上傳圖片最小尺寸 | 短邊 256 像素 |
| 上傳頻率 | 每個 `owner_ref` 每分鐘 30 次（另受權杖每分鐘次數限制） |
| 角色參考圖張數 | **最少 3 張，最多 30 張** |
| 每個 `owner_ref` 的角色數 | 最多 50 個，各 `owner_ref` 各自計算 |
| 一次請求可帶的角色 | 圖片、寫真套圖最多 3 個；影片 1 個 |
| 每個角色帶入的參考圖 | 最多 4 張：有四視圖用四視圖（正面第一張），沒有就用前幾張參考圖 |
| 四視圖費用 | 20 積分（4 張 × 5） |
| 建立、修改、刪除角色，上傳照片 | 不收費 |
| `owner_ref` 格式 | 1–100 個字元，英數與符號，不可有空白或中文 |

### 隔離規則

- 角色只屬於建立它的 `owner_ref`。查詢、修改、刪除、做四視圖、用來生成時，`owner_ref` 不符一律回 `404`，內容與「角色不存在」完全相同，無法分辨。
- 另一個服務帳號即使用同一個 `owner_ref` 也拿不到。
- 上傳的照片依 `owner_ref` 存在不同資料夾；網址裡不會出現 `owner_ref` 本身。

`owner_ref` 不符時的回應（所有角色端點與帶角色的生成端點都一樣）：

```json
HTTP/1.1 404 Not Found
{ "error": "找不到這個角色。", "code": "not_found" }
```

### POST /api/v1/partner/uploads

把客戶上傳的照片交給本站保存，回傳可直接當作參考圖的網址。`multipart/form-data`，欄位 `file` 與 `owner_ref`。

儲存前會：確認檔案內容真的是 JPG／PNG／WEBP、套用拍攝方向後重新編碼，並**移除 EXIF 等全部中繼資料（含拍攝位置）**。

```bash
curl -X POST https://你的網域/api/v1/partner/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -F "owner_ref=ws_12" -F "file=@photo.jpg"
```

```json
HTTP/1.1 201 Created
{ "url": "https://cdn.你的網域/partner/u/…/o/…/uploads/7f0c….jpg", "width": 1536, "height": 2048 }
```

檔案不是圖片（例如把 HTML 改名成 .jpg）：

```json
HTTP/1.1 415 Unsupported Media Type
{ "error": "只接受 JPG、PNG、WEBP 圖片（以檔案實際內容判斷，不看副檔名）。", "code": "unsupported_file_type" }
```

超過大小：

```json
HTTP/1.1 413 Payload Too Large
{ "error": "檔案過大：單檔上限 10 MB。", "code": "file_too_large" }
```

### POST /api/v1/partner/characters

| 欄位 | 必填 | 說明 |
|---|---|---|
| `owner_ref` | 是 | 工作區代號 |
| `name` | 是 | 最多 60 字 |
| `description` | 否 | 外貌描述，最多 1000 字；會用在四視圖 |
| `style_hint` | 否 | 風格，例如「寫實」「日系」，最多 200 字 |
| `reference_image_urls` | 是 | 3–30 張 https 網址。用 `/uploads` 回傳的網址會直接沿用；其他網址會下載後另存一份 |
| `consent` | 是 | 必須是 `true`：代表已向客戶確認「照片中的人是本人或已取得本人同意」。本站會記下同意時間與 `owner_ref` |

```bash
curl -X POST https://你的網域/api/v1/partner/characters \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"owner_ref":"ws_12","name":"小雨","description":"二十多歲，黑長髮","style_hint":"寫實","reference_image_urls":["https://cdn…/a.jpg","https://cdn…/b.jpg","https://cdn…/c.jpg"],"consent":true}'
```

```json
HTTP/1.1 201 Created
{
  "id": "4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10",
  "owner_ref": "ws_12",
  "name": "小雨",
  "description": "二十多歲，黑長髮",
  "style_hint": "寫實",
  "reference_image_urls": ["https://cdn…/a.jpg", "https://cdn…/b.jpg", "https://cdn…/c.jpg"],
  "four_view_urls": [],
  "four_views": { "front": null, "three_quarter": null, "side": null, "back": null },
  "four_view_status": "idle",
  "disabled": false,
  "created_at": "2026-11-11T08:00:00.000Z"
}
```

`four_view_urls` 依序是正面、3/4 側、側面、背面，只列出已經有的；要知道哪張是哪個角度請看 `four_views`。`four_view_status` 為 `idle`／`generating`／`completed`／`failed`。`disabled` 為 `true` 表示已被管理員停用。

沒有同意：

```json
HTTP/1.1 400 Bad Request
{ "error": "建立角色前必須確認肖像同意：請在向客戶確認「照片中的人是本人或已取得本人同意」後傳入 consent: true。", "code": "consent_required" }
```

### GET /api/v1/partner/characters?owner_ref=...

```bash
curl "https://你的網域/api/v1/partner/characters?owner_ref=ws_12" -H "Authorization: Bearer $TOKEN"
```

```json
{ "characters": [ { "id": "4c9d2a6e-…", "owner_ref": "ws_12", "name": "小雨", "…": "同上" } ], "count": 1, "limit": 50 }
```

### GET /api/v1/partner/characters/:id?owner_ref=...

```bash
curl "https://你的網域/api/v1/partner/characters/4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10?owner_ref=ws_12" -H "Authorization: Bearer $TOKEN"
```

回傳一個角色（格式同建立）。用別的工作區代號查：

```bash
curl "https://你的網域/api/v1/partner/characters/4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10?owner_ref=ws_99" -H "Authorization: Bearer $TOKEN"
```

```json
HTTP/1.1 404 Not Found
{ "error": "找不到這個角色。", "code": "not_found" }
```

### PATCH /api/v1/partner/characters/:id

`owner_ref` 必填，其餘都是選填：`name`、`description`、`style_hint`、`add_reference_image_urls`（要加入的網址）、`remove_reference_image_urls`（要移除的網址，需與角色現有的網址完全相同）。修改後參考圖仍須是 3–30 張，否則回 `400` 且不做任何變更。被移除的照片會從 CDN 刪除。

```bash
curl -X PATCH https://你的網域/api/v1/partner/characters/4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"owner_ref":"ws_12","name":"小雨（新）","add_reference_image_urls":["https://cdn…/d.jpg"],"remove_reference_image_urls":["https://cdn…/c.jpg"]}'
```

回傳修改後的角色。`owner_ref` 不符回上面的 `404`。

### DELETE /api/v1/partner/characters/:id?owner_ref=...

刪除角色，並同時刪除它在 CDN 上的參考圖與四視圖。同一個工作區的其他角色還在用的照片會保留。

```bash
curl -X DELETE "https://你的網域/api/v1/partner/characters/4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10?owner_ref=ws_12" -H "Authorization: Bearer $TOKEN"
```

```json
{ "id": "4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10", "deleted": true, "files_deleted": 7, "files_failed": 0 }
```

`files_failed` 大於 0 表示有檔案沒刪成功（角色本身已刪除），請通知管理員手動清除。四視圖還在生成時會回 `409 four_views_in_progress`，請等任務結束再刪。已經用這個角色生成出來的成品不會被刪除。

### POST /api/v1/partner/characters/:id/four-views

用角色的參考圖生成正面、3/4 側、側面、背面四張全身圖，行為與本站角色庫相同。非同步，扣 20 積分，失敗的張數自動退點。支援 `Idempotency-Key`。

```bash
curl -X POST https://你的網域/api/v1/partner/characters/4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10/four-views \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"owner_ref":"ws_12"}'
```

```json
HTTP/1.1 202 Accepted
{ "job_id": "9a1b7c3d-5e2f-4a60-8b91-0c2d3e4f5a6b", "status": "queued", "credits_charged": 20 }
```

查任務要帶同一個 `owner_ref`：

```bash
curl "https://你的網域/api/v1/partner/jobs/9a1b7c3d-5e2f-4a60-8b91-0c2d3e4f5a6b?owner_ref=ws_12" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "job_id": "9a1b7c3d-5e2f-4a60-8b91-0c2d3e4f5a6b",
  "type": "four_views",
  "status": "succeeded",
  "results": [
    { "url": "https://cdn…/front.jpg", "type": "image", "width": 1440, "height": 2560 },
    { "url": "https://cdn…/three-quarter.jpg", "type": "image", "width": 1440, "height": 2560 },
    { "url": "https://cdn…/side.jpg", "type": "image", "width": 1440, "height": 2560 },
    { "url": "https://cdn…/back.jpg", "type": "image", "width": 1440, "height": 2560 }
  ],
  "credits_charged": 20,
  "credits_refunded": 0,
  "external_ref": null,
  "owner_ref": "ws_12",
  "character_ids": ["4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10"],
  "error": null,
  "code": null,
  "created_at": "2026-11-11T08:05:00.000Z",
  "finished_at": "2026-11-11T08:07:10.000Z"
}
```

完成後角色的 `four_view_urls` 會自動帶上這四張。

### 生成時使用角色

`/images`、`/videos`、`/photosets` 都多接受兩個欄位：

| 欄位 | 說明 |
|---|---|
| `owner_ref` | 工作區代號。有帶 `character_ids` 時必填；沒帶角色時可省略（舊的呼叫方式不受影響） |
| `character_ids` | 角色代號陣列。圖片與寫真套圖 0–3 個，影片 0–1 個 |

- 角色的參考圖排在最前面（有四視圖用四視圖、正面第一張），你另外給的 `reference_image_urls` 排在後面。圖片合計最多 10 張、寫真套圖最多 9 張；塞不下時回 `400`。
- 提示詞後面會自動加一句說明「第幾張參考圖是哪個角色，請保持同一個人」。
- `character_ids` 裡只要有一個不屬於該 `owner_ref`，整個請求回 `404`，不生成、不扣點。
- 角色被停用時回 `403 character_disabled`，不扣點。
- **帶角色時一律不套用 NSFW 提示詞強化**；同時帶 `nsfw: true` 會回 `400 nsfw_not_allowed_with_characters`。
- 寫真套圖 `mode: "character"` 有帶 `character_ids` 時，可以不給 `reference_image_urls`。
- 影片：模型只接受一張首幀，所以只能帶一個角色，且必須是 `image-to-video`。沒給 `image_url` 時用角色的正面圖當首幀；有給 `image_url` 時以它為首幀，角色只記錄在任務上。`text-to-video` 無法帶入角色，會回 `400`。

圖片：

```bash
curl -X POST https://你的網域/api/v1/partner/images \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Idempotency-Key: post_88-cover" \
  -d '{"prompt":"咖啡廳窗邊，午後陽光","owner_ref":"ws_12","character_ids":["4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10"],"size":"1776x2368"}'
```

```json
HTTP/1.1 202 Accepted
{ "job_id": "0b7a4f0e-5d0c-4c58-9d0e-2f6b3a1c9e11", "status": "queued", "credits_charged": 6 }
```

影片：

```bash
curl -X POST https://你的網域/api/v1/partner/videos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"image-to-video","prompt":"轉頭對鏡頭微笑","duration":5,"quality":"720p","owner_ref":"ws_12","character_ids":["4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10"]}'
```

```json
HTTP/1.1 202 Accepted
{ "job_id": "5f1d7b9a-2a53-4a0e-8a11-7b1f0f6f2c33", "status": "queued", "credits_charged": 40 }
```

寫真套圖：

```bash
curl -X POST https://你的網域/api/v1/partner/photosets \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"character","owner_ref":"ws_12","character_ids":["4c9d2a6e-0f51-4e0b-9b7e-2d1f6a3b8c10"],"count":4}'
```

```json
HTTP/1.1 202 Accepted
{ "job_id": "a3e0c2d4-91b7-4c1f-b0aa-64c6d0f5e7a2", "status": "queued", "credits_charged": 24 }
```

用了別的工作區的角色（三個端點相同）：

```json
HTTP/1.1 404 Not Found
{ "error": "找不到這個角色。", "code": "not_found" }
```

查這些任務時沒帶或帶錯 `owner_ref`：

```json
HTTP/1.1 404 Not Found
{ "error": "找不到這個任務。", "code": "not_found" }
```

### 肖像下架（管理員）

除了對方自己呼叫 DELETE，管理員可以在「後台 → 對外 API → 對外 API 的 AI 角色」依 `owner_ref` 或角色代號搜尋，停用單一角色，或一次停用某個工作區的全部角色。停用後不能再用來生成或做四視圖；資料與圖片保留，重新啟用即可恢復。對方查詢時會看到 `"disabled": true`。

## 嵌入模式：讓工作區直接使用本站的完整介面

適合不想自己重做一套畫面的進階功能（修圖、漫劇、素材庫等）。對方後端替某個工作區建立一個「嵌入工作階段」，拿到一次性的進入網址，在使用者的瀏覽器用新視窗開啟；使用者就以該工作區專屬的子帳號登入本站，看不到其他工作區的任何東西。

| 項目 | 行為 |
|---|---|
| 隔離 | 每個 `owner_ref` 對應一個子帳號，作品、角色庫、作品庫都各自獨立。子帳號沒有密碼，只能經由進入網址登入 |
| 額度 | 建立時把 `budget` 積分從服務帳號撥到子帳號；使用者在本站的所有花費都扣這筆額度，用完就不能再生成 |
| 結算 | 呼叫結算後，剩下的積分撥回服務帳號，回傳 `spent`（= `budget` − 剩餘）。向客戶收費請以 `spent` 為準 |
| 遲到的退點 | 結算後才完成的失敗退點會留在子帳號，下一次建立工作階段時收回，並在回應的 `recovered_credits` 告知，請退還給客戶 |
| 一次一個 | 同一個 `owner_ref` 同時只能有一個未結算的工作階段，否則回 `409 embed_session_open`（附 `session_id`） |
| 進入網址 | 10 分鐘內有效、只能用一次。請用 `window.open` 開新視窗，不要用 iframe（本站登入使用第一方 cookie） |
| 成人內容 | 預設關閉。由對方平台在建立工作階段時帶 `adult_birth_date` 為個別工作區開啟；每次建立都會重設，所以對方關掉後下一次就失效。工作區自己不能在本站開啟 |
| 限制 | 嵌入模式不能儲值、不能改帳號與成人內容設定、不能進後台；客服對話與安裝提示不顯示。網站的每日上限（圖 50、影片 10）以子帳號計 |
| 送回成品 | 使用者在本站按「挑成品送回小鎮」，本站對開啟它的視窗送出 `postMessage`，目標來源限定為建立時的 `return_origin` |

### POST /api/v1/partner/embed-sessions

| 欄位 | 必填 | 說明 |
|---|---|---|
| `owner_ref` | 是 | 工作區代號 |
| `budget` | 是 | 這次最多可花的積分，1–100000 |
| `return_origin` | 是 | 你們網站的來源，例如 `https://town.example.com`。必須是 https |
| `adult_birth_date` | 否 | 該工作區負責人的生日（`YYYY-MM-DD`）。有帶就代表對方已確認此人年滿 18 歲並同意成人內容條款，這次工作階段可使用成人提示詞；沒帶則關閉。需權杖已開放 NSFW，否則回 `403 nsfw_not_allowed`；未滿 18 歲回 `400` |

```bash
curl -X POST https://你的網域/api/v1/partner/embed-sessions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"owner_ref":"ws_12","budget":200,"return_origin":"https://town.example.com"}'
```

```json
HTTP/1.1 201 Created
{
  "session_id": "6f0e…", "owner_ref": "ws_12", "status": "open", "budget": 200, "spent": null,
  "url": "https://你的網域/embed/enter?ticket=…",
  "recovered_credits": 0,
  "ticket_expires_at": "2026-11-11T08:10:00.000Z",
  "created_at": "2026-11-11T08:00:00.000Z", "settled_at": null
}
```

服務帳號積分不足回 `402 insufficient_credits`，不會建立。

### GET /api/v1/partner/embed-sessions/:id?owner_ref=...

回傳狀態與目前剩餘額度（`remaining`）。`owner_ref` 不符回 `404`。

### POST /api/v1/partner/embed-sessions/:id/settle

內容：`{ "owner_ref": "ws_12" }`。可重複呼叫，結果相同。

```json
{ "session_id": "6f0e…", "owner_ref": "ws_12", "status": "settled", "budget": 200, "spent": 46, "remaining": 0, "created_at": "…", "settled_at": "…" }
```

另一個結算正在進行時回 `409 embed_settle_in_progress`（帶 `Retry-After`）。

### 接收送回的成品

在開啟視窗的那一頁監聽：

```js
window.addEventListener("message", (e) => {
  if (e.origin !== "https://你的網域" || e.data?.source !== "ai-studio") return;
  if (e.data.type === "pick") useMedia(e.data.url);   // 成品的永久 CDN 網址
  if (e.data.type === "done") settleSession();        // 使用者按了「完成」
});
```

使用者也可能直接關掉視窗而沒有按「完成」，請在他回到你們頁面時、或一段時間後主動結算。

第一次使用前要再執行一次 `npm run db:push`（新增 `partner_embed_sessions`）。

## 後台操作：建立與撤銷權杖

前置：第一次使用前要建立兩張新資料表。在 Replit 的 Shell 執行：

```bash
npm run db:push
```

這會新增 `partner_tokens`、`partner_jobs`、`partner_characters`，並在 `partner_jobs` 加上 `owner_ref`、`character_ids` 兩個欄位；不會更動其他既有資料表。加入 AI 角色功能後需要再執行一次。

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
