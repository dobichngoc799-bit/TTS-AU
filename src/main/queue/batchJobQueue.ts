import { promises as fs } from 'fs'
import { join } from 'path'
import axios from 'axios'
import * as genvoiceApi from '../services/genvoiceApi'
import { getAudioDurationMs, joinMp3Files } from '../services/ffmpegService'
import { buildSrt } from '../services/srtService'
import type { BatchGroup, BatchJobConfig, BatchProgressEvent, JobItem } from '../../shared/types'

export type ProgressCallback = (event: BatchProgressEvent) => void

// Lỗi "chắc chắn" của 1 item: server báo task hỏng, hoặc file audio đã hết
// hạn 48h. Khác với lỗi mạng/timeout/Stop (item → 'interrupted', giữ taskId
// để tải lại), lỗi này xoá taskId — lần chạy lại sẽ submit mới (tốn credit).
class ItemFailedError extends Error {}

// Chạy 1 batch job: với mỗi item chưa xong, submit (nếu chưa có taskId) →
// poll → tải audio về outputDir của group nó thuộc về (mỗi group = 1 "nguồn":
// văn bản gõ tay dùng "Thư mục output" đã chọn, hoặc 1 file import dùng folder
// riêng cạnh file gốc — xem BatchGroup trong shared/types.ts). Chạy
// CONCURRENCY item song song (worker pool đơn giản). Bị `rate_limit_exceeded`
// thì genvoiceApi tự đợi + thử lại (CLAUDE.md mục 2.1).
//
// `items` có thể là job mới (toàn 'pending') hoặc job đã lưu (Chạy tiếp /
// chạy lại đoạn lỗi): item 'done' còn file thì giữ nguyên, item có taskId thì
// chỉ poll + tải lại, không submit lần 2.
export class BatchJobRunner {
  private static readonly CONCURRENCY = 4 // xem CLAUDE.md mục 2.1 về rate limit
  private static readonly DOWNLOAD_TIMEOUT_MS = 60_000
  private static readonly DOWNLOAD_ATTEMPTS = 3

  private stopped = false
  private readonly startedAt = Date.now()
  private readonly groupsById = new Map<string, BatchGroup>()
  private readonly items: JobItem[]

  constructor(
    private readonly apiKey: string,
    private readonly job: BatchJobConfig,
    items: JobItem[],
    private readonly onProgress: ProgressCallback,
    private readonly persist: (items: JobItem[]) => void = () => {}
  ) {
    for (const g of job.groups) this.groupsById.set(g.id, g)
    this.items = items.map((i) => ({ ...i }))
  }

  stop(): void {
    this.stopped = true
  }

