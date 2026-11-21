// Tự đợi + thử lại khi bị rate limit — dùng chung cho genvoiceApi.ts và
// elevenlabsApi.ts. Mỗi API tự quyết định lỗi nào là "rate limit".

export interface HttpErrorLike {
  message: string
  status?: number
  headers?: Record<string, unknown>
}

export interface RateLimitOptions {
  signal?: { aborted: boolean }
  // Gọi mỗi lần bắt đầu đợi vì rate limit — để UI hiển thị trạng thái chờ.
  onRateLimited?: (waitMs: number) => void
}

const RATE_LIMIT_MIN_WAIT_MS = 2_000
const RATE_LIMIT_MAX_WAIT_MS = 60_000
const RATE_LIMIT_MAX_RETRIES = 10

export class StoppedError extends Error {
  constructor() {
    super('Batch job stopped by user')
    this.name = 'StoppedError'
  }
}

// Thời gian cần đợi trước khi thử lại. Ưu tiên header `retry-after`, rồi
// `x-ratelimit-reset`, cuối cùng là backoff tăng dần (5s, 10s, 20s...).
// ASSUMPTION: `x-ratelimit-reset` "tính theo giây" (CLAUDE.md mục 2.1) nhưng
// chưa rõ là số giây còn lại hay epoch — số lớn (> 1e9) coi là epoch giây.
function rateLimitWaitMs(err: HttpErrorLike, attempt: number): number {
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

// Gọi `fn`, nếu bị rate limit thì đợi rồi thử lại (tối đa
// RATE_LIMIT_MAX_RETRIES lần). Request bị từ chối vì rate limit không tạo
// task / không tạo audio nên thử lại không bị trừ credit 2 lần.
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  isRateLimit: (err: unknown) => boolean,
  opts: RateLimitOptions = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isRateLimit(err) || attempt >= RATE_LIMIT_MAX_RETRIES) throw err
      const waitMs = rateLimitWaitMs(err as HttpErrorLike, attempt)
      opts.onRateLimited?.(waitMs)
      await sleep(waitMs, opts.signal)
    }
  }
}

// Ngủ `ms`, nhưng thoát sớm nếu user bấm Stop (kiểm tra mỗi 250ms) — để
// Stop có tác dụng ngay cả khi đang đợi rate limit tới 60s.
export async function sleep(ms: number, signal?: { aborted: boolean }): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (signal?.aborted) throw new StoppedError()
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, end - Date.now())))
  }
}
