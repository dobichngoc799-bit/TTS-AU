import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { BatchGroup, BatchJobConfig, JobItem, SavedBatchJob } from '../../shared/types'

// Lưu trạng thái batch job đang/đã chạy xuống đĩa để không mất taskId của các
// task đã trừ credit khi Stop/crash/tắt app — audio vẫn còn trên server 48h
// (CLAUDE.md mục 2.3) nên chỉ cần taskId là tải lại được. Chỉ giữ 1 job gần
// nhất. KHÔNG lưu API key ở đây.
const JOB_FILE = (): string => join(app.getPath('userData'), 'current-job.json')

export async function loadSavedJob(): Promise<SavedBatchJob | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(JOB_FILE(), 'utf-8')) as SavedBatchJob
    return parsed?.version === 1 && Array.isArray(parsed.items) ? parsed : null
  } catch {
    return null
  }
}

export async function clearSavedJob(): Promise<void> {
  await fs.unlink(JOB_FILE()).catch(() => {})
}

// Ghi ra file tạm rồi rename để app bị tắt giữa lúc ghi cũng không làm hỏng
// file đang có.
async function writeSavedJob(job: SavedBatchJob): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${JOB_FILE()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(job), 'utf-8')
  await fs.rename(tmp, JOB_FILE())
}

// Worker pool gọi persist rất dày (mỗi lần đổi trạng thái item) — gộp lại:
// tối đa 1 lần ghi đang chạy + 1 lần ghi chờ (luôn là snapshot mới nhất).
export function createJobPersister(
  config: BatchJobConfig,
  createdAt: number
): { persist: (items: JobItem[]) => void; flush: () => Promise<void> } {
  let writing: Promise<void> | null = null
  let pending: JobItem[] | null = null

  const drain = async (): Promise<void> => {
    while (pending) {
      const items = pending
      pending = null
      await writeSavedJob({ version: 1, createdAt, config, items }).catch((err) =>
        console.error('Không ghi được trạng thái job:', err)
      )
    }
    writing = null
  }

  return {
    persist(items) {
      pending = items.map((i) => ({ ...i }))
      if (!writing) writing = drain()
    },
    async flush() {
      while (writing) await writing
    }
  }
}

// File audio lẻ do app tạo (001.mp3, 002.mp3...) + file ghép/srt của group.
const NUMBERED_MP3 = /^\d{3,}\.mp3(\.part)?$/

// Liệt kê file audio/srt CŨ do app tạo ra trong thư mục output của các group
// — chạy job mới với ít đoạn hơn lần trước thì các file số lớn cũ sẽ nằm lẫn
// vào, và file ghép cũ trông như kết quả mới nếu lần này không ghép được.
// Chỉ nhận đúng pattern tên app tự đặt, không đụng file khác của user.
export async function findStaleOutputs(groups: BatchGroup[]): Promise<string[]> {
  const found: string[] = []
  for (const g of groups) {
    let names: string[]
    try {
      names = await fs.readdir(g.outputDir)
    } catch {
      continue // folder chưa tồn tại
    }
    const joinedNames = new Set([`${g.outputBaseName}.mp3`, `${g.outputBaseName}.srt`])
    for (const name of names) {
      if (NUMBERED_MP3.test(name) || joinedNames.has(name)) found.push(join(g.outputDir, name))
    }
  }
  return found
}
