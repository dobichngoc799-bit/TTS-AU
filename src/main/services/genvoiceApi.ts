import axios, { AxiosInstance } from 'axios'
import type {
  GenvoiceAccount,
  GenvoiceLanguage,
  GenvoiceModel,
  GenvoiceTask,
  GenvoiceVoice,
  VoiceSettings
} from '../../shared/types'

// Toàn bộ call tới GenVoice API tập trung ở đây — xem CLAUDE.md mục 2 & 7
// cho danh sách endpoint đã xác nhận bằng request thật.
const BASE_URL = process.env.GENVOICE_BASE_URL ?? 'https://api.genvoice.pro'

export class GenvoiceApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
    public headers?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'GenvoiceApiError'
  }
}

function client(apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: { 'xi-api-key': apiKey },
    timeout: 30_000
  })
}

function unwrap<T>(promise: Promise<{ data: T }>): Promise<T> {
  return promise
    .then((res) => res.data)
    .catch((err) => {
      if (axios.isAxiosError(err)) {
        const body = err.response?.data
        const message =
          (body && typeof body === 'object' && 'error' in body && String((body as any).error)) ||
          err.message
        throw new GenvoiceApiError(
          message,
          err.response?.status,
          body,
          err.response?.headers as Record<string, unknown> | undefined
        )
      }
      throw err
    })
}

// CONFIRMED (user báo lỗi thật 2026-09-23): chạy batch dài (~40 item) thì
// server trả lỗi `rate_limit_exceeded`. ASSUMPTION: HTTP status là 429 —
// chưa bắt được status thật, nên nhận diện theo cả status lẫn nội dung lỗi.
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof GenvoiceApiError)) return false
  return err.status === 429 || /rate.?limit/i.test(err.message)
}

const RATE_LIMIT_MIN_WAIT_MS = 2_000
const RATE_LIMIT_MAX_WAIT_MS = 60_000
const RATE_LIMIT_MAX_RETRIES = 10

// Thời gian cần đợi trước khi thử lại. Ưu tiên header `retry-after`, rồi
// `x-ratelimit-reset`, cuối cùng là backoff tăng dần (5s, 10s, 20s...).
// ASSUMPTION: `x-ratelimit-reset` "tính theo giây" (CLAUDE.md mục 2.1) nhưng
// chưa rõ là số giây còn lại hay epoch — số lớn (> 1e9) coi là epoch giây.
function rateLimitWaitMs(err: GenvoiceApiError, attempt: number): number {
  const header = (name: string): number | undefined => {
    const n = Number(err.headers?.[name])
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  let waitMs: number
  const retryAfter = header('retry-after')
  const reset = header('x-ratelimit-reset')
  if (retryAfter !== undefined) {
    waitMs = retryAfter * 1000
  } else if (reset !== undefined) {
    waitMs = reset > 1e9 ? reset * 1000 - Date.now() : reset * 1000
  } else {
    waitMs = 5_000 * 2 ** attempt
  }
  return Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(RATE_LIMIT_MIN_WAIT_MS, waitMs))
}

export interface RateLimitOptions {
  signal?: { aborted: boolean }
  // Gọi mỗi lần bắt đầu đợi vì rate limit — để UI hiển thị trạng thái chờ.
  onRateLimited?: (waitMs: number) => void
}

// Gọi `fn`, nếu bị rate limit thì đợi rồi thử lại (tối đa
// RATE_LIMIT_MAX_RETRIES lần). Request bị từ chối vì rate limit không tạo
// task nên thử lại POST không bị trừ credit 2 lần.
async function withRateLimitRetry<T>(fn: () => Promise<T>, opts: RateLimitOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= RATE_LIMIT_MAX_RETRIES) throw err
      const waitMs = rateLimitWaitMs(err as GenvoiceApiError, attempt)
      opts.onRateLimited?.(waitMs)
      await sleep(waitMs, opts.signal)
    }
  }
}

// GET /v1/auth/me — CONFIRMED
export async function getAccount(apiKey: string): Promise<GenvoiceAccount> {
  return unwrap(client(apiKey).get<GenvoiceAccount>('/v1/auth/me'))
}

// GET /v1/models — CONFIRMED
export async function listModels(apiKey: string): Promise<GenvoiceModel[]> {
  return unwrap(client(apiKey).get<GenvoiceModel[]>('/v1/models'))
}

// GET /v1/languages — CONFIRMED
export async function listLanguages(apiKey: string): Promise<GenvoiceLanguage[]> {
  return unwrap(client(apiKey).get<GenvoiceLanguage[]>('/v1/languages'))
}

// GET /v1/default-voices — CONFIRMED. Response: { voices: [...] }
export async function listDefaultVoices(apiKey: string): Promise<GenvoiceVoice[]> {
  const data = await unwrap(client(apiKey).get<{ voices: any[] }>('/v1/default-voices'))
  return data.voices.map((v) => ({ ...v, engine: 'elevenlabs' as const }))
}

export interface ListSharedVoicesParams {
  // CONFIRMED: /v1/shared-voices có phân trang thật (page_size tối đa 100,
  // page 0-indexed cho ra kết quả khác nhau) — không phải trả hết 1 lần.
  search?: string // CONFIRMED: server tự search theo cả name/description LẪN voice_id, không cần tự tải hết về rồi filter client-side.
  page?: number
  pageSize?: number // max 100 — server trả lỗi 400 "invalid_page_size" nếu vượt
}

