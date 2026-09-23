# TTS V1 — Desktop Text-to-Speech Batch Tool

> **Tên app:** "TTS V1" (đổi từ "TTS AU"/`ttsau-scaffold` ngày 2026-09-23 —
> chỉ đổi tên hiển thị: title, header, `productName`, `executableName`, tên
> file cài `TTS-V1-<version>-setup.exe`). CỐ Ý giữ nguyên: `name: ttsau`
> trong package.json, `appId`, `setAppUserModelId`, và thư mục userData của
> bản đóng gói được ghim về `%APPDATA%\ttsau-scaffold` trong
> `src/main/index.ts` — để không mất API key/settings đã lưu và không cài
> thành app song song. Các chỗ ghi `ttsau-*.exe` bên dưới là lịch sử build cũ.

## 1. Mục tiêu dự án

Xây dựng một desktop app tạo audio (Text-to-Speech) bằng cách gọi API của
[GenVoice](https://genvoice.pro) — dịch vụ bán credit cho phép gọi TTS qua
nhiều backend (ElevenLabs, MiniMax, CapCut...). App được thiết kế lại dựa trên
app tham khảo **"Dani Media Auto TTS Subtitles (evlabs) 5.10"** (Windows
WinForms) nhưng build mới hoàn toàn bằng **Electron + React + TypeScript**.
Dev ban đầu trên macOS, hiện đang phát triển tiếp trên **Windows** (máy dev
hiện tại) — xem mục 5 về khác biệt môi trường giữa 2 máy.

Đây không phải là port 1:1 — ta giữ lại đúng workflow (chọn giọng → batch job
→ tạo audio hàng loạt → ghép file → xuất SRT) nhưng xây trên stack hiện đại.

**Trạng thái tổng quan (2026-09-15):** MVP đã hoạt động end-to-end thật với
credit thật trên Windows (generate audio, Auto Split, Join Mp3, import file
tự tạo folder riêng, chạy song song 4 luồng), UI đã redesign, đã build ra
bản cài đặt Windows (`.exe`) chạy được. Xem mục 10 cho danh sách việc còn lại.

## 2. GenVoice API — đã xác nhận bằng request thật

Trang `https://genvoice.pro/docs` là SPA (React) chỉ hiển thị đầy đủ khi có
JS render + login, nên không lấy được bằng cách fetch HTML thông thường. Đã
xác nhận toàn bộ thông tin dưới đây bằng cách gọi thật vào API với API key
của user.

### 2.1 Kết nối & xác thực (CONFIRMED)
- **Base URL:** `https://api.genvoice.pro`
- **Auth header:** `xi-api-key: <API_KEY>` (đúng tên header của ElevenLabs
  gốc — GenVoice giữ nguyên convention này).
- **Rate limit:** có header `x-ratelimit-limit` / `x-ratelimit-remaining` /
  `x-ratelimit-reset` trên mọi response (quan sát được limit ~2000, reset
  tính theo giây). `batchJobQueue.ts` chạy `CONCURRENCY=4` song song.
  **Thực tế (2026-09-23):** user báo file 60 dòng chạy tới ~dòng 40 thì
  server trả lỗi `rate_limit_exceeded` — mức ~2000 không phải giới hạn duy
  nhất (có thể có limit riêng theo phút/theo số task TTS, chưa rõ). Đã thêm
  tự đợi + thử lại (`withRateLimitRetry` trong `genvoiceApi.ts`, đợi theo
  `retry-after`/`x-ratelimit-reset` hoặc backoff 5s→60s, tối đa 10 lần, UI
  hiện badge "Đợi rate limit"). **Chưa verify với credit thật**: HTTP status
  thật (đang giả định 429) và ý nghĩa chính xác của `x-ratelimit-reset`.
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
| GET | `/v1/shared-voices` | Danh sách voice cộng đồng ElevenLabs, có phân trang thật (`has_more`, `page`/`page_size` tối đa 100) + `search` server-side theo cả tên lẫn voice_id | Không tải hết về rồi lọc client — luôn truyền `search` khi user gõ tìm |
| GET | `/v1/minimax/voices` | Danh sách voice MiniMax, field `voices: []` | Tài khoản test chưa có voice nào |
| **POST** | `/v1/text-to-speech/{voice_id}` | **Tạo audio (endpoint chính)** | Body: `{ text, model_id, language_code, voice_settings? }`. Trả **202 Accepted** ngay: `{ id, status: "pending" }` — API bất đồng bộ (polling), KHÔNG trả file luôn. `language_code` bắt buộc, server validate theo model. `voice_settings` — xem mục 2.3, CONFIRMED server có áp dụng |
| GET | `/v1/history/{id}` | Poll trạng thái 1 task (dùng chung cho text-to-speech, voice-changer, speech-to-text) | Response đầy đủ: xem mục 2.3 |
| GET | `/v1/history` | List tất cả task của user (`?type=...` có vẻ được chấp nhận nhưng chưa xác nhận hết giá trị hợp lệ) | Trả `{has_more, tasks: [...]}` |
| GET | `/v1/aidubbing/history` , `/v1/aidubbing/history/{id}` | List/detail task Dubbing | Dubbing dùng resource path RIÊNG, không chung với `/v1/history` |
| DELETE | `/v1/aidubbing/history/{id}` | Xoá task dubbing | Auth: `xi-api-key` |
| GET | `/v1/speech-to-text` | List task speech-to-text | |
| GET | `/v1/voice-changer/history` | List task voice changer | |
| GET | `/v1/api-keys` | Quản lý API key | Trả `401` khi dùng `xi-api-key` để gọi — cần auth khác (session/JWT web app), không tự quản lý API key được từ desktop app |

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
  `completed` (khả năng có `failed`/`error`, chưa thấy — code đã phòng thủ
  cho mọi giá trị lạ, đừng chỉ handle `completed`).
- `result.audio_url` là URL **public, không cần API key** để tải,
  `cache-control: public, max-age=172800` → **file tồn tại tối đa 48 giờ
  trên server GenVoice**, app PHẢI tự tải về máy ngay khi `status:
  completed` (đã implement trong `batchJobQueue.ts`).
- Với provider `elevenlabs`: **1 ký tự văn bản = 1 credit**
  (`characters_used == credits_deducted`) — verify nhiều lần với credit
  thật (vd. đoạn 70 ký tự → trừ đúng 70 credit). Chưa xác nhận tỉ lệ này
  cho MiniMax/CapCut — luôn đọc `credits_deducted` thật từ response thay vì
  tự tính trước.
- `voice_settings` trong body POST **CONFIRMED server có áp dụng thật**
  (2026-09-15): test speed=0.7 trên cùng 1 đoạn text, duration audio tăng
  từ 5.64s → 7.97s (tỉ lệ ~1.41, khớp gần đúng 1/0.7≈1.43).

### 2.4 Chưa xác nhận (không đoán, hỏi lại hoặc dò thêm khi cần)
- Path chính xác của "Retry task" / "Delete history" cho text-to-speech
  (chưa test, chưa có nút retry/xoá per-item trong UI).
- Danh sách `language_code` hợp lệ theo từng `model_id`.
- Endpoint tạo audio cho MiniMax/CapCut (`submitTextToSpeech` hiện chỉ test
  với ElevenLabs) — path/body có thể khác. Voice Changer, Dialogue,
  Speech-to-text: chưa test request body.
- Response thật khi credit không đủ (HTTP status + body).
- Response thật khi `status: failed` xảy ra (chưa quan sát được lần nào).
- Giới hạn độ dài `text` mỗi request (ElevenLabs gốc ~5000 ký tự tuỳ plan).
- Cách đăng ký/lấy API key mới qua API — không quan trọng cho MVP.

**Quy tắc làm việc:** khi cần các phần "chưa xác nhận" ở trên, KHÔNG bịa
schema rồi code cứng. Cô lập toàn bộ logic gọi GenVoice API trong
`src/main/services/genvoiceApi.ts` để khi cần sửa/bổ sung theo kết quả test
thật, chỉ sửa một chỗ. Đánh dấu rõ trong code (`// ASSUMPTION`) ở bất kỳ chỗ
nào dựa trên suy đoán thay vì response đã xác nhận ở trên.

## 3. Phân tích app tham khảo (Dani Media Auto TTS Subtitles 5.10)

Từ ảnh chụp UI, đây là một **batch TTS tool** với các cụm chức năng:

### 3.1 Voice (chọn & cấu hình giọng đọc)
- Search giọng theo tên (`Name` + nút `Search`).
- Dropdown chọn `Voice`, `Model` (VD: `eleven_multilingual_v2`), `Language`.
- Nút `+ Add to Library` / `Library (Vip+)` — không cần phân biệt VIP ở app
  mới vì user tự trả credit trực tiếp cho GenVoice.

### 3.2 Change voice settings (checkbox bật/tắt override)
Trùng khớp `voice_settings` của ElevenLabs API: `Speed` (0.7–1.2, mặc định
1.0), `Style` (%, mặc định 0), `Stability` (%, mặc định 50), `Similarity`
(%, mặc định 75), `Speaker Boost` (checkbox), nút `Reset`.

### 3.3 Proxy
Dùng để né rate-limit khi gọi thẳng ElevenLabs qua nhiều tài khoản free —
**không cần thiết** với app mới (gọi qua GenVoice, key riêng). Backlog.

### 3.4–3.6 Batch Job / Options / Thanh hành động chính
- Chọn thư mục input, `Auto Split` (mặc định `.,;:!?`), `Tự động tạo Srt`.
- `Start`/`Stop`, `Import File (*.srt;*.txt;*.dgt)`, `Import Folder`,
  `Open Audio Output`, `Join Mp3 & Tạo srt`.
- Khu trạng thái: `Subtitles (Done: X Processing: Y Total: Z) Elapsed: Ns`.

### 3.7 Workflow cốt lõi (đã implement, xem mục 6+8)
```
Import text (file/folder/srt) hoặc gõ tay
  → Auto Split thành từng đoạn theo dấu câu (nếu bật)
  → Đưa vào queue (Batch Job, chạy song song CONCURRENCY=4)
  → Với mỗi đoạn: gọi GenVoice API để generate audio
  → Lưu file audio ngay khi nhận được (server tự xoá sau 48h)
  → (tuỳ chọn) Join mp3 + tạo SRT — ĐẶT TÊN theo group (xem mục 6)
```

## 4. Tech stack

- **Shell:** Electron (main process = Node.js, renderer = Chromium).
- **UI:** React 18 + TypeScript, Vite (qua `electron-vite`) làm build tool.
- **State management:** Zustand.
- **Styling:** Tailwind CSS v4. UI đã redesign 2026-09-15 (xem mục 8) — màu
  nhấn indigo, card bo góc + shadow, badge trạng thái, slider custom, cửa
  sổ khoá cứng 1100x780 (xem mục 9).
- **Local storage:** file JSON qua `secureStore.ts` (settings, API key mã
  hoá bằng Electron `safeStorage`) — không dùng SQLite/`better-sqlite3`
  (path project có khoảng trắng lúc mới tạo → lỗi node-gyp; nếu cần
  SQLite sau này, đổi tên thư mục bỏ khoảng trắng hoặc dùng
  `node:sqlite`).
- **Audio/SRT processing:** gọi thẳng binary `ffmpeg-static` +
  `ffprobe-static` qua `child_process.spawn` (không dùng `fluent-ffmpeg`,
  đã deprecated); tự viết SRT writer.
- **HTTP client:** `axios`, bọc trong `genvoiceApi.ts`.
- **Icon app:** `build/icon.ico` (đa độ phân giải 16→256, PNG-in-ICO),
  `build/icon.png` + `resources/icon.png` (640x640) — ảnh do user cung cấp
  (đổi ảnh mới 2026-09-23, chưa có trong release v0.1.0 — cần phát hành
  bản sau). Lưu ý khi kiểm tra: `System.Drawing.Icon` của .NET không đọc
  được entry PNG trong .ico (hiện ra nhiễu) — kiểm tra bằng cách tách từng
  entry ra decode riêng, hoặc `ExtractAssociatedIcon` trên exe đã build. `build/icon.icns` (macOS) **CHƯA cập nhật theo ảnh mới**
  (cần công cụ trên máy Mac để tạo đúng .icns) — không quan trọng vì hiện
  chỉ build Windows.
- **Packaging:** `electron-builder`. `electron-builder.yml` có
  `asarUnpack` cho `node_modules/ffmpeg-static/**` và
  `node_modules/ffprobe-static/**`, `ffmpegService.ts` tự thay `app.asar`
  → `app.asar.unpacked` trong path khi `app.isPackaged` — **CONFIRMED bằng
  build production thật** (2026-09-15): `npm run build:win` chạy thành
  công, ra `dist\ttsau-0.1.0-setup.exe` (NSIS) + `dist\win-unpacked\`; mở
  trực tiếp `ttsau-scaffold.exe` xác nhận app chạy được, gọi trực tiếp
  `ffmpeg.exe -version`/`ffprobe.exe -version` từ đúng path unpacked xác
  nhận cả 2 binary chạy được. **Chưa test**: generate audio + join mp3
  thật *bằng chính bản đã đóng gói* (chỉ mới verify ở `npm run dev`).
- **Auto-update:** `electron-updater` đã cài + wire vào
  `src/main/services/updateService.ts` (chỉ chạy khi `app.isPackaged`).
  **Cấu hình 2026-09-23:** `publish` = GitHub Releases repo public
  `dobichngoc799-bit/TTS-AU`, `releaseType: release` (không draft). Build
  local `npm run build:win` (`--publish never`) đã verify ra
  `dist\TTS-V1-<ver>-setup.exe` + `latest.yml`, và `app-update.yml` trong
  `resources` trỏ đúng repo. Phát hành bản mới: tăng `version` trong
  package.json → `$env:GH_TOKEN="<token>"` → `npm run release`. Token chỉ
  đặt qua biến môi trường, KHÔNG ghi vào file/commit. Token cần quyền
  **Contents: Read and write** trên repo (fine-grained phải chọn "Only
  select repositories" thì mục Contents mới hiện) hoặc `public_repo`
  (classic). `npm run release` chạy `scripts/create-github-release.mjs`
  trước: tạo sẵn release `v<version>` vì electron-builder upload song song
  và tự tạo release 2 lần → lỗi 422, file .exe/latest.yml không lên (đã
  gặp thật khi phát hành v0.1.0 — phải upload tay + sửa lại sha512 trong
  latest.yml). Script cũng chặn nếu release version đó đã có file .exe
  (quên tăng version). **v0.1.0 đã phát hành 2026-09-23**, đã verify tải
  về qua link public khớp sha512 trong latest.yml. Nếu có batch job đang
  chạy khi tải xong update thì không restart (tự cài khi tắt app). Các bản
  build TRƯỚC 2026-09-23 trỏ URL placeholder nên không tự update được —
  phải cài tay 1 lần bản mới.

## 5. Kiến trúc & cấu trúc thư mục (khớp code thật trong repo)

Dùng **electron-vite**, cấu trúc `src/main` / `src/preload` / `src/renderer`:
**main process** lo filesystem/ffmpeg/network, **renderer** chỉ lo UI và gọi
qua `window.api` (preload), không bật `nodeIntegration`.

```
TTS-AU/
├── CLAUDE.md
├── electron.vite.config.ts       # cấu hình build (Tailwind v4 plugin, externalize deps)
├── electron-builder.yml
├── package.json
├── src/
│   ├── shared/
│   │   └── types.ts               # types dùng chung main + renderer (xem mục 6)
│   ├── main/                      # main process
│   │   ├── index.ts               # tạo window (1100x780, resizable:false), đăng ký ipcMain.handle, đọc file import + tính outputDir/outputBaseName
│   │   ├── services/
│   │   │   ├── genvoiceApi.ts     # MỌI call tới GenVoice API
│   │   │   ├── secureStore.ts     # lưu API key qua safeStorage + JSON file
│   │   │   ├── textSplitter.ts    # autoSplitText (theo dấu câu) + extractLinesFromFileContent (.srt/.txt/.dgt)
│   │   │   ├── ffmpegService.ts   # join mp3 + lấy duration, tự resolve path app.asar.unpacked
│   │   │   └── srtService.ts      # build nội dung .srt từ danh sách đoạn + duration
│   │   └── queue/
│   │       └── batchJobQueue.ts   # BatchJobRunner: worker pool CONCURRENCY=4, xử lý theo group (BatchGroup), emit progress
│   ├── preload/
│   │   ├── index.ts               # contextBridge, expose window.api
│   │   └── index.d.ts
│   └── renderer/
│       └── src/
│           ├── main.tsx, App.tsx
│           ├── assets/main.css    # design tokens, custom range/checkbox style
│           ├── store/             # zustand: settingsStore, voiceStore, jobStore (groups + sourceLines)
│           └── components/        # ApiKeyBar, VoicePanel, BatchJobPanel, JobQueueTable, ActionToolbar (đều có nút thu gọn ▼ cho Voice/Batch Job)
├── resources/icon.png             # icon app (640x640, ảnh user cung cấp)
├── build/                         # icon.ico/.png/.icns cho electron-builder
├── dist/                          # output build production (gitignore, KHÔNG commit)
└── tsconfig.json / tsconfig.node.json / tsconfig.web.json
```

**Môi trường dev — 2 máy khác nhau:**
- **macOS** (dev ban đầu): gặp lỗi `extract-zip` crash ngầm khi cài
  `electron` — fix bằng `ditto -x -k ~/Library/Caches/electron/<hash>/electron-v<version>-darwin-<arch>.zip node_modules/electron/dist` +
  `printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt`.
  Nếu `rm -rf node_modules && npm install` thì rất có thể phải làm lại.
- **Windows** (đang dùng): máy chỉ có sẵn Node **v16.15.0**, trong khi
  `vite@7` yêu cầu Node ≥20.19 — không có nvm-windows và không cài được qua
  winget (installer cần UAC elevation tương tác, môi trường chạy lệnh
  không tương tác nên không xác nhận được prompt). **Fix đã dùng:** tải
  bản portable `node-v22.14.0-win-x64.zip` từ nodejs.org, giải nén vào
  `%USERPROFILE%\nodejs-portable\node-v22.14.0-win-x64`, thêm vào đầu PATH
  cấp **User** (không cần quyền admin). Terminal/PowerShell **mới** tự
  nhận; session/tool đã mở từ trước phải tự
  `export PATH=".../nodejs-portable/node-v22.14.0-win-x64:$PATH"` (Bash)
  hoặc `$env:Path = "...;" + $env:Path` (PowerShell) trước khi chạy
  node/npm trong session đó.
- Biến môi trường `ELECTRON_RUN_AS_NODE=1` chỉ tồn tại trong tool Claude
  Code, không có trong Terminal thật — làm `electron.app` bị `undefined`
  nếu vô tình `npm run dev` từ trong tool đó (`unset ELECTRON_RUN_AS_NODE`
  trước khi chạy để tránh).
- **HMR có thể bị "kẹt"** sau nhiều lần sửa liên tục qua `npm run dev`: dev
  server vẫn chạy, log vẫn in `hmr update`, nhưng cửa sổ Electron ngừng
  nhận cập nhật mới một cách âm thầm (UI stale, vd. Model/Language dropdown
  trống dù code đã đúng). Cách fix: kill hết process `electron.exe` rồi
  `npm run dev` lại từ đầu — **nhưng nếu có batch job thật đang chạy
  (credit thật), PHẢI đợi job xong hoặc hỏi user trước khi restart**, vì
  restart sẽ huỷ các item chưa chạy xong giữa chừng.

**Trạng thái:** `npm install`, `npm run typecheck`, `npm run build`,
`npm run dev`, `npm run build:win` đều đã verify chạy được thật trên
Windows (không chỉ đọc code suy luận).

## 6. Data model — xem `src/shared/types.ts`

Interface chính: `GenvoiceAccount`, `GenvoiceModel`, `GenvoiceLanguage`,
`GenvoiceVoice`, `VoiceSettings`, `GenvoiceTask`, `JobItem`, `BatchGroup`,
`BatchJobConfig`, `ImportedFileGroup`, `BatchProgressEvent`. Sửa ở code
trước, cập nhật mục 2 nếu phát hiện điều gì mới — KHÔNG sửa ngược từ doc
vào code.

**Khái niệm "group" (thêm 2026-09-15 — tính năng import file tự tạo
folder riêng):** 1 batch job có thể gồm nhiều `BatchGroup`, mỗi group là 1
"nguồn" audio sẽ ghép + đặt tên chung:
- **Group văn bản gõ tay** (nếu có nhập/paste vào textarea): dùng "Thư mục
  output" user chọn tay (`settingsStore.outputDir`), `outputBaseName =
  'joined'` — giữ đúng behavior cũ (001.mp3, 002.mp3..., joined.mp3/.srt).
- **Group từ file import** (Import File/Folder, mỗi file .txt/.srt/.dgt =
  1 group riêng): main process (`readImportedFileGroup` trong
  `src/main/index.ts`) tự tính `outputDir` = folder MỚI cùng tên file
  (không đuôi), tạo CẠNH file gốc, và `outputBaseName` = tên file đó. Vd
  `C:\...\MyText.txt` → tạo `C:\...\MyText\`, audio lẻ vẫn đánh số
  `001.mp3...`, nếu tick "Join Mp3" thì ghép thành `MyText.mp3` (+ `.srt`
  nếu tick "Tự động tạo Srt") ngay trong folder đó. Import Folder xử lý
  từng file độc lập (không gộp chung).
- `.srt` import luôn tách theo đúng block phụ đề gốc (không áp Auto Split
  đè lên) vì đã có đơn vị tự nhiên sẵn. `.txt`/`.dgt` thì theo Auto Split
  đang bật/tắt của user (giống hệt cách xử lý text gõ tay) — đổi content
  raw về renderer (`ImportedFileGroup.content`) để renderer tự tách lại
  mỗi khi user đổi Auto Split, không tách cứng lúc import.
- "Thư mục output" trong `BatchJobPanel.tsx` **chỉ áp dụng cho group gõ
  tay** — không cần chọn nếu chỉ import file. Nút "Open Audio Output" mở
  TẤT CẢ folder liên quan (folder gõ tay nếu có + folder từng file import,
  mỗi cái 1 cửa sổ Explorer).
- `jobStore.ts`: state `sourceLines` (gõ tay) + `importedGroups: ImportedGroup[]`
  (mỗi phần tử giữ `content`+`ext` để recompute khi đổi Auto Split), hàm
  `start()` gộp cả 2 nguồn thành `groups`+`items` gửi qua IPC
  `batchJob:start`. `batchJobQueue.ts` (`BatchJobRunner`) resolve
  `item.groupId` → `BatchGroup` để biết ghi file vào đâu, ghép+đặt tên
  theo từng group riêng (không còn 1 `outputDir` global như trước).

Điểm còn ASSUMPTION:
- `JobItemStatus`/`GenvoiceTask.status` giữ kiểu `string` mở (không union
  đóng) vì mới quan sát được `pending` → `completed`, chưa thấy `failed`.

## 7. GenVoice API integration layer — xem `src/main/services/genvoiceApi.ts`

Toàn bộ call tới GenVoice nằm trong file này (`axios`, header `xi-api-key`).
Flow tạo audio (`BatchJobRunner` trong `batchJobQueue.ts`, worker pool
`CONCURRENCY=4`): `submitTextToSpeech` (POST, trả 202+id) →
`pollTaskUntilDone` (GET `/v1/history/{id}` lặp tới khi hết
`pending`/`processing`, interval 1500ms/timeout 120s — hard-code hợp lý,
chưa phải số đo chính xác) → tải `result.audio_url` về đúng `outputDir`
của group → ghép+đặt tên theo group nếu bật "Join Mp3"/"Tự động tạo Srt".

**Việc còn chưa làm** (cần credit thật/dữ liệu thật để test, không tự bịa
schema — xem mục 2.4 để biết chi tiết từng mục):
1. Test 1 request vượt giới hạn ký tự → bắt thông báo lỗi thật.
2. Test path thật của "Retry task"/"Delete history" (chưa có nút per-item).
3. Test 1 lần `status: failed` thật → xác nhận `task.error` là field đúng.
4. Bắt lỗi credit không đủ (HTTP status + body thật) — hiện
   `GenvoiceApiError` chỉ đọc field `error` chung chung.
5. Endpoint tạo audio cho MiniMax/CapCut — path/body có thể khác.

## 8. Tính năng — trạng thái hiện tại

**Core batch TTS (đã verify end-to-end với credit thật trên Windows):**
- [x] Chọn voice (search toàn thư viện GenVoice hoặc dán ID trực tiếp) +
      model + language + voice settings (CONFIRMED server áp dụng thật —
      mục 2.3) — `VoicePanel.tsx`.
- [x] Nhập text trực tiếp + import file `.txt/.srt/.dgt` + import folder,
      Auto Split theo dấu câu (áp dụng cho cả text gõ tay lẫn nội dung file
      import) — `BatchJobPanel.tsx` + `textSplitter.ts`.
- [x] **Import file tự tạo folder + đặt tên theo file gốc** (tính năng mới
      2026-09-15) — xem chi tiết mục 6.
- [x] Batch job chạy **song song CONCURRENCY=4** (đổi từ tuần tự
      2026-09-15, an toàn với rate limit ~2000 — mục 2.1), hiển thị
      Done/Processing/Total + progress bar + elapsed time —
      `JobQueueTable.tsx` + `batchJobQueue.ts`.
- [x] Start/Stop giữa chừng.
- [x] Lưu audio về đĩa ngay khi task `completed`.
- [x] Join nhiều mp3 + tự sinh SRT, đặt tên theo group (mục 6) —
      `ffmpegService.ts` + `srtService.ts` (ffmpeg concat demuxer, không
      re-encode).
- [x] **Khoảng lặng giữa các đoạn khi Join** (2026-09-23, mặc định 1.5s,
      0 = nối liền, chỉnh ở ô "Khoảng lặng" cạnh "Join Mp3") — để user dễ
      nhận ra chỗ cắt. Tạo 1 file mp3 im lặng cùng sample rate/kênh với
      đoạn đầu rồi chèn vào list concat (vẫn không re-encode); SRT cộng
      thêm độ dài THẬT của file im lặng (mp3 làm tròn theo frame, vd 1.5s →
      ~1.54s). Đã verify lệnh ffmpeg bằng file test, chưa verify với audio
      GenVoice thật.
- [x] Hiển thị credit còn lại + cảnh báo trước khi chạy job vượt quá credit
      (ước tính `tổng ký tự = credit`, chỉ đúng cho `elevenlabs`) —
      `ApiKeyBar.tsx` + `ActionToolbar.tsx`.
- [x] Nút "Open Audio Output" mở tất cả folder liên quan (gõ tay + từng
      file import).

**UI (redesign 2026-09-15):** màu nhấn indigo, card bo góc + shadow, badge
trạng thái màu (Xong/Lỗi/Chờ...), progress bar, slider custom (Speed/Style/
Stability/Similarity), panel Voice + Batch Job có nút thu gọn ▼ để nhường
chỗ cho bảng Subtitles khi cần theo dõi job dài. Cửa sổ khoá cứng 1100x780,
không cho resize/maximize (xem mục 9 — lý do).

**Mặc định hiện tại của các checkbox** (đổi theo yêu cầu user, khác giá trị
gốc lúc scaffold): `Auto Split` = tắt, `Tự động tạo Srt` = tắt, `Join Mp3
sau khi xong` = bật, `Speaker Boost` = tắt.

**Packaging:** đã build production Windows thật (`ttsau-0.1.0-setup.exe`),
icon app đã đổi theo ảnh user cung cấp — xem mục 4.

**Để sau (không phải ưu tiên hiện tại):**
- Proxy management (mục 3.3) — không cần thiết vì gọi qua GenVoice.
- Voice Library đồng bộ cloud / phân loại VIP.
- Publish GitHub Releases + bật auto-update thật (`electron-updater`) —
  xem mục 4, đang hoãn.
- Hỗ trợ Dubbing (video) và Studio (multi-scene) của GenVoice — tính năng
  lớn riêng, chỉ làm khi MVP TTS text-to-audio đã ổn định hoàn toàn.
- macOS: build lại + tạo `build/icon.icns` mới theo ảnh (cần máy Mac).

## 9. Quy ước phát triển

- Toàn bộ gọi mạng ra ngoài (GenVoice API) đi qua `genvoiceApi.ts`, không
  rải `fetch`/`axios` khắp nơi.
- Không hard-code API key trong source — lưu qua OS keychain (Electron
  `safeStorage`), không lưu plaintext. Key GenVoice của user gắn trực tiếp
  với `credit_balance` thật (tương đương tiền) — tuyệt đối không log ra
  console/file, không commit vào git, không gửi kèm trong báo cáo lỗi.
- Mọi thao tác file (ffmpeg, đọc/ghi audio, import folder) chỉ chạy ở main
  process, expose qua IPC — không expose Node `fs` thẳng ra renderer.
- Khi chưa chắc schema API, viết code với interface rõ ràng + comment
  `// ASSUMPTION`, không lặng lẽ đoán rồi coi như chắc chắn.
- Giữ nguyên thuật ngữ/label tiếng Việt trong UI (giống app gốc: "Chạy hàng
  loạt", "Thư mục", "Tự động tạo Srt"...) trừ khi user yêu cầu đổi sang
  tiếng Anh.
- **Cửa sổ app cố định kích thước 1100x780, không cho resize/maximize**
  (`resizable: false`, `maximizable: false` trong `BrowserWindow` ở
  `src/main/index.ts`) — quyết định 2026-09-15 sau khi phát hiện layout
  responsive (`grid-cols-2 md:grid-cols-4` ở VoicePanel) bị đè/chồng chữ
  khi user tự kéo cửa sổ nhỏ lại ở breakpoint giữa. Ngoài ra còn 1 lớp fix
  khác biệt: **grid item cần `min-w-0`** để co đúng theo cột thay vì tràn
  sang cột bên cạnh (lỗi CSS grid/flexbox kinh điển, xảy ra ngay cả ở đúng
  kích thước cố định, không chỉ khi resize) — đã thêm `min-w-0` cho mọi ô
  grid trong `VoicePanel.tsx`. Layout được canh vừa khít 1100x780 ở trạng
  thái mặc định; khu giữa (Voice/Batch Job/Subtitles) có `overflow-y-auto`
  làm lưới an toàn khi nội dung dài hơn bình thường.
- **Trước khi restart `npm run dev`**: LUÔN kiểm tra có batch job thật
  đang chạy không (dùng credit thật) — nếu có, hỏi user trước khi restart
  vì sẽ huỷ các item chưa xong giữa chừng. Đổi code main process (vd
  `src/main/index.ts`, `batchJobQueue.ts`) không tự hot-reload vào job
  đang chạy — chỉ áp dụng cho lần Start tiếp theo sau khi restart.

## 10. Việc cần làm tiếp theo

**Cần credit thật để test (xem chi tiết mục 2.4 / mục 7):**
1. Test vượt giới hạn ký tự, credit không đủ, `status: failed` thật —
   hiện toàn bộ 3 case này chưa quan sát được lần nào.
2. Test endpoint MiniMax/CapCut (hiện chỉ verify ElevenLabs).
3. Generate audio + join mp3 thật bằng **bản đã đóng gói**
   (`dist\ttsau-0.1.0-setup.exe` hoặc `win-unpacked`) — chỉ mới verify ở
   `npm run dev`, chưa tự tay bấm thử ở bản production dù code path giống
   hệt nhau.

**Việc không cần credit, có thể làm ngay khi quay lại:**
4. Retry/Delete task per-item trong `JobQueueTable.tsx` (cần biết path
   API thật trước — mục 2.4).
5. Cân nhắc cho phép chỉnh `CONCURRENCY` (hiện hard-code 4 trong
   `batchJobQueue.ts`) qua UI nếu user thấy cần nhanh/chậm hơn.
6. macOS: build lại `build/icon.icns` theo ảnh icon mới (cần máy Mac).

**Auto-update:**
7. Đã phát hành v0.1.0 lên GitHub Releases (xem mục 4) — còn test update
   thật: cài v0.1.0, phát hành v0.1.1, mở app xem có hỏi cập nhật không.
