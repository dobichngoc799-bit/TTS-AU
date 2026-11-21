// Types shared between main and renderer. Keep this file free of Node/DOM-specific
// imports so it type-checks under both tsconfig.node.json and tsconfig.web.json.

// Nguồn tạo audio: qua GenVoice (bán credit) hoặc gọi thẳng ElevenLabs bằng
// API key riêng của user. Mỗi job chỉ dùng 1 nguồn (chọn trước khi Start).
export type TtsProvider = 'genvoice' | 'elevenlabs'

export const TTS_PROVIDER_LABELS: Record<TtsProvider, string> = {
  genvoice: 'GenVoice',
  elevenlabs: 'ElevenLabs'
}

// Số luồng song song mặc định theo nguồn. ElevenLabs giới hạn số request
// chạy cùng lúc theo gói (Starter ~3, Creator ~5, Pro ~10...) — vượt thì trả
// 429, app tự đợi + thử lại, nhưng đặt đúng thì nhanh hơn.
export const DEFAULT_CONCURRENCY: Record<TtsProvider, number> = {
  genvoice: 4,
  elevenlabs: 3
}

// Thông tin tài khoản đã chuẩn hoá cho cả 2 nguồn — UI chỉ cần biết còn bao
// nhiêu "đơn vị" (credit GenVoice / ký tự ElevenLabs) để ước tính trước job.
export interface AccountInfo {
  provider: TtsProvider
  label: string // email (GenVoice) hoặc "Gói <tier>" (ElevenLabs)
  // null = không đọc được số dư (vd. API key ElevenLabs bị giới hạn quyền
  // user_read) — khi đó không chặn Start theo số dư.
  remaining: number | null
  limit?: number
  unit: string // "credit" | "ký tự"
}

export interface GenvoiceAccount {
  id: string
  email: string
  name: string
  avatar_url: string
  credit_balance: number
  role: string
  tenant_id: string
}

export interface GenvoiceModel {
  model_id: string
  name: string
  description: string
  can_do_text_to_speech: boolean
  can_do_voice_conversion: boolean
  can_use_style: boolean
  can_use_speaker_boost: boolean
  can_be_finetuned: boolean
  // Chỉ ElevenLabs gốc trả field này — danh sách ngôn ngữ model hỗ trợ.
  languages?: { language_id: string; name: string }[]
  [key: string]: unknown
}

export interface GenvoiceLanguage {
  code: string
  name: string
}

export type VoiceEngine = 'elevenlabs' | 'minimax' | 'capcut'

export interface GenvoiceVoice {
  voice_id: string
  name: string
  description?: string
  engine: VoiceEngine
  previewUrl?: string
}

// Mirrors ElevenLabs voice_settings naming. CONFIRMED server có áp dụng
// (CLAUDE.md mục 2.3).
export interface VoiceSettings {
  stability: number // 0-100 in UI, gửi lên dạng 0-1
  similarity_boost: number // 0-100 in UI, gửi lên dạng 0-1
  style: number // 0-100 in UI, gửi lên dạng 0-1
  use_speaker_boost: boolean
  speed: number // 0.7 - 1.2 (ElevenLabs range), mặc định 1.0
}

export type TtsTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | string

// Khớp response thật của GET /v1/history/{id} — xem CLAUDE.md mục 2.3
export interface GenvoiceTask {
  id: string
  user_id: string
  status: TtsTaskStatus
  progress: number
  provider: VoiceEngine
  text: string
  voice_id: string
  model_id: string
  name: string
  metadata: {
    language_code: string
    export_transcript: boolean
    voice_name: string
  }
  result: { audio_url: string } | null
  characters_used: number
  credits_deducted: number
  error: string | null
  detail_error: string | null
  created_at: string
  updated_at: string
}

export type JobItemStatus =
  | 'pending'
  | 'submitting'
  | 'queued_on_server'
  | 'polling'
  | 'rate_limited'
  | 'done'
  | 'error'
  | 'skipped'
  // Đã submit (có taskId, credit đã trừ) nhưng chưa tải được audio về — do
  // Stop, timeout poll, mất mạng hoặc app bị tắt. "Chạy tiếp" chỉ poll + tải
  // lại theo taskId, KHÔNG submit lại (không tốn credit lần 2).
  | 'interrupted'

