import { create } from 'zustand'
import type { GenvoiceLanguage, GenvoiceModel, GenvoiceVoice, VoiceSettings } from '@shared/types'
import { DEFAULT_VOICE_SETTINGS } from '@shared/types'

interface VoiceState {
  models: GenvoiceModel[]
  languages: GenvoiceLanguage[]
  voices: GenvoiceVoice[] // GET /v1/default-voices — load ngay khi mở app, danh sách nhỏ cố định
  loading: boolean
  error: string | null

  // Tìm kiếm trong toàn bộ thư viện GenVoice (GET /v1/shared-voices, CONFIRMED
  // có phân trang thật + hỗ trợ `search` server-side theo cả tên LẪN voice_id
  // — xem CLAUDE.md mục 7). KHÔNG tải cả thư viện về rồi lọc ở client.
  searchQuery: string
  searchResults: GenvoiceVoice[]
  searchHasMore: boolean
  searchPage: number
  searching: boolean
  searchError: string | null

  // Cache mọi voice đã từng "thấy" (từ default-voices, search, hoặc tra bằng
  // ID trực tiếp) theo voice_id — để hiển thị đúng tên cho voice đang chọn dù
  // nó không nằm trong danh sách đang render lúc đó.
  resolvedVoicesById: Record<string, GenvoiceVoice>

  selectedModelId: string
  selectedVoiceId: string
  selectedLanguageCode: string
  voiceSettingsEnabled: boolean
  voiceSettings: VoiceSettings

  loadAll: (apiKey: string) => Promise<void>
  searchLibrary: (apiKey: string, query: string) => Promise<void>
  loadMoreSearchResults: (apiKey: string) => Promise<void>
  clearSearch: () => void
  // Tra đúng 1 voice_id user dán vào — gọi khi user biết chính xác ID muốn
  // dùng, không cần chờ gõ tìm theo tên. Nếu server không tìm thấy (voice
  // riêng tư/không thuộc shared-voices), vẫn chọn ID đó luôn để user có thể
  // dùng ngay, kèm cảnh báo chưa xác minh được tên thật.
  resolveVoiceId: (apiKey: string, voiceId: string) => Promise<{ found: boolean }>
  setSelectedVoiceId: (id: string, knownVoice?: GenvoiceVoice) => void
  setSelectedModelId: (id: string) => void
  setSelectedLanguageCode: (code: string) => void
  setVoiceSettingsEnabled: (enabled: boolean) => void
  setVoiceSettings: (settings: Partial<VoiceSettings>) => void
  resetVoiceSettings: () => void
}

const SEARCH_PAGE_SIZE = 100

export const useVoiceStore = create<VoiceState>((set, get) => ({
  models: [],
  languages: [],
  voices: [],
  loading: false,
  error: null,

  searchQuery: '',
  searchResults: [],
  searchHasMore: false,
  searchPage: 0,
  searching: false,
  searchError: null,

  resolvedVoicesById: {},

  selectedModelId: '',
  selectedVoiceId: '',
  selectedLanguageCode: '',
  voiceSettingsEnabled: false,
  voiceSettings: { ...DEFAULT_VOICE_SETTINGS },

  loadAll: async (apiKey: string) => {
    set({ loading: true, error: null })
    try {
      const [models, languages, voices] = await Promise.all([
        window.api.genvoice.listModels(apiKey),
        window.api.genvoice.listLanguages(apiKey),
        window.api.genvoice.listDefaultVoices(apiKey)
      ])
      set((state) => ({
        models,
        languages,
        voices,
        loading: false,
        resolvedVoicesById: mergeById(state.resolvedVoicesById, voices),
        selectedModelId: state.selectedModelId || models.find((m) => m.can_do_text_to_speech)?.model_id || '',
        selectedVoiceId: state.selectedVoiceId || voices[0]?.voice_id || '',
        selectedLanguageCode: state.selectedLanguageCode || 'en'
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  searchLibrary: async (apiKey: string, query: string) => {
    set({ searching: true, searchError: null, searchQuery: query, searchPage: 0 })
    try {
      const { voices, hasMore } = await window.api.genvoice.listSharedVoices(apiKey, {
        search: query || undefined,
        page: 0,
        pageSize: SEARCH_PAGE_SIZE
      })
      set((state) => ({
        searchResults: voices,
        searchHasMore: hasMore,
        searching: false,
        resolvedVoicesById: mergeById(state.resolvedVoicesById, voices)
      }))
    } catch (err) {
      set({ searchError: err instanceof Error ? err.message : String(err), searching: false })
    }
  },

  loadMoreSearchResults: async (apiKey: string) => {
    const { searchQuery, searchPage, searching } = get()
    if (searching) return
    set({ searching: true, searchError: null })
    try {
      const nextPage = searchPage + 1
      const { voices, hasMore } = await window.api.genvoice.listSharedVoices(apiKey, {
        search: searchQuery || undefined,
        page: nextPage,
        pageSize: SEARCH_PAGE_SIZE
      })
      set((state) => ({
        searchResults: [...state.searchResults, ...voices],
        searchHasMore: hasMore,
        searchPage: nextPage,
        searching: false,
        resolvedVoicesById: mergeById(state.resolvedVoicesById, voices)
      }))
    } catch (err) {
      set({ searchError: err instanceof Error ? err.message : String(err), searching: false })
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [], searchHasMore: false, searchPage: 0 }),

  resolveVoiceId: async (apiKey: string, voiceId: string) => {
    const id = voiceId.trim()
    if (!id) return { found: false }

    const cached = get().resolvedVoicesById[id]
    if (cached) {
      set({ selectedVoiceId: id })
      return { found: true }
    }

    set({ searching: true, searchError: null })
    try {
      const { voices } = await window.api.genvoice.listSharedVoices(apiKey, {
        search: id,
        page: 0,
        pageSize: 20
      })
      const exact = voices.find((v) => v.voice_id === id)
      set((state) => ({
        searching: false,
        resolvedVoicesById: mergeById(state.resolvedVoicesById, voices),
        selectedVoiceId: id
      }))
      if (!exact) {
        // Không tìm thấy trong shared-voices (có thể là voice mặc định đã có
        // sẵn, hoặc voice riêng của tài khoản khác) — vẫn cho chọn ID này
        // luôn, chỉ là chưa hiển thị được tên thật.
        return { found: get().voices.some((v) => v.voice_id === id) }
      }
      return { found: true }
    } catch (err) {
      set({ searchError: err instanceof Error ? err.message : String(err), searching: false, selectedVoiceId: id })
      return { found: false }
    }
  },

  setSelectedVoiceId: (id, knownVoice) =>
    set((state) => ({
      selectedVoiceId: id,
      resolvedVoicesById: knownVoice ? mergeById(state.resolvedVoicesById, [knownVoice]) : state.resolvedVoicesById
    })),
  setSelectedModelId: (id) => set({ selectedModelId: id }),
  setSelectedLanguageCode: (code) => set({ selectedLanguageCode: code }),
  setVoiceSettingsEnabled: (enabled) => set({ voiceSettingsEnabled: enabled }),
  setVoiceSettings: (settings) =>
    set((state) => ({ voiceSettings: { ...state.voiceSettings, ...settings } })),
  resetVoiceSettings: () => set({ voiceSettings: { ...DEFAULT_VOICE_SETTINGS } })
}))

function mergeById(
  existing: Record<string, GenvoiceVoice>,
  voices: GenvoiceVoice[]
): Record<string, GenvoiceVoice> {
  if (voices.length === 0) return existing
  const next = { ...existing }
  for (const v of voices) next[v.voice_id] = v
  return next
}
