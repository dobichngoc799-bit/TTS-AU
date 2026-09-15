import { promises as fs } from 'fs'
import { join } from 'path'
import axios from 'axios'
import * as genvoiceApi from '../services/genvoiceApi'
import { getAudioDurationMs, joinMp3Files } from '../services/ffmpegService'
import { buildSrt } from '../services/srtService'
import type { BatchGroup, BatchJobConfig, BatchProgressEvent, JobItem } from '../../shared/types'

export type ProgressCallback = (event: BatchProgressEvent) => void

// Chạy 1 batch job: với mỗi item, submit -> poll -> tải audio về outputDir
// của group nó thuộc về (mỗi group = 1 "nguồn": văn bản gõ tay dùng "Thư mục
// output" đã chọn, hoặc 1 file import dùng folder riêng cạnh file gốc — xem
// BatchGroup trong shared/types.ts). Chạy CONCURRENCY item song song (worker
// pool đơn giản, không dùng thư viện ngoài) để tăng tốc — rate limit GenVoice
// quan sát được ~2000 request (xem CLAUDE.md mục 2.1), CONCURRENCY=4 vẫn rất
// an toàn so với mức đó.
export class BatchJobRunner {
  private static readonly CONCURRENCY = 4

  private stopped = false
  private readonly startedAt = Date.now()
  private readonly groupsById = new Map<string, BatchGroup>()

  constructor(
    private readonly apiKey: string,
    private readonly job: BatchJobConfig,
    private readonly onProgress: ProgressCallback
  ) {
    for (const g of job.groups) this.groupsById.set(g.id, g)
  }

  stop(): void {
    this.stopped = true
  }

  async run(): Promise<JobItem[]> {
    const items: JobItem[] = this.job.items.map((i) => ({
      id: i.id,
      groupId: i.groupId,
      index: i.index,
      sourceText: i.sourceText,
      status: 'pending'
    }))

    for (const group of this.job.groups) {
      await fs.mkdir(group.outputDir, { recursive: true })
    }
    this.emit(items, false)

    let cursor = 0
    const takeNext = (): JobItem | undefined => (cursor < items.length ? items[cursor++] : undefined)

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.stopped) return
        const item = takeNext()
        if (!item) return
        await this.processItem(item)
        this.emit(items, false)
      }
    }

    const workerCount = Math.min(BatchJobRunner.CONCURRENCY, items.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    for (const item of items) {
      if (item.status === 'pending') item.status = 'skipped'
    }

    if (!this.stopped && this.job.joinAudio) {
      await this.joinAndMaybeWriteSrt(items)
    }

    this.emit(items, true)
    return items
  }

  private async processItem(item: JobItem): Promise<void> {
    const group = this.groupsById.get(item.groupId)
    if (!group) {
      item.status = 'error'
      item.errorMessage = `Không tìm thấy group "${item.groupId}" cho item này (lỗi nội bộ)`
      return
    }

    try {
      item.status = 'submitting'
      this.emit(undefined, false)

      const { id: taskId } = await genvoiceApi.submitTextToSpeech(this.apiKey, {
        voiceId: this.job.voiceId,
        text: item.sourceText,
        modelId: this.job.modelId,
        languageCode: this.job.languageCode,
        voiceSettings: this.job.voiceSettingsEnabled ? this.job.voiceSettings : undefined
      })
      item.taskId = taskId
      item.status = 'polling'
      this.emit(undefined, false)

      const runner = this
      const task = await genvoiceApi.pollTaskUntilDone(this.apiKey, taskId, {
        signal: {
          get aborted() {
            return runner.stopped
          }
        }
      })

      if (task.status !== 'completed' || !task.result) {
        throw new Error(task.error ?? `Task kết thúc với status "${task.status}" (không rõ lỗi)`)
      }

      const outputPath = join(group.outputDir, `${String(item.index + 1).padStart(3, '0')}.mp3`)
      await this.downloadFile(task.result.audio_url, outputPath)

      item.outputAudioPath = outputPath
      item.creditsDeducted = task.credits_deducted
      item.durationMs = await getAudioDurationMs(outputPath)
      item.status = 'done'
    } catch (err) {
      item.status = 'error'
      item.errorMessage = err instanceof Error ? err.message : String(err)
    }
  }

  // audio_url là URL public (không cần xi-api-key) — CONFIRMED, xem CLAUDE.md mục 2.3.
  // File chỉ tồn tại ~48h trên server GenVoice nên phải tải về ngay.
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
    await fs.writeFile(destPath, Buffer.from(res.data))
  }

  // Ghép + đặt tên riêng cho TỪNG group — group từ file import sẽ ra file ghép
  // trùng tên file gốc (vd MyText.mp3/.srt), group văn bản gõ tay ra
  // joined.mp3/.srt như cũ.
  private async joinAndMaybeWriteSrt(items: JobItem[]): Promise<void> {
    for (const group of this.job.groups) {
      const done = items.filter(
        (i) => i.groupId === group.id && i.status === 'done' && i.outputAudioPath
      )
      if (done.length === 0) continue

      const joinedPath = join(group.outputDir, `${group.outputBaseName}.mp3`)
      await joinMp3Files(
        done.map((i) => i.outputAudioPath!),
        joinedPath
      )

      if (this.job.autoGenerateSrt) {
        const srt = buildSrt(done.map((i) => ({ text: i.sourceText, durationMs: i.durationMs ?? 0 })))
        await fs.writeFile(join(group.outputDir, `${group.outputBaseName}.srt`), srt, 'utf-8')
      }
    }
  }

  private emit(items: JobItem[] | undefined, finished: boolean): void {
    const snapshot = items ?? this.lastItems
    this.lastItems = snapshot
    const done = snapshot.filter((i) => i.status === 'done').length
    const processing = snapshot.filter(
      (i) => i.status === 'submitting' || i.status === 'polling' || i.status === 'queued_on_server'
    ).length
    this.onProgress({
      jobId: String(this.startedAt),
      items: snapshot,
      done,
      processing,
      total: snapshot.length,
      elapsedMs: Date.now() - this.startedAt,
      finished,
      stopped: this.stopped
    })
  }

  private lastItems: JobItem[] = []
}
