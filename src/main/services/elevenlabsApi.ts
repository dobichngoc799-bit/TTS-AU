import axios, { AxiosInstance } from 'axios'
import type {
  AccountInfo,
  GenvoiceLanguage,
  GenvoiceModel,
  GenvoiceVoice,
  VoiceSettings
} from '../../shared/types'
import { withRateLimitRetry, type RateLimitOptions } from './rateLimit'

// Toàn bộ call thẳng tới ElevenLabs API (dùng API key ElevenLabs riêng của
// user, KHÔNG qua GenVoice) tập trung ở đây. Theo tài liệu công khai của
// ElevenLabs — CHƯA test bằng key thật trong app này, mọi chỗ chưa xác nhận
// đều đánh dấu ASSUMPTION (xem CLAUDE.md mục 2.5).
//
// Khác biệt chính so với GenVoice:
// - POST /v1/text-to-speech/{voice_id} trả THẲNG file mp3 (đồng bộ), không có
//   task id / polling / audio_url → không có "Chạy tiếp chỉ tải lại".
// - Số dư là quota ký tự theo tháng (/v1/user/subscription), không phải credit.
// - Không có /v1/languages; ngôn ngữ lấy từ field `languages` của từng model.
const BASE_URL = process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io'

export class ElevenlabsApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public headers?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ElevenlabsApiError'
  }
}

function client(apiKey: string, timeout = 30_000): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: { 'xi-api-key': apiKey },
    timeout
  })
}

// ElevenLabs trả lỗi dạng `{ detail: { status, message } }`, `{ detail: "..." }`
// hoặc (422 validation) `{ detail: [{ msg, loc }] }`. Body có thể là
// ArrayBuffer khi request đặt responseType 'arraybuffer' (endpoint TTS).
function parseErrorBody(raw: unknown): { message?: string; code?: string } {
  let body = raw
  if (body instanceof ArrayBuffer || Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(Buffer.from(body as ArrayBuffer).toString('utf-8'))
    } catch {
      return {}
    }
  }
  if (!body || typeof body !== 'object') return {}
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return { message: detail }
  if (Array.isArray(detail)) {
    return {
      message: detail
        .map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d))
        .join('; ')
    }
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { message?: string; status?: string }
    return { message: d.message, code: d.status }
  }
  return {}
}

function toApiError(err: unknown): unknown {
  if (!axios.isAxiosError(err)) return err
  const { message, code } = parseErrorBody(err.response?.data)
  return new ElevenlabsApiError(
    message || err.message,
    err.response?.status,
    code,
    err.response?.headers as Record<string, unknown> | undefined
  )
}

function unwrap<T>(promise: Promise<{ data: T }>): Promise<T> {
  return promise
    .then((res) => res.data)
    .catch((err) => {
      throw toApiError(err)
    })
}

// 429 = vượt số request đồng thời của gói (`too_many_concurrent_requests`) hoặc
// server bận (`system_busy`) — đều nên đợi rồi thử lại. ASSUMPTION theo tài
// liệu ElevenLabs, chưa bắt được response thật.
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof ElevenlabsApiError)) return false
  return (
    err.status === 429 ||
    err.code === 'too_many_concurrent_requests' ||
    err.code === 'system_busy'
  )
}

// Lỗi chắc chắn không tự khỏi khi thử lại (key sai, hết quota, voice không
// dùng được, text không hợp lệ...) — phân biệt với lỗi mạng/timeout.
export function isPermanentError(err: unknown): boolean {
  return (
    err instanceof ElevenlabsApiError &&
    err.status !== undefined &&
    err.status >= 400 &&
    err.status < 500 &&
    !isRateLimitError(err)
  )
}

// GET /v1/user/subscription → quota ký tự theo tháng. API key ElevenLabs có
// thể bị giới hạn quyền (không có user_read) → 401 `missing_permissions`; khi
// đó vẫn chấp nhận key nếu gọi được /v1/models, chỉ là không hiện số dư.
export async function getAccount(apiKey: string): Promise<AccountInfo> {
  try {
    const sub = await unwrap(
      client(apiKey).get<{
        tier?: string
        character_count: number
        character_limit: number
      }>('/v1/user/subscription')
    )
    return {
      provider: 'elevenlabs',
      label: `ElevenLabs · gói ${sub.tier ?? '?'}`,
      remaining: Math.max(0, sub.character_limit - sub.character_count),
      limit: sub.character_limit,
      unit: 'ký tự'
    }
  } catch (err) {
    if (err instanceof ElevenlabsApiError && err.code === 'missing_permissions') {
      await listModels(apiKey) // key sai thì lỗi ở đây
      return {
        provider: 'elevenlabs',
        label: 'ElevenLabs (key không có quyền xem số dư)',
        remaining: null,
        unit: 'ký tự'
      }
    }
    throw err
  }
}

// GET /v1/models — cùng schema GenvoiceModel, có thêm `languages`.
export async function listModels(apiKey: string): Promise<GenvoiceModel[]> {
  return unwrap(client(apiKey).get<GenvoiceModel[]>('/v1/models'))
}