  async run(): Promise<JobItem[]> {
    const items = this.items
    for (const group of this.job.groups) {
      await fs.mkdir(group.outputDir, { recursive: true })
    }

    // Chuẩn bị hàng đợi: item 'done' mà file đã bị xoá thì tải lại theo
    // taskId; mọi item chưa xong khác (lỗi, bỏ qua, đang dở lúc app tắt...)
    // quay về 'pending'.
    const queue: JobItem[] = []
    for (const item of items) {
      if (item.status === 'done' && item.outputAudioPath && (await fileExists(item.outputAudioPath))) {
        continue
      }
      item.status = 'pending'
      item.errorMessage = undefined
      queue.push(item)
    }
    this.emit(false)

    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.stopped) return
        const item = queue[cursor++]
        if (!item) return
        await this.processItem(item)
        this.emit(false)
      }
    }
    const workerCount = Math.min(BatchJobRunner.CONCURRENCY, queue.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    for (const item of items) {
      if (item.status === 'pending') item.status = 'skipped'
    }

    let incompleteGroups: string[] = []
    if (!this.stopped && this.job.joinAudio) {
      incompleteGroups = await this.joinAndMaybeWriteSrt()
    }

    this.emit(true, incompleteGroups)
    return items
  }

  private async processItem(item: JobItem): Promise<void> {
    const group = this.groupsById.get(item.groupId)
    if (!group) {
      item.status = 'error'
      item.errorMessage = `Không tìm thấy group "${item.groupId}" cho item này (lỗi nội bộ)`
      return
    }

    const isStopped = (): boolean => this.stopped
    const signal = {
      get aborted() {
        return isStopped()
      }
    }
    // Bị rate limit: genvoiceApi tự đợi rồi thử lại — chỉ đổi badge sang
    // "Đợi rate limit" trong lúc đợi rồi trả lại trạng thái trước đó.
    let statusBeforeRateLimit = item.status
    const onRateLimited = (waitMs: number): void => {
      if (item.status !== 'rate_limited') statusBeforeRateLimit = item.status
      item.status = 'rate_limited'
      this.emit(false)
      setTimeout(() => {
        if (item.status === 'rate_limited') {
          item.status = statusBeforeRateLimit
          this.emit(false)
        }
      }, waitMs)
    }

    try {
      if (!item.taskId) {
        item.status = 'submitting'
        this.emit(false)
        const { id: taskId } = await genvoiceApi.submitTextToSpeech(
          this.apiKey,
          {
            voiceId: this.job.voiceId,
            text: item.sourceText,
            modelId: this.job.modelId,
            languageCode: this.job.languageCode,
            voiceSettings: this.job.voiceSettingsEnabled ? this.job.voiceSettings : undefined
          },
          { signal, onRateLimited }
        )
        // Từ đây credit đã bị trừ — lưu taskId xuống đĩa ngay.
        item.taskId = taskId
      }
      item.status = 'polling'
      this.emit(false)

      const task = await genvoiceApi.pollTaskUntilDone(this.apiKey, item.taskId, {
        signal,
        onRateLimited
      })

      if (task.status !== 'completed' || !task.result) {
        throw new ItemFailedError(
          task.error ?? `Task kết thúc với status "${task.status}" (không rõ lỗi)`
        )
      }

      const outputPath = join(group.outputDir, `${String(item.index + 1).padStart(3, '0')}.mp3`)
      await this.downloadFile(task.result.audio_url, outputPath)

      item.outputAudioPath = outputPath
      item.creditsDeducted = task.credits_deducted
      item.durationMs = await getAudioDurationMs(outputPath)
      item.status = 'done'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (item.taskId && !(err instanceof ItemFailedError)) {
        // Task đã tạo trên server nhưng chưa tải được (Stop, timeout, mất
        // mạng...) — giữ taskId để "Chạy tiếp" chỉ tải lại, không tốn credit.
        item.status = 'interrupted'
        item.errorMessage = this.stopped
          ? 'Đã dừng — bấm "Chạy tiếp" để tải về (không tốn thêm credit)'
          : `${message} — bấm "Chạy tiếp" để tải lại (không tốn thêm credit)`
      } else {
        if (err instanceof ItemFailedError) item.taskId = undefined
        item.status = 'error'
        item.errorMessage = message
      }
    }
  }

  // audio_url là URL public (không cần xi-api-key) — CONFIRMED, xem CLAUDE.md mục 2.3.
  // File chỉ tồn tại ~48h trên server GenVoice nên phải tải về ngay. Ghi ra
  // `.part` rồi mới rename để không bao giờ để lại file mp3 tải dở.
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const partPath = `${destPath}.part`
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          timeout: BatchJobRunner.DOWNLOAD_TIMEOUT_MS
        })
        await fs.writeFile(partPath, Buffer.from(res.data))
        await fs.rename(partPath, destPath)
        return
      } catch (err) {
        await fs.unlink(partPath).catch(() => {})
        const status = axios.isAxiosError(err) ? err.response?.status : undefined
        // ASSUMPTION: file hết hạn trả 404/410 — chưa quan sát thật.
        if (status === 404 || status === 410) {
          throw new ItemFailedError(
            'File audio đã hết hạn trên server (quá 48h) — chạy lại sẽ tạo mới và tốn credit'
          )
        }
        if (attempt >= BatchJobRunner.DOWNLOAD_ATTEMPTS || this.stopped) throw err
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }
  }

  // Ghép + đặt tên riêng cho TỪNG group — group từ file import ra file ghép
  // trùng tên file gốc (vd MyText.mp3/.srt), group văn bản gõ tay ra
  // joined.mp3/.srt. Group còn đoạn chưa xong thì KHÔNG ghép (file ghép thiếu
  // câu mà không báo là lỗi khó phát hiện) — trả về tên các group đó.
  private async joinAndMaybeWriteSrt(): Promise<string[]> {
    const incomplete: string[] = []
    for (const group of this.job.groups) {
      const groupItems = this.items
        .filter((i) => i.groupId === group.id)
        .sort((a, b) => a.index - b.index)
      if (groupItems.length === 0) continue
      if (groupItems.some((i) => i.status !== 'done' || !i.outputAudioPath)) {
        incomplete.push(group.outputBaseName)
        continue
      }

      const joinedPath = join(group.outputDir, `${group.outputBaseName}.mp3`)
      const gapMs = await joinMp3Files(
        groupItems.map((i) => i.outputAudioPath!),
        joinedPath,
        this.job.joinGapSeconds
      )

      if (this.job.autoGenerateSrt) {
        const srt = buildSrt(
          groupItems.map((i) => ({ text: i.sourceText, durationMs: i.durationMs ?? 0 })),
          gapMs
        )
        await fs.writeFile(join(group.outputDir, `${group.outputBaseName}.srt`), srt, 'utf-8')
      }
    }
    return incomplete
  }

  private emit(finished: boolean, incompleteGroups?: string[]): void {
    const items = this.items
    this.persist(items)
    const done = items.filter((i) => i.status === 'done').length
    const processing = items.filter(
      (i) =>
        i.status === 'submitting' ||
        i.status === 'polling' ||
        i.status === 'queued_on_server' ||
        i.status === 'rate_limited'
    ).length
    this.onProgress({
      jobId: String(this.startedAt),
      items: items.map((i) => ({ ...i })),
      done,
      processing,
      total: items.length,
      elapsedMs: Date.now() - this.startedAt,
      finished,
      stopped: this.stopped,
      incompleteGroups
    })
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
