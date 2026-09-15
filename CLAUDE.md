# TTS AU — Desktop Text-to-Speech Batch Tool

## 1. Mục tiêu dự án

Xây dựng một desktop app tạo audio (Text-to-Speech) bằng cách gọi API của
[GenVoice](https://genvoice.pro) — dịch vụ bán credit cho phép gọi TTS qua
nhiều backend (ElevenLabs, MiniMax, CapCut...). App được thiết kế lại dựa trên
app tham khảo **"Dani Media Auto TTS Subtitles (evlabs) 5.10"** (Windows
WinForms) nhưng build mới hoàn toàn bằng **Electron + React + TypeScript** để
chạy được trên macOS (máy dev hiện tại) và Windows.

Đây không phải là port 1:1 — ta giữ lại đúng workflow (chọn giọng → batch job
→ tạo audio hàng loạt → ghép file → xuất SRT) nhưng xây trên stack hiện đại.

## 2. GenVoice API — đã xác nhận bằng request thật

Trang `https://genvoice.pro/docs` là SPA (React) chỉ hiển thị đầy đủ khi có
JS render + login, nên không lấy được bằng cách fetch HTML thông thường. Đã
xác nhận toàn bộ thông tin dưới đây bằng cách gọi thật vào API với API key
của user (kể cả 1 request `POST text-to-speech` thật để lấy đúng schema —
đã trừ 28 credit trong tổng ~301,000 credit).

### 2.1 Kết nối & xác thực (CONFIRMED)
- **Base URL:** `https://api.genvoice.pro`
- **Auth header:** `xi-api-key: <API_KEY>` (đúng tên header của ElevenLabs
  gốc — GenVoice giữ nguyên convention này).
- **Rate limit:** có header `x-ratelimit-limit` / `x-ratelimit-remaining` /
  `x-ratelimit-reset` trên mọi response (quan sát được limit ~2000, reset
  tính theo giây — cần theo dõi thực tế thêm, không hard-code con số này).
- API key là bí mật của tài khoản (không phải mã dùng chung) — **không bao
  giờ** commit key vào git hay ghi log ra file, chỉ lưu qua OS keychain
  (xem mục 9).

### 2.2 Endpoint đã xác nhận (gọi thật, có response mẫu)

| Method | Path | Việc gì | Ghi chú |
|---|---|---|---|
| GET | `/v1/auth/me` | Thông tin account + `credit_balance` | Dùng để hiển thị số dư & cảnh báo trước khi chạy batch |
| GET | `/v1/models` | Danh sách model (schema y hệt ElevenLabs `/v1/models`: `model_id`, `name`, `can_do_text_to_speech`, `can_use_style`, `can_use_speaker_boost`...) | |
| GET | `/v1/languages` | Danh sách `{code, name}` | |
| GET | `/v1/default-voices` | Danh sách voice mặc định của ElevenLabs, field `voices: [{voice_id, name, description, ...}]` | |
| GET | `/v1/shared-voices` | Danh sách voice cộng đồng ElevenLabs (rất lớn, ~370KB JSON) — nên cache local, không fetch mỗi lần mở app | |
| GET | `/v1/minimax/voices` | Danh sách voice MiniMax, field `voices: []` | Tài khoản test chưa có voice nào |
| **POST** | `/v1/text-to-speech/{voice_id}` | **Tạo audio (endpoint chính)** | Body: `{ "text": string, "model_id": string, "language_code": string }`. Trả **202 Accepted** ngay: `{ "id": "<task_id>", "status": "pending" }` — **đây là API bất đồng bộ (async/polling), KHÔNG trả file luôn.** `language_code` là bắt buộc và server validate theo model (vd. `eleven_multilingual_v2` không chấp nhận `"vi"` trong lần test — cần dò danh sách code hợp lệ theo từng model trước khi cho user chọn) |
| GET | `/v1/history/{id}` | Poll trạng thái 1 task (dùng chung cho text-to-speech, voice-changer, speech-to-text) | Response đầy đủ: xem mục 2.3 |
| GET | `/v1/history` | List tất cả task của user (`?type=...` có vẻ được chấp nhận nhưng chưa xác nhận hết giá trị hợp lệ) | Trả `{has_more, tasks: [...]}` |
| GET | `/v1/aidubbing/history` , `/v1/aidubbing/history/{id}` | List/detail task Dubbing | Dubbing dùng resource path RIÊNG, không chung với `/v1/history` |
| DELETE | `/v1/aidubbing/history/{id}` | Xoá task dubbing | Auth: `xi-api-key` |
| GET | `/v1/speech-to-text` | List task speech-to-text | |
| GET | `/v1/voice-changer/history` | List task voice changer | |
| GET | `/v1/api-keys` | Quản lý API key | Trả `401 {"error":"missing or invalid authorization token"}` khi dùng chính `xi-api-key` để gọi — endpoint này cần cơ chế auth khác (session/JWT của web app), **không tự quản lý API key được từ desktop app bằng chính API key đó** |

### 2.3 Response mẫu `GET /v1/history/{id}` khi task hoàn tất (CONFIRMED)

```json
{
  "id": "4f9ee66f-7c11-456c-a0a5-d815b20f0800",
  "user_id": "...",
  "status": "completed",
  "progress": 100,
  "provider": "elevenlabs",
  "text": "Hello, this is a short test.",
  "voice_id": "hpp4J3VqNfWAUOO0d1Us",
  "model_id": "eleven_multilingual_v2",
  "name": "Hello, thi",
  "metadata": {
    "language_code": "en",
    "export_transcript": false,
    "voice_name": "Bella - Professional, Bright, Warm"
  },
  "result": { "audio_url": "https://api.genvoice.pro/audio/<id>.mp3" },
  "characters_used": 28,
  "credits_deducted": 28,
  "error": null,
  "detail_error": null,
  "created_at": "...",
  "updated_at": "..."
}
```

- `status` quan sát được: `pending` → (khả năng có `processing`, chưa thấy) →
  `completed` (khả năng có `failed`/`error`, chưa thấy — cần code phòng thủ
  cho mọi giá trị lạ, đừng chỉ handle `completed`).
- `result.audio_url` là URL **public, không cần API key** để tải
  (`GET` trực tiếp trả `audio/mpeg`), `cache-control: public, max-age=172800`
  → **file tồn tại tối đa 48 giờ trên server GenVoice**, app PHẢI tự tải về
  máy ngay khi `status: completed`, không được coi `audio_url` là chỗ lưu
  lâu dài.
- Với provider `elevenlabs`: **1 ký tự văn bản = 1 credit** (`characters_used
  == credits_deducted` trong test). Chưa xác nhận tỉ lệ này có giữ nguyên
  cho MiniMax/CapCut hay không — không giả định giống nhau, đọc field
  `credits_deducted` thật từ response thay vì tự tính trước.

### 2.4 Chưa xác nhận (không đoán, hỏi lại hoặc dò thêm khi cần)
- Path chính xác của "Retry task" / "Delete history" cho text-to-speech
  (đoán theo pattern `/v1/history/{id}` DELETE — cần test riêng, hiện chưa
  gọi vì là thao tác ghi/xoá).
- Danh sách `language_code` hợp lệ theo từng `model_id` (server validate
  server-side — nên gọi thử hoặc tìm trong response `/v1/models` xem có field
  liệt kê ngôn ngữ hỗ trợ không, tránh hard-code danh sách).
- Endpoint tạo audio cho MiniMax/CapCut (khả năng có path riêng như
  `/v1/minimax/text-to-speech/{voice_id}` — chưa test, không giả định).
  Voice Changer, Dialogue, Speech-to-text: có category riêng trong docs
  nhưng chưa test request body.
- Cách đăng ký/lấy API key mới qua API (mục `/v1/api-keys` cần auth khác,
  không quan trọng cho MVP vì user tự copy key có sẵn vào app).
- Giới hạn độ dài `text` mỗi request (ElevenLabs gốc giới hạn ~5000 ký tự
  tuỳ plan — cần test hoặc đọc lỗi trả về khi vượt).

**Quy tắc làm việc:** khi cần các phần "chưa xác nhận" ở trên, KHÔNG bịa
schema rồi code cứng. Cô lập toàn bộ logic gọi GenVoice API trong một lớp
duy nhất (`electron/services/genvoiceApi.ts`) để khi cần sửa/bổ sung theo
kết quả test thật, chỉ sửa một chỗ. Đánh dấu rõ trong code
(`// ASSUMPTION: chưa test thật`) ở bất kỳ chỗ nào dựa trên suy đoán thay vì
response đã xác nhận ở trên.

## 3. Phân tích app tham khảo (Dani Media Auto TTS Subtitles 5.10)

Từ ảnh chụp UI, đây là một **batch TTS tool** với các cụm chức năng:

### 3.1 Voice (chọn & cấu hình giọng đọc)
- Search giọng theo tên (`Name` + nút `Search`).
- Dropdown chọn `Voice` cụ thể.
- Dropdown chọn `Model` (VD: `eleven_multilingual_v2` — đúng model id của
  ElevenLabs, xác nhận backend là ElevenLabs-compatible).
- Dropdown chọn `Language` (mặc định `Auto`).
- Nút `+ Add to Library` — lưu giọng đang chọn vào thư viện cá nhân (local).
- Nút `Library (Vip+)` — mở thư viện giọng đã lưu (tính năng trả phí/VIP
  trong app gốc — với app của ta, không cần phân biệt VIP vì user tự trả
  credit trực tiếp cho GenVoice).

### 3.2 Change voice settings (checkbox bật/tắt override)
Các tham số này **trùng khớp chính xác** với `voice_settings` của ElevenLabs
API — cần map 1:1 khi biết được GenVoice có proxy nguyên schema này không:
- `Speed` (số thực, mặc định 1.00)
- `Style` (%, mặc định 0)
- `Stability` (%, mặc định 50)
- `Similarity` (%, mặc định 75)
- `Speaker Boost` (checkbox, mặc định bật)
- Nút `Reset` về mặc định.

### 3.3 Proxy
- Dropdown chọn proxy (`FREE` / custom) + nút `Load`.
- **Đánh giá:** trong app gốc tính năng này dùng để né rate-limit khi gọi
  thẳng ElevenLabs qua nhiều tài khoản free. Với app mới gọi qua GenVoice
  (dịch vụ trả phí, có API key riêng), tính năng proxy **không cần thiết ở
  bản đầu** — đưa vào backlog, không phải core feature.

### 3.4 Batch Job (chức năng lõi của cả app)
- Chọn thư mục input (`Thư mục` + nút `...`).
- Checkbox `Tự động tạo Srt` — tự sinh phụ đề khớp thời gian audio.
- Nút `Chạy hàng loạt` (Run batch) — xử lý toàn bộ file trong thư mục.
- Khu vực trạng thái: `Subtitles (Done: X Processing: Y Total: Z) Elapsed: Ns`
  — hàng đợi job hiển thị tiến độ real-time.

### 3.5 Options
- `Loop` — lặp lại xử lý (theo dõi thư mục / lặp queue).
- `Auto Split` + ô nhập ký tự phân tách (mặc định `.,;:!?`) — tự động chẻ
  văn bản dài thành nhiều câu/đoạn theo dấu câu trước khi gửi TTS (nhiều
  engine TTS giới hạn độ dài input).
- `Cài đặt nâng cao` (Advanced settings) — mở modal cấu hình mở rộng.

### 3.6 Thanh hành động chính
- `Start` / `Stop` — chạy/dừng queue.
- `Import File (*.srt;*.txt;*.dgt)` — import văn bản/phụ đề làm nguồn text.
- `Import Folder` — import cả thư mục file text.
- `Import Voice` — import cấu hình giọng đã export trước đó.
- `Open Audio Output` — mở thư mục chứa audio đã tạo.
- `Join Mp3 & Tạo srt` — ghép nhiều file mp3 thành 1 file + tự sinh lại file
  SRT với timestamp khớp theo độ dài từng đoạn audio đã ghép.

### 3.7 Kết luận về workflow cốt lõi
```
Import text (file/folder/srt) 
  → Auto Split thành từng đoạn theo dấu câu (nếu bật)
  → Đưa vào queue (Batch Job)
  → Với mỗi đoạn: gọi GenVoice API để generate audio (dùng Voice + Model +
    voice settings đã chọn)
  → Lưu file audio ngay khi nhận được (vì server tự xoá sau N giờ)
  → (tuỳ chọn) Tự động tạo SRT khớp timing
  → (tuỳ chọn) Join tất cả mp3 thành 1 file + SRT tổng hợp
```

## 4. Tech stack

- **Shell:** Electron (main process = Node.js, renderer = Chromium).
- **UI:** React 18 + TypeScript, Vite làm build tool.
- **State management:** Zustand (đơn giản, đủ dùng cho queue/job state).
- **Styling:** Tailwind CSS (dựng nhanh UI dạng form/table giống ảnh mẫu).
- **Local storage:** file JSON đơn giản qua `secureStore.ts` (settings, API
  key mã hoá bằng Electron `safeStorage`) — **không dùng SQLite/`better-sqlite3`
  nữa**. Lý do đổi: đường dẫn project (`/Users/.../TTS AU`) có khoảng trắng,
  khiến `node-gyp`/`@electron/rebuild` build native module thất bại
  ("Attempting to build a module with a space in the path" — lỗi kinh điển
  của node-gyp). Job history/voice library nếu cần bền vững nhiều sau này có
  thể quay lại SQLite (đổi tên thư mục project bỏ khoảng trắng trước) hoặc
  dùng Node built-in `node:sqlite`, nhưng KHÔNG dùng `better-sqlite3` khi
  path còn khoảng trắng.
- **Audio/SRT processing:** gọi thẳng binary `ffmpeg-static` +
  `ffprobe-static` qua `child_process.spawn` (KHÔNG dùng `fluent-ffmpeg` —
  package này đã deprecated/không còn maintain); tự viết SRT writer.
- **HTTP client:** `axios`, bọc trong `genvoiceApi.ts`.
- **Packaging:** `electron-builder` — build cho macOS (.dmg) trước, Windows
  (.exe) sau nếu cần. **Lưu ý:** cần thêm `asarUnpack` cho
  `node_modules/ffmpeg-static` và `node_modules/ffprobe-static` trong
  `electron-builder.yml` trước khi build bản production (2 package này chứa
  binary, không chạy được trong asar) — chưa làm, chỉ mới chạy tốt ở `npm run
  dev`.
- **Auto-update:** `electron-updater` đã cài + wire vào
  `src/main/services/updateService.ts` (check khi app khởi động, chỉ chạy
  khi `app.isPackaged` — không check lúc `npm run dev`). **CHƯA xong**: cần
  cấu hình `publish` trong `electron-builder.yml` trỏ tới nơi host thật
  (đã chọn GitHub Releases, tài khoản `dobichngoc799-bit`) rồi mới build
  `--publish always` được — user chủ động dời việc tạo repo lại sau, ưu
  tiên hoàn thiện MVP trước. Lưu ý khi quay lại: nếu dùng GitHub repo
  private, phải nhúng token read-only vào app (rủi ro lộ token) — nên ưu
  tiên repo public cho mục đích release/update.

## 5. Kiến trúc & cấu trúc thư mục (ĐÃ SCAFFOLD — khớp code thật trong repo)

Dùng **electron-vite** (`npm create @quick-start/electron`) làm build tool
thay vì tự cấu hình Vite — đây là convention chuẩn hiện tại của cộng đồng
electron-vite, cấu trúc `src/main` / `src/preload` / `src/renderer` khác một
chút so với bản nháp ban đầu (`electron/` + `src/`) nhưng cùng nguyên tắc:
**main process** lo filesystem/ffmpeg/network, **renderer** chỉ lo UI và gọi
qua `window.api` (preload), không bật `nodeIntegration`.

```
TTS AU/
├── CLAUDE.md
├── electron.vite.config.ts       # cấu hình build (Tailwind v4 plugin, externalize deps)
├── electron-builder.yml
├── package.json
├── src/
│   ├── shared/
│   │   └── types.ts               # types dùng chung main + renderer (Voice, GenvoiceTask, BatchJobConfig...)
│   ├── main/                      # main process
│   │   ├── index.ts               # tạo window, đăng ký toàn bộ ipcMain.handle
│   │   ├── services/
│   │   │   ├── genvoiceApi.ts     # MỌI call tới GenVoice API (đã implement theo schema CONFIRMED ở mục 2)
│   │   │   ├── secureStore.ts     # lưu API key qua safeStorage + JSON file
│   │   │   ├── textSplitter.ts    # auto split theo dấu câu + parse .srt/.txt/.dgt
│   │   │   ├── ffmpegService.ts   # join mp3 + lấy duration (spawn ffmpeg/ffprobe binary trực tiếp)
│   │   │   └── srtService.ts      # build nội dung .srt từ danh sách đoạn + duration
│   │   └── queue/
│   │       └── batchJobQueue.ts   # BatchJobRunner: submit→poll→download tuần tự, emit progress
│   ├── preload/
│   │   ├── index.ts               # contextBridge, expose window.api (settings/genvoice/dialog/batchJob...)
│   │   └── index.d.ts
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx, App.tsx
│           ├── assets/main.css    # @import "tailwindcss"
│           ├── store/             # zustand: settingsStore, voiceStore, jobStore
│           └── components/        # ApiKeyBar, VoicePanel, BatchJobPanel, JobQueueTable, ActionToolbar
├── resources/                     # icon app
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
└── build/                         # icon cho electron-builder
```

**Trạng thái hiện tại:** `npm run typecheck`, `npm run build` và `npm run
dev` (mở cửa sổ GUI thật) đều đã chạy được — đã verify thật.

**Sự cố đã gặp khi cài lần đầu (ghi lại để nếu gặp lại thì biết cách fix
ngay, không mất thời gian debug lại):**
- Thư viện `extract-zip` (dependency của package `electron`, dùng để giải
  nén Electron.app từ file zip tải về) **bị crash ngầm** khi giải nén trên
  máy này — tiến trình Node thoát với exit code 0, không in lỗi, không tạo
  xong `node_modules/electron/dist/Electron.app`, khiến `electron-vite dev`
  báo `Error: Electron uninstall`. **Cách fix:** giải nén thủ công bằng công
  cụ có sẵn của macOS thay vì để `node_modules/electron/install.js` tự làm:
  ```bash
  ditto -x -k ~/Library/Caches/electron/<hash>/electron-v<version>-darwin-<arch>.zip \
    node_modules/electron/dist
  printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
  ```
  (tìm đúng file zip/hash bằng `find ~/Library/Caches/electron -name "*.zip"`;
  file đã tải sẵn nên không cần mạng lại). Nếu sau này chạy `rm -rf
  node_modules && npm install` thì rất có thể phải làm lại bước này.
- Biến môi trường `ELECTRON_RUN_AS_NODE=1` chỉ tồn tại trong tool Claude
  Code (không có trong Terminal thật của user) — làm `electron.app` bị
  `undefined` nếu vô tình chạy `npm run dev` từ trong tool đó. Không liên
  quan gì tới Terminal thật của user, không cần lo về việc này khi tự chạy
  app bình thường.

## 6. Data model — ĐÃ IMPLEMENT, xem `src/shared/types.ts`

Interface thật (`GenvoiceAccount`, `GenvoiceModel`, `GenvoiceLanguage`,
`GenvoiceVoice`, `VoiceSettings`, `GenvoiceTask`, `JobItem`, `BatchJobConfig`,
`BatchProgressEvent`) đã viết trong code, khớp với response CONFIRMED ở mục
2. Không copy lại nội dung ra đây để tránh lệch — sửa ở code trước, rồi cập
nhật mục 2 nếu phát hiện điều gì mới, KHÔNG sửa ngược từ doc vào code.

Điểm còn ASSUMPTION cần nhớ khi đụng tới file này:
- `VoiceSettings` gửi lên server dưới dạng lồng trong `voice_settings` của
  body `submitTextToSpeech` — **chưa test thật** server có nhận/áp dụng
  không (xem `genvoiceApi.ts` dòng có comment ASSUMPTION).
- `JobItemStatus`/`GenvoiceTask.status` giữ kiểu `string` mở (không union
  đóng) vì mới quan sát được `pending` → `completed`, chưa thấy `failed`.

## 7. GenVoice API integration layer — ĐÃ IMPLEMENT, xem `src/main/services/genvoiceApi.ts`

Toàn bộ call tới GenVoice nằm trong file này (dùng `axios`, xác thực bằng
header `xi-api-key`). Luồng tạo audio (`BatchJobRunner.processItem` trong
`src/main/queue/batchJobQueue.ts`) đã implement đúng flow bất đồng bộ:
`submitTextToSpeech` (POST, trả 202+id) → `pollTaskUntilDone` (GET
`/v1/history/{id}` lặp tới khi hết `pending`/`processing`) → tải
`result.audio_url` về `outputDir` bằng axios (không dùng `xi-api-key` cho
bước tải file vì URL này public).

**Việc còn lại, chưa làm (do cần test thêm với credit thật hoặc dữ liệu
thật, không nên tự bịa):**
1. Xác nhận `voice_settings` trong body POST có được server áp dụng không —
   so sánh audio output khi bật/tắt "Change voice settings".
2. Test 1 request vượt giới hạn ký tự để bắt thông báo lỗi thật.
3. Test path thật của "Retry task"/"Delete history" cho text-to-speech
   (hiện `batchJobQueue.ts` không có nút retry/xoá per-item).
4. Test 1 lần `status: failed` thật (chưa quan sát được) để chắc chắn
   `task.error` là field đúng cần đọc khi lỗi.
5. Đo thời gian xử lý trung bình để tune `intervalMs`/`timeoutMs` trong
   `pollTaskUntilDone` (hiện hard-code 1500ms / 120s — là phỏng đoán hợp lý,
   chưa phải số đo thật).
6. Bắt lỗi credit không đủ (HTTP status + body thật — chưa test) → hiện
   `GenvoiceApiError` chỉ đọc field `error` chung chung, cần xử lý riêng case
   này để dừng queue rõ ràng thay vì hiện lỗi mơ hồ.
7. Endpoint tạo audio cho MiniMax/CapCut (`submitTextToSpeech` hiện chỉ test
   với ElevenLabs) — path/body có thể khác.

## 8. Tính năng ưu tiên (MVP) vs để sau

**MVP — trạng thái implement (code đã viết, GUI chưa verify được — xem mục 5):**
- [x] Chọn voice + model + language + voice settings (UI xong, backend gọi
      thật) — `VoicePanel.tsx`.
- [x] Nhập text trực tiếp + import file .txt/.srt/.dgt + import folder, auto
      split theo dấu câu — `BatchJobPanel.tsx` + `textSplitter.ts`.
- [x] Batch job: queue tuần tự (concurrency=1, xem lý do ở mục 7), hiển thị
      Done/Processing/Total + elapsed time — `JobQueueTable.tsx` +
      `batchJobQueue.ts`.
- [x] Start/Stop giữa chừng (`stop()` set flag, poll loop tự dừng).
- [x] Lưu audio về đĩa ngay khi task `completed` (không giữ `audio_url` lâu
      dài).
- [x] Join nhiều mp3 + tự sinh SRT tổng hợp — `ffmpegService.ts` +
      `srtService.ts` (dùng ffmpeg concat demuxer, không re-encode).
- [x] Hiển thị credit còn lại (`ApiKeyBar.tsx`, gọi `GET /v1/auth/me`).
- [x] **Cảnh báo trước khi chạy job vượt quá credit** — `ActionToolbar.tsx`
      ước tính `tổng ký tự = credit` (chỉ đúng cho provider `elevenlabs`,
      xem CLAUDE.md mục 2.3), disable nút Start + hiện cảnh báo đỏ nếu vượt
      quá `credit_balance`. Refresh lại balance sau mỗi lần chạy job.
- [x] **Verify GUI thật chạy được** — đã tự chạy end-to-end: user xác nhận
      generate audio thật thành công qua UI (không chỉ mở cửa sổ suông).

**Để sau (không phải bản đầu):**
- Proxy management (mục 3.3) — không cần thiết vì gọi qua GenVoice có key
  riêng, không giống việc né rate-limit tài khoản free ElevenLabs.
- Voice Library đồng bộ cloud / phân loại VIP.
- Auto-update (`electron-updater`).
- Hỗ trợ Dubbing (video) và Studio (multi-scene project) của GenVoice — đây
  là tính năng lớn riêng, chỉ làm khi MVP TTS text-to-audio đã ổn định.
- Đa nền tảng Windows build — ưu tiên macOS trước vì đó là máy dev hiện tại.

## 9. Quy ước phát triển

- Toàn bộ gọi mạng ra ngoài (GenVoice API) đi qua `genvoiceApi.ts`, không
  rải `fetch`/`axios` khắp nơi.
- Không hard-code API key trong source — đọc từ config lưu trong SQLite
  hoặc OS keychain (Electron `safeStorage`), không lưu plaintext trong file
  JSON thường. Key GenVoice của user gắn trực tiếp với `credit_balance`
  thật (tương đương tiền) — tuyệt đối không log ra console/file, không
  commit vào git, không gửi kèm trong báo cáo lỗi.
- Mọi thao tác file (ffmpeg, đọc/ghi audio, import folder) chỉ chạy ở main
  process, expose qua IPC — không expose Node `fs` thẳng ra renderer.
- Khi chưa chắc schema API, viết code với interface rõ ràng + comment
  `// ASSUMPTION`, không lặng lẽ đoán rồi coi như chắc chắn.
- Giữ nguyên thuật ngữ/label tiếng Việt trong UI (giống app gốc: "Chạy hàng
  loạt", "Thư mục", "Tự động tạo Srt"...) trừ khi user yêu cầu đổi sang
  tiếng Anh.

## 10. Việc cần làm tiếp theo

1. **User tự chạy `npm install && npm run dev` trong Terminal thật** (ngoài
   Claude Code) để mở app lần đầu — đây là bước bắt buộc chưa làm được ở
   phiên này (xem lý do ở mục 5). Nếu lỗi gì khi mở, báo lại nguyên văn lỗi.
2. Dán API key thật vào ô đầu app, kiểm tra `credit_balance` hiện đúng số
   dư, danh sách voice/model/language load được.
3. Thử generate 1 đoạn text ngắn, xác nhận file mp3 xuất hiện trong output
   dir đã chọn và nghe được.
4. Xử lý các mục "chưa làm" ở mục 8 (cảnh báo credit trước khi chạy) và các
   TODO thật trong `genvoiceApi.ts`/`batchJobQueue.ts` ở mục 7.
5. Trước khi build bản production (`npm run build:mac`): thêm `asarUnpack`
   cho `ffmpeg-static`/`ffprobe-static` trong `electron-builder.yml` (xem
   mục 4) — build production sẽ lỗi vì binary không chạy được trong asar
   nếu bỏ qua bước này.
