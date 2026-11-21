import { create } from 'zustand'
import type { AccountInfo, TtsProvider } from '@shared/types'

interface SettingsState {
  // Nguồn đang chọn (GenVoice / ElevenLabs). Mỗi nguồn có API key riêng,
  // `apiKey`/`account` luôn là của nguồn đang chọn.
  provider: TtsProvider
  apiKey: string | null
  account: AccountInfo | null
  outputDir: string | null
  loading: boolean
  error: string | null
  init: () => Promise<void>
  setProvider: (provider: TtsProvider) => Promise<void>
  saveApiKey: (apiKey: string) => Promise<void>
  clearApiKey: () => Promise<void>
  refreshAccount: () => Promise<void>
  pickOutputDir: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  provider: 'genvoice',
  apiKey: null,
  account: null,
  outputDir: null,
  loading: false,
  error: null,

  init: async () => {
    const [provider, outputDir] = await Promise.all([
      window.api.settings.getProvider(),
      window.api.settings.getOutputDir()
    ])
    const apiKey = await window.api.settings.getApiKey(provider)
    set({ provider, apiKey, outputDir })
    if (apiKey) await get().refreshAccount()
  },

  setProvider: async (provider) => {
    if (provider === get().provider) return
    await window.api.settings.setProvider(provider)
    const apiKey = await window.api.settings.getApiKey(provider)
    set({ provider, apiKey, account: null, error: null })
    if (apiKey) await get().refreshAccount()
  },

  saveApiKey: async (apiKey: string) => {
    const provider = get().provider
    set({ loading: true, error: null })
    try {
      // Xác thực key ngay bằng 1 request thật trước khi lưu.
      const account = await window.api.tts.getAccount(provider, apiKey)
      await window.api.settings.setApiKey(provider, apiKey)
      if (get().provider === provider) set({ apiKey, account, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
      throw err
    }
  },

  clearApiKey: async () => {
    await window.api.settings.clearApiKey(get().provider)
    set({ apiKey: null, account: null })
  },

  refreshAccount: async () => {
    const { apiKey, provider } = get()
    if (!apiKey) return
    try {
      const account = await window.api.tts.getAccount(provider, apiKey)
      if (get().provider === provider) set({ account, error: null })
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
