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
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Voice</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="relative col-span-2 flex flex-col gap-1 text-xs text-gray-500" ref={boxRef}>
          Voice — search theo tên (toàn bộ thư viện GenVoice)
          <input
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
            placeholder="Search voice by name..."
            value={dropdownOpen ? searchInput : (selectedVoice?.name ?? searchInput)}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              setSearchInput(e.target.value)
              setDropdownOpen(true)
            }}
          />

          {dropdownOpen && (
            <div className="absolute top-full left-0 z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
              {!searchInput.trim() && (
                <div className="border-b border-gray-100 px-2 py-1 text-[11px] text-gray-400">
                  Đang hiện {voices.length} voice mặc định — gõ tên để tìm trong TOÀN BỘ thư viện
                </div>
              )}
              {searching && displayedVoices.length === 0 && (
                <div className="px-2 py-2 text-xs text-gray-400">Đang tìm...</div>
              )}
              {searchError && <div className="px-2 py-2 text-xs text-red-500">{searchError}</div>}
              {!searching && displayedVoices.length === 0 && (
                <div className="px-2 py-2 text-xs text-gray-400">Không tìm thấy voice nào.</div>
              )}
              {displayedVoices.map((v) => (
                <button
                  type="button"
                  key={v.voice_id}
                  className={`block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${
                    v.voice_id === selectedVoiceId ? 'bg-blue-50 font-medium' : ''
                  }`}
                  onClick={() => pickVoice(v.voice_id)}
                  title={`${v.voice_id}${v.description ? ' — ' + v.description : ''}`}
                >
                  {v.name}
                  <span className="ml-1 text-[10px] text-gray-400">{v.voice_id}</span>
                </button>
              ))}
              {searchInput.trim() && searchHasMore && (
                <button
                  type="button"
                  className="block w-full border-t border-gray-100 px-2 py-1.5 text-center text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                  disabled={searching}
                  onClick={() => apiKey && loadMoreSearchResults(apiKey)}
                >
                  {searching ? 'Đang tải...' : 'Tải thêm kết quả'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="col-span-2 flex flex-col gap-1 text-xs text-gray-500 md:col-span-1">
          Hoặc dán Voice ID (chọn trực tiếp, không cần tìm theo tên)
          <div className="flex gap-1">
            <input
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
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
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
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

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Model
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
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

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Language
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
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

      {loading && <p className="mt-2 text-xs text-gray-400">Đang tải danh sách voice/model...</p>}

      <div className="mt-4 border-t border-gray-100 pt-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={voiceSettingsEnabled}
            onChange={(e) => setVoiceSettingsEnabled(e.target.checked)}
          />
          Change voice settings
          <span className="text-xs font-normal text-amber-600">
            (chưa xác nhận GenVoice có nhận field này — xem CLAUDE.md mục 6)
          </span>
        </label>

        {voiceSettingsEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
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
              onChange={(v) => setVoiceSettings({ style: v })}
            />
            <SliderField
              label="Stability"
              value={voiceSettings.stability}
              min={0}
              max={100}
              step={1}
              onChange={(v) => setVoiceSettings({ stability: v })}
            />
            <SliderField
              label="Similarity"
              value={voiceSettings.similarity_boost}
              min={0}
              max={100}
              step={1}
              onChange={(v) => setVoiceSettings({ similarity_boost: v })}
            />
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Speaker Boost
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={voiceSettings.use_speaker_boost}
                onChange={(e) => setVoiceSettings({ use_speaker_boost: e.target.checked })}
              />
            </label>
            <button
              className="col-span-2 self-end rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 md:col-span-1"
              onClick={resetVoiceSettings}
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function SliderField(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-500">
      {props.label}: {props.value}
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
