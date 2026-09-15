import { useEffect, useRef, useState } from 'react'
import { useVoiceStore } from '../store/voiceStore'
import { useSettingsStore } from '../store/settingsStore'

const SEARCH_DEBOUNCE_MS = 350

// Mục 3.1 + 3.2 CLAUDE.md: chọn Voice/Model/Language + override voice settings.
export function VoicePanel(): React.JSX.Element {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const {
    models,
    voices,
    languages,
    loading,
    searchResults,
    searchHasMore,
    searching,
    searchError,
    resolvedVoicesById,
    selectedModelId,
    selectedVoiceId,
    selectedLanguageCode,
    voiceSettingsEnabled,
    voiceSettings,
    loadAll,
    searchLibrary,
    loadMoreSearchResults,
    clearSearch,
    resolveVoiceId,
    setSelectedVoiceId,
    setSelectedModelId,
    setSelectedLanguageCode,
    setVoiceSettingsEnabled,
    setVoiceSettings,
    resetVoiceSettings
  } = useVoiceStore()

  const [searchInput, setSearchInput] = useState('')
  const [idInput, setIdInput] = useState('')
  const [idNotFoundWarning, setIdNotFoundWarning] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (apiKey) loadAll(apiKey)
  }, [apiKey])

  // Đóng dropdown khi click ra ngoài.
  useEffect(() => {
    function onClickOutside(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Search theo tên: gọi server (GET /v1/shared-voices?search=...) có
  // debounce, KHÔNG tải cả thư viện về rồi lọc client-side (xem mục 7 —
  // trước đây làm vậy chỉ ra được trang đầu ~30 voice, gây hiểu nhầm là thư
  // viện chỉ có vậy).
  useEffect(() => {
    if (!apiKey) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!searchInput.trim()) {
      clearSearch()
      return
    }
    debounceRef.current = setTimeout(() => {
      searchLibrary(apiKey, searchInput.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, apiKey])

  const displayedVoices = searchInput.trim() ? searchResults : voices
  const selectedVoice = resolvedVoicesById[selectedVoiceId]
  const ttsModels = models.filter((m) => m.can_do_text_to_speech)

  function pickVoice(id: string): void {
    setSelectedVoiceId(id)
    setSearchInput('')
    setDropdownOpen(false)
  }

  async function handleUseId(): Promise<void> {
    if (!apiKey || !idInput.trim()) return
    setIdNotFoundWarning(false)
    const { found } = await resolveVoiceId(apiKey, idInput.trim())
    setIdNotFoundWarning(!found)
    setIdInput('')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <SectionHeader title="Voice" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      {!collapsed && (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div
          className="relative col-span-2 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500"
          ref={boxRef}
        >
          Voice — search theo tên (toàn bộ thư viện GenVoice)
          <input
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            placeholder="Search voice by name..."
            value={dropdownOpen ? searchInput : (selectedVoice?.name ?? searchInput)}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              setSearchInput(e.target.value)
              setDropdownOpen(true)
            }}
          />

          {dropdownOpen && (
            <div className="absolute top-full left-0 z-10 mt-1.5 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {!searchInput.trim() && (
                <div className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-400">
                  Đang hiện {voices.length} voice mặc định — gõ tên để tìm trong TOÀN BỘ thư viện
                </div>
              )}
              {searching && displayedVoices.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">Đang tìm...</div>
              )}
              {searchError && <div className="px-3 py-2 text-xs text-red-500">{searchError}</div>}
              {!searching && displayedVoices.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">Không tìm thấy voice nào.</div>
              )}
              {displayedVoices.map((v) => (
                <button
                  type="button"
                  key={v.voice_id}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm transition-colors hover:bg-indigo-50 ${
                    v.voice_id === selectedVoiceId ? 'bg-indigo-50 font-medium text-indigo-700' : ''
                  }`}
                  onClick={() => pickVoice(v.voice_id)}
                  title={`${v.voice_id}${v.description ? ' — ' + v.description : ''}`}
                >
                  {v.name}
                  <span className="ml-1.5 text-[10px] text-gray-400">{v.voice_id}</span>
                </button>
              ))}
              {searchInput.trim() && searchHasMore && (
                <button
                  type="button"
                  className="block w-full border-t border-gray-100 px-3 py-1.5 text-center text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                  disabled={searching}
                  onClick={() => apiKey && loadMoreSearchResults(apiKey)}
                >
                  {searching ? 'Đang tải...' : 'Tải thêm kết quả'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500 md:col-span-1">
          Hoặc dán Voice ID (chọn trực tiếp, không cần tìm theo tên)
          <div className="flex min-w-0 gap-1.5">
            <input
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              placeholder="vd: F8IvasoAdpDhOjLm5YBm"
              value={idInput}
              onChange={(e) => {
                setIdInput(e.target.value)
                setIdNotFoundWarning(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUseId()
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!idInput.trim() || searching}
              onClick={handleUseId}
            >
              Dùng ID này
            </button>
          </div>
          {idNotFoundWarning && (
            <span className="text-[11px] text-amber-600">
              Không thấy ID này trong shared-voices — vẫn đã chọn, nhưng chưa xác minh được tên/tồn
              tại thật, kiểm tra kỹ trước khi chạy batch job lớn.
            </span>
          )}
        </div>

        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500">
          Model
          <select
            className="min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
          >
            {ttsModels.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500">
          Language
          <select
            className="min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            value={selectedLanguageCode}
            onChange={(e) => setSelectedLanguageCode(e.target.value)}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
          Đang tải danh sách voice/model...
        </p>
      )}

      <div className="mt-2 border-t border-gray-100 pt-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={voiceSettingsEnabled}
            onChange={(e) => setVoiceSettingsEnabled(e.target.checked)}
          />
          Change voice settings
        </label>

        {voiceSettingsEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-gray-50 p-3 md:grid-cols-5">
            <SliderField
              label="Speed"
              value={voiceSettings.speed}
              min={0.7}
              max={1.2}
              step={0.01}
              onChange={(v) => setVoiceSettings({ speed: v })}
            />
            <SliderField
              label="Style"
              value={voiceSettings.style}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => setVoiceSettings({ style: v })}
            />
            <SliderField
              label="Stability"
              value={voiceSettings.stability}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => setVoiceSettings({ stability: v })}
            />
            <SliderField
              label="Similarity"
              value={voiceSettings.similarity_boost}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => setVoiceSettings({ similarity_boost: v })}
            />
            <label className="flex flex-col justify-between gap-1.5 text-xs font-medium text-gray-500">
              Speaker Boost
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={voiceSettings.use_speaker_boost}
                onChange={(e) => setVoiceSettings({ use_speaker_boost: e.target.checked })}
              />
            </label>
            <button
              className="col-span-2 self-end rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 md:col-span-1"
              onClick={resetVoiceSettings}
            >
              Reset
            </button>
          </div>
        )}
      </div>
      </>
      )}
    </section>
  )
}

function SectionHeader(props: {
  title: string
  collapsed?: boolean
  onToggle?: () => void
}): React.JSX.Element {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-indigo-500" />
      <h2 className="text-sm font-semibold text-gray-800">{props.title}</h2>
      {props.onToggle && (
        <button
          type="button"
          onClick={props.onToggle}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={props.collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          <span
            className={`inline-block text-xs transition-transform ${props.collapsed ? '-rotate-90' : ''}`}
          >
            ▼
          </span>
        </button>
      )}
    </div>
  )
}

function SliderField(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-gray-500">
      <span className="flex items-baseline justify-between">
        {props.label}
        <span className="font-semibold text-gray-700">
          {props.value}
          {props.suffix ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}
