import { create } from 'zustand'
import type { BatchJobConfig, BatchProgressEvent, JobItem } from '@shared/types'
import { DEFAULT_AUTO_SPLIT_DELIMITERS } from '@shared/types'

interface JobState {
  sourceLines: string[]
  autoSplitEnabled: boolean
  autoSplitDelimiters: string
  autoGenerateSrt: boolean
  joinAudio: boolean

  running: boolean
  items: JobItem[]
  done: number
  processing: number
  total: number
  elapsedMs: number

  unsubscribeProgress: (() => void) | null

  setSourceText: (text: string) => Promise<void>
  addLines: (lines: string[]) => void
  clearLines: () => void
  setAutoSplitEnabled: (enabled: boolean) => void
  setAutoSplitDelimiters: (delimiters: string) => void
  setAutoGenerateSrt: (enabled: boolean) => void
  setJoinAudio: (enabled: boolean) => void

  start: (apiKey: string, cfg: Omit<BatchJobConfig, 'items'>) => Promise<void>
  stop: () => Promise<void>
}

export const useJobStore = create<JobState>((set, get) => ({
  sourceLines: [],
  autoSplitEnabled: true,
  autoSplitDelimiters: DEFAULT_AUTO_SPLIT_DELIMITERS,
  autoGenerateSrt: true,
  joinAudio: true,

  running: false,
  items: [],
  done: 0,
  processing: 0,
  total: 0,
  elapsedMs: 0,

  unsubscribeProgress: null,

  setSourceText: async (text: string) => {
    const { autoSplitEnabled, autoSplitDelimiters } = get()
    const lines = autoSplitEnabled
      ? await window.api.text.autoSplit(text, autoSplitDelimiters)
      : text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
    set({ sourceLines: lines })
  },

  addLines: (lines) => set((state) => ({ sourceLines: [...state.sourceLines, ...lines] })),
  clearLines: () => set({ sourceLines: [] }),
  setAutoSplitEnabled: (enabled) => set({ autoSplitEnabled: enabled }),
  setAutoSplitDelimiters: (delimiters) => set({ autoSplitDelimiters: delimiters }),
  setAutoGenerateSrt: (enabled) => set({ autoGenerateSrt: enabled }),
  setJoinAudio: (enabled) => set({ joinAudio: enabled }),

  start: async (apiKey, cfg) => {
    const { sourceLines } = get()
    if (sourceLines.length === 0) {
      throw new Error('Chưa có text nào để tạo audio — nhập text hoặc import file trước.')
    }

    get().unsubscribeProgress?.()
    const unsubscribe = window.api.batchJob.onProgress((event: BatchProgressEvent) => {
      set({
        items: event.items,
        done: event.done,
        processing: event.processing,
        total: event.total,
        elapsedMs: event.elapsedMs,
        running: !event.finished
      })
    })

    const items = sourceLines.map((text, index) => ({ id: `${index}`, index, sourceText: text }))
    set({ running: true, unsubscribeProgress: unsubscribe, items: [], done: 0, processing: 0, total: items.length })

    try {
      await window.api.batchJob.start(apiKey, { ...cfg, items })
    } finally {
      set({ running: false })
      get().unsubscribeProgress?.()
      set({ unsubscribeProgress: null })
    }
  },

  stop: async () => {
    await window.api.batchJob.stop()
  }
}))
