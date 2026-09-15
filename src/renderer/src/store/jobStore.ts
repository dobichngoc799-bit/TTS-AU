import { create } from 'zustand'
import type {
  BatchGroup,
  BatchJobConfig,
  BatchProgressEvent,
  ImportedFileGroup,
  JobItem,
  VoiceSettings
} from '@shared/types'
import { DEFAULT_AUTO_SPLIT_DELIMITERS } from '@shared/types'

// 1 file import (.txt/.srt/.dgt) = 1 group riêng, tự ghép + đặt tên theo file
// gốc (outputDir/outputBaseName main process đã tính sẵn — xem
// ImportedFileGroup). Giữ `content`+`ext` để tách lại đoạn khi user đổi
// Auto Split sau khi đã import.
export interface ImportedGroup {
  id: string
  outputDir: string
  outputBaseName: string
  ext: string
  content: string
  lines: string[]
}

interface JobState {
  sourceText: string
  sourceLines: string[]
  importedGroups: ImportedGroup[]
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
  addImportedGroups: (groups: ImportedFileGroup[]) => Promise<void>
  clearLines: () => void
  recomputeSourceLines: () => Promise<void>
  recomputeImportedGroups: () => Promise<void>
  setAutoSplitEnabled: (enabled: boolean) => void
  setAutoSplitDelimiters: (delimiters: string) => void
  setAutoGenerateSrt: (enabled: boolean) => void
  setJoinAudio: (enabled: boolean) => void

  start: (
    apiKey: string,
    cfg: {
      voiceId: string
      modelId: string
      languageCode: string
      voiceSettingsEnabled: boolean
      voiceSettings: VoiceSettings
      autoGenerateSrt: boolean
      joinAudio: boolean
      // "Thư mục output" user chọn tay — chỉ dùng cho group văn bản gõ tay
      // (sourceLines). Các group từ file import luôn dùng outputDir riêng
      // (folder cạnh file gốc), không liên quan tới field này.
      manualOutputDir: string | null
    }
  ) => Promise<void>
  stop: () => Promise<void>
}

let importedGroupSeq = 0

// .srt đã có đơn vị tự nhiên theo từng block phụ đề — không áp Auto Split đè
// lên trên, luôn tách theo block gốc (extractLines). .txt/.dgt thì theo Auto
// Split đang bật/tắt, giống hệt cách xử lý văn bản gõ tay.
async function computeLinesForImportedContent(
  content: string,
  ext: string,
  autoSplitEnabled: boolean,
  autoSplitDelimiters: string
): Promise<string[]> {
  if (ext === '.srt') {
    return window.api.text.extractLines(content, ext)
  }
  return autoSplitEnabled
    ? window.api.text.autoSplit(content, autoSplitDelimiters)
    : window.api.text.extractLines(content, ext)
}

export const useJobStore = create<JobState>((set, get) => ({
  sourceText: '',
  sourceLines: [],
  importedGroups: [],
  autoSplitEnabled: false,
  autoSplitDelimiters: DEFAULT_AUTO_SPLIT_DELIMITERS,
  autoGenerateSrt: false,
  joinAudio: true,

  running: false,
  items: [],
  done: 0,
  processing: 0,
  total: 0,
  elapsedMs: 0,

  unsubscribeProgress: null,

  setSourceText: async (text: string) => {
    set({ sourceText: text })
    await get().recomputeSourceLines()
  },

  addImportedGroups: async (groups: ImportedFileGroup[]) => {
    const { autoSplitEnabled, autoSplitDelimiters } = get()
    const newGroups: ImportedGroup[] = await Promise.all(
      groups.map(async (g) => ({
        id: `import-${++importedGroupSeq}`,
        outputDir: g.outputDir,
        outputBaseName: g.outputBaseName,
        ext: g.ext,
        content: g.content,
        lines: await computeLinesForImportedContent(
          g.content,
          g.ext,
          autoSplitEnabled,
          autoSplitDelimiters
        )
      }))
    )
    set((state) => ({ importedGroups: [...state.importedGroups, ...newGroups] }))
  },

  clearLines: () => set({ sourceLines: [], sourceText: '', importedGroups: [] }),

  setAutoSplitEnabled: (enabled) => {
    set({ autoSplitEnabled: enabled })
    void get().recomputeSourceLines()
    void get().recomputeImportedGroups()
  },
  setAutoSplitDelimiters: (delimiters) => {
    set({ autoSplitDelimiters: delimiters })
    void get().recomputeSourceLines()
    void get().recomputeImportedGroups()
  },
  recomputeSourceLines: async () => {
    const { sourceText, autoSplitEnabled, autoSplitDelimiters } = get()
    // Không có gì gõ trong ô textarea (vd. user chỉ Import File/Folder) —
    // đừng đụng vào sourceLines, tránh xoá mất các dòng đã import.
    if (!sourceText.trim()) return
    const lines = autoSplitEnabled
      ? await window.api.text.autoSplit(sourceText, autoSplitDelimiters)
      : sourceText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
    set({ sourceLines: lines })
  },
  recomputeImportedGroups: async () => {
    const { importedGroups, autoSplitEnabled, autoSplitDelimiters } = get()
    if (importedGroups.length === 0) return
    const updated = await Promise.all(
      importedGroups.map(async (g) => ({
        ...g,
        lines: await computeLinesForImportedContent(
          g.content,
          g.ext,
          autoSplitEnabled,
          autoSplitDelimiters
        )
      }))
    )
    set({ importedGroups: updated })
  },
  setAutoGenerateSrt: (enabled) => set({ autoGenerateSrt: enabled }),
  setJoinAudio: (enabled) => set({ joinAudio: enabled }),

  start: async (apiKey, cfg) => {
    const { sourceLines, importedGroups } = get()
    if (sourceLines.length === 0 && importedGroups.length === 0) {
      throw new Error('Chưa có text nào để tạo audio — nhập text hoặc import file trước.')
    }
    if (sourceLines.length > 0 && !cfg.manualOutputDir) {
      throw new Error('Chưa chọn Thư mục output cho phần văn bản gõ tay.')
    }

    const groups: BatchGroup[] = []
    const items: BatchJobConfig['items'] = []
    let seq = 0

    if (sourceLines.length > 0) {
      const groupId = 'manual'
      groups.push({ id: groupId, outputDir: cfg.manualOutputDir!, outputBaseName: 'joined' })
      sourceLines.forEach((text, index) => {
        items.push({ id: `${seq++}`, groupId, index, sourceText: text })
      })
    }

    for (const g of importedGroups) {
      groups.push({ id: g.id, outputDir: g.outputDir, outputBaseName: g.outputBaseName })
      g.lines.forEach((text, index) => {
        items.push({ id: `${seq++}`, groupId: g.id, index, sourceText: text })
      })
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

    set({
      running: true,
      unsubscribeProgress: unsubscribe,
      items: [],
      done: 0,
      processing: 0,
      total: items.length
    })

    try {
      await window.api.batchJob.start(apiKey, {
        voiceId: cfg.voiceId,
        modelId: cfg.modelId,
        languageCode: cfg.languageCode,
        voiceSettingsEnabled: cfg.voiceSettingsEnabled,
        voiceSettings: cfg.voiceSettings,
        autoGenerateSrt: cfg.autoGenerateSrt,
        joinAudio: cfg.joinAudio,
        groups,
        items
      })
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