// GET /v1/shared-voices — CONFIRMED có phân trang (`has_more`) + hỗ trợ
// `search` server-side. KHÔNG gọi không tham số để "tải hết thư viện" (chỉ
// ra trang đầu, gây hiểu nhầm là thư viện chỉ có vài chục voice — xem
// CLAUDE.md mục 7). Luôn truyền `search` khi user gõ tìm kiếm.
export async function listSharedVoices(
  apiKey: string,
  params: ListSharedVoicesParams = {}
): Promise<{ voices: GenvoiceVoice[]; hasMore: boolean }> {
  const data = await unwrap(
    client(apiKey).get<{ voices: any[]; has_more: boolean }>('/v1/shared-voices', {
      params: {
        search: params.search || undefined,
        page: params.page,
        page_size: params.pageSize ?? 100
      }
    })
  )
  return {
    voices: data.voices.map((v) => ({ ...v, engine: 'elevenlabs' as const })),
    hasMore: data.has_more
  }
}

// GET /v1/minimax/voices — CONFIRMED. Response: { voices: [...] }
export async function listMinimaxVoices(apiKey: string): Promise<GenvoiceVoice[]> {
  const data = await unwrap(client(apiKey).get<{ voices: any[] }>('/v1/minimax/voices'))
  return data.voices.map((v) => ({ ...v, engine: 'minimax' as const }))
}

export interface SubmitTtsParams {
  voiceId: string
  text: string
  modelId: string
  languageCode: string
  voiceSettings?: VoiceSettings
}

// POST /v1/text-to-speech/{voiceId} — CONFIRMED, trả 202 { id, status: 'pending' }
export async function submitTextToSpeech(
  apiKey: string,
  params: SubmitTtsParams,
  opts: RateLimitOptions = {}
): Promise<{ id: string; status: string }> {
  const body: Record<string, unknown> = {
    text: params.text,
    model_id: params.modelId,
    language_code: params.languageCode
  }
  // CONFIRMED 2026-09-15: server có áp dụng voice_settings thật — test với
  // speed=0.7 cho cùng 1 đoạn text, duration audio tăng từ 5.64s lên 7.97s
  // (tỉ lệ ~1.41, khớp gần đúng với 1/0.7 ≈ 1.43). Xem CLAUDE.md mục 6.
  if (params.voiceSettings) {
    body.voice_settings = {
      stability: params.voiceSettings.stability / 100,
      similarity_boost: params.voiceSettings.similarity_boost / 100,
      style: params.voiceSettings.style / 100,
      use_speaker_boost: params.voiceSettings.use_speaker_boost,
      speed: params.voiceSettings.speed
    }
  }
  return withRateLimitRetry(
    () =>
      unwrap(
        client(apiKey).post<{ id: string; status: string }>(
          `/v1/text-to-speech/${encodeURIComponent(params.voiceId)}`,
          body
        )
      ),
    opts
  )
}

// GET /v1/history/{id} — CONFIRMED, dùng chung cho text-to-speech/voice-changer/speech-to-text
export async function getTask(apiKey: string, taskId: string): Promise<GenvoiceTask> {
  return unwrap(client(apiKey).get<GenvoiceTask>(`/v1/history/${encodeURIComponent(taskId)}`))
}

export interface PollOptions extends RateLimitOptions {
  intervalMs?: number
  timeoutMs?: number
}

// Poll GET /v1/history/{id} cho tới khi completed/failed hoặc hết timeout.
// ASSUMPTION: chưa quan sát được status 'failed' thật — coi mọi status khác
// pending/processing là kết thúc (completed hoặc lỗi) để không loop vô hạn.
export async function pollTaskUntilDone(
  apiKey: string,
  taskId: string,
  opts: PollOptions = {}
): Promise<GenvoiceTask> {
  const intervalMs = opts.intervalMs ?? 1500
  const timeoutMs = opts.timeoutMs ?? 120_000
  const start = Date.now()
  // Thời gian đợi rate limit không tính vào timeout — task vẫn đang chạy
  // bình thường trên server, chỉ là app tạm không được hỏi trạng thái.
  let rateLimitWaitedMs = 0
  for (;;) {
    if (opts.signal?.aborted) {
      throw new GenvoiceApiError('Batch job stopped by user')
    }
    const task = await withRateLimitRetry(() => getTask(apiKey, taskId), {
      signal: opts.signal,
      onRateLimited: (waitMs) => {
        rateLimitWaitedMs += waitMs
        opts.onRateLimited?.(waitMs)
      }
    })
    if (task.status !== 'pending' && task.status !== 'processing') {
      return task
    }
    if (Date.now() - start - rateLimitWaitedMs > timeoutMs) {
      throw new GenvoiceApiError(`Task ${taskId} timed out after ${timeoutMs}ms while polling`)
    }
    await sleep(intervalMs, opts.signal)
  }
}

// Ngủ `ms`, nhưng thoát sớm nếu user bấm Stop (kiểm tra mỗi 250ms) — để
// Stop có tác dụng ngay cả khi đang đợi rate limit tới 60s.
async function sleep(ms: number, signal?: { aborted: boolean }): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (signal?.aborted) throw new GenvoiceApiError('Batch job stopped by user')
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, end - Date.now())))
  }
}