export interface JobItem {
  id: string
  groupId: string
  index: number
  sourceText: string
  status: JobItemStatus
  taskId?: string
  outputAudioPath?: string
  errorMessage?: string
  durationMs?: number
  creditsDeducted?: number
}

// 1 group = 1 "nguồn" audio sẽ ghép + đặt tên chung: hoặc văn bản gõ tay (dùng
// "Thư mục output" đã chọn, tên mặc định "joined"), hoặc 1 file import (dùng
// folder cùng tên tạo cạnh file gốc — xem CLAUDE.md mục "Import file → tự tạo
// folder + đặt tên theo file gốc").
export interface BatchGroup {
  id: string
  outputDir: string
  outputBaseName: string
}

export interface BatchJobConfig {
  // Không có ở job lưu từ bản cũ (trước khi hỗ trợ ElevenLabs) → coi là 'genvoice'.
  provider?: TtsProvider
  // Số item chạy song song. Không có → DEFAULT_CONCURRENCY theo provider.
  concurrency?: number
  voiceId: string
  modelId: string
  // ElevenLabs: '' = không gửi language_code (tự nhận diện) — nhiều model
  // ElevenLabs báo lỗi nếu gửi language_code.
  languageCode: string
  voiceSettingsEnabled: boolean
  voiceSettings: VoiceSettings
  groups: BatchGroup[]
  items: { id: string; groupId: string; index: number; sourceText: string }[]
  autoGenerateSrt: boolean
  joinAudio: boolean
  // Khoảng lặng (giây) chèn giữa các đoạn khi Join Mp3 — để user dễ nhận ra
  // ranh giới từng đoạn khi cần cắt. 0 = nối liền như cũ.
  joinGapSeconds: number
}

// Kết quả main process trả về khi import 1 file (.txt/.srt/.dgt) — main process
// tự tính sẵn outputDir (folder mới cùng tên, cạnh file gốc) + outputBaseName
// (tên file gốc không kèm đuôi) vì đây là logic path/fs, không nên làm ở
// renderer. `content`/`ext` để renderer tự quyết định cách tách đoạn (theo
// Auto Split hiện tại của user) thay vì cố định lúc import.
export interface ImportedFileGroup {
  filePath: string
  ext: string
  content: string
  outputDir: string
  outputBaseName: string
}

export interface BatchProgressEvent {
  jobId: string
  items: JobItem[]
  done: number
  processing: number
  total: number
  elapsedMs: number
  finished: boolean
  stopped: boolean
  // Tên (outputBaseName) các group KHÔNG được ghép vì còn đoạn chưa xong —
  // ghép thiếu câu mà không báo còn tệ hơn không ghép. Chỉ có ở event cuối.
  incompleteGroups?: string[]
}

// Trạng thái batch job lưu xuống đĩa (userData/current-job.json) sau mỗi thay
// đổi — để chạy tiếp sau khi Stop/crash/tắt app, hoặc chạy lại các đoạn lỗi.
// KHÔNG chứa API key. Chạy tiếp luôn dùng lại đúng voice/model/settings của
// job gốc (config), không dùng lựa chọn hiện tại trên UI.
export interface SavedBatchJob {
  version: 1
  createdAt: number
  config: BatchJobConfig
  items: JobItem[]
}

// Kết quả khi bấm Start/Chạy tiếp: `cancelled` = user bấm Huỷ ở hộp thoại
// hỏi xoá file audio cũ trong thư mục output.
export interface BatchStartResult {
  cancelled: boolean
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 50,
  similarity_boost: 75,
  style: 0,
  use_speaker_boost: false,
  speed: 1.0
}

export const DEFAULT_AUTO_SPLIT_DELIMITERS = '.,;:!?'

export const DEFAULT_JOIN_GAP_SECONDS = 1.5