// Không có endpoint riêng — gộp `languages` của mọi model TTS, bỏ trùng.
export function languagesFromModels(models: GenvoiceModel[]): GenvoiceLanguage[] {
  const byCode = new Map<string, string>()
  for (const m of models) {
    if (!m.can_do_text_to_speech) continue
    for (const l of m.languages ?? []) {
      if (!byCode.has(l.language_id)) byCode.set(l.language_id, l.name)
    }
  }
  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Field voice thô từ ElevenLabs — chỉ khai báo phần app dùng.
interface RawVoice {
  voice_id: string
  name: string
  description?: string | null
  category?: string | null
  preview_url?: string | null
}

function mapVoice(v: RawVoice): GenvoiceVoice {
  return {
    voice_id: v.voice_id,
    name: v.name,
    description: v.description ?? v.category ?? undefined,
    engine: 'elevenlabs',
    previewUrl: v.preview_url ?? undefined
  }
}

// GET /v1/voices — các voice ĐÃ có trong tài khoản (premade + đã thêm từ
// Library + voice clone). Đây là danh sách chắc chắn dùng được qua API.
export async function listMyVoices(apiKey: string): Promise<GenvoiceVoice[]> {
  const data = await unwrap(client(apiKey).get<{ voices: RawVoice[] }>('/v1/voices'))
  return data.voices.map(mapVoice)
}

export interface ListSharedVoicesParams {
  search?: string
  page?: number
  pageSize?: number
}

// GET /v1/shared-voices — Voice Library cộng đồng, có phân trang (`has_more`).
// ASSUMPTION: voice Library chưa thêm vào tài khoản có thể không dùng được
// trực tiếp qua API (tuỳ gói) — lỗi khi tạo audio sẽ kèm gợi ý thêm vào My
// Voices trên web ElevenLabs.
export async function listSharedVoices(
  apiKey: string,
  params: ListSharedVoicesParams = {}
): Promise<{ voices: GenvoiceVoice[]; hasMore: boolean }> {
  const data = await unwrap(
    client(apiKey).get<{ voices: RawVoice[]; has_more: boolean }>('/v1/shared-voices', {
      params: {
        search: params.search || undefined,
        page: params.page,
        page_size: params.pageSize ?? 100
      }
    })
  )
  return { voices: data.voices.map(mapVoice), hasMore: data.has_more }
}

export interface SynthesizeParams {
  voiceId: string
  text: string
  modelId: string
  languageCode: string // '' = không gửi
  voiceSettings?: VoiceSettings
}

export interface SynthesizeResult {
  audio: Buffer
  // ASSUMPTION: header `x-character-count` = số ký tự bị tính — không có thì
  // dùng độ dài text.
  charactersUsed: number
}

// POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128 — trả thẳng
// bytes mp3. Cố định mp3_44100_128 để mọi đoạn cùng sample rate → Join Mp3
// (concat không re-encode) chạy đúng.
export async function synthesize(
  apiKey: string,
  params: SynthesizeParams,
  opts: RateLimitOptions = {}
): Promise<SynthesizeResult> {
  const body: Record<string, unknown> = {
    text: params.text,
    model_id: params.modelId
  }
  if (params.languageCode) body.language_code = params.languageCode
  if (params.voiceSettings) {
    body.voice_settings = {
      stability: params.voiceSettings.stability / 100,
      similarity_boost: params.voiceSettings.similarity_boost / 100,
      style: params.voiceSettings.style / 100,
      use_speaker_boost: params.voiceSettings.use_speaker_boost,
      speed: params.voiceSettings.speed
    }
  }

  const call = async (): Promise<SynthesizeResult> => {
    try {
      const res = await client(apiKey, 120_000).post<ArrayBuffer>(
        `/v1/text-to-speech/${encodeURIComponent(params.voiceId)}`,
        body,
        {
          params: { output_format: 'mp3_44100_128' },
          responseType: 'arraybuffer',
          headers: { Accept: 'audio/mpeg' }
        }
      )
      const counted = Number(res.headers['x-character-count'])
      return {
        audio: Buffer.from(res.data),
        charactersUsed: Number.isFinite(counted) && counted > 0 ? counted : params.text.length
      }
    } catch (err) {
      const apiErr = toApiError(err)
      if (apiErr instanceof ElevenlabsApiError) apiErr.message = explain(apiErr)
      throw apiErr
    }
  }
  return withRateLimitRetry(call, isRateLimitError, opts)
}

// Thêm gợi ý tiếng Việt cho các lỗi hay gặp. ASSUMPTION: các mã `status`
// lấy theo tài liệu ElevenLabs.
function explain(err: ElevenlabsApiError): string {
  switch (err.code) {
    case 'quota_exceeded':
      return `Hết quota ký tự ElevenLabs — ${err.message}`
    case 'voice_not_found':
      return `Không tìm thấy voice — nếu là voice từ Library, thêm vào My Voices trên web ElevenLabs rồi thử lại (${err.message})`
    case 'invalid_api_key':
      return `API key ElevenLabs không hợp lệ (${err.message})`
    case 'unsupported_language':
    case 'invalid_language_code':
      return `Model này không nhận Language đã chọn — chọn "Tự nhận diện" (${err.message})`
    default:
      return err.message
  }
}
