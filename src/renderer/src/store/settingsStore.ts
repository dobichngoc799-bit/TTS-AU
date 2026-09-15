import { create } from 'zustand'
import type { GenvoiceAccount } from '@shared/types'

interface SettingsState {
  apiKey: string | null
  account: GenvoiceAccount | null
  outputDir: string | null
  loading: boolean
  error: string | null
  init: () => Promise<void>
  saveApiKey: (apiKey: string) => Promise<void>
  clearApiKey: () => Promise<void>
  refreshAccount: () => Promise<void>
  pickOutputDir: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiKey: null,
  account: null,
  outputDir: null,
  loading: false,
  error: null,

  init: async () => {
    const [apiKey, outputDir] = await Promise.all([
      window.api.settings.getApiKey(),
      window.api.settings.getOutputDir()
    ])
    set({ apiKey, outputDir })
    if (apiKey) await get().refreshAccount()
  },

  saveApiKey: async (apiKey: string) => {
    set({ loading: true, error: null })
    try {
      // Xác thực key ngay bằng 1 request thật trước khi lưu (GET /v1/auth/me)
      const account = await window.api.genvoice.getAccount(apiKey)
      await window.api.settings.setApiKey(apiKey)
      set({ apiKey, account, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
      throw err
    }
  },

  clearApiKey: async () => {
    await window.api.settings.clearApiKey()
    set({ apiKey: null, account: null })
  },

  refreshAccount: async () => {
    const apiKey = get().apiKey
    if (!apiKey) return
    try {
      const account = await window.api.genvoice.getAccount(apiKey)
      set({ account, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  pickOutputDir: async () => {
    const dir = await window.api.dialog.selectOutputDir()
    if (!dir) return
    await window.api.settings.setOutputDir(dir)
    set({ outputDir: dir })
  }
}))
