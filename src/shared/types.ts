// Types shared between main and renderer. Keep this file free of Node/DOM-specific
// imports so it type-checks under both tsconfig.node.json and tsconfig.web.json.

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

// Mirrors ElevenLabs voice_settings naming. ASSUMPTION: chưa xác nhận GenVoice
// có nhận field này trong body POST /v1/text-to-speech/{voiceId} hay không.
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
  voiceId: string
  modelId: string
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
