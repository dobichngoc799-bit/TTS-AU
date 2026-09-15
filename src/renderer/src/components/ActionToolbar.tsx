import { useMemo, useState } from 'react'
import { useJobStore } from '../store/jobStore'
import { useSettingsStore } from '../store/settingsStore'
import { useVoiceStore } from '../store/voiceStore'

export function ActionToolbar(): React.JSX.Element {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const outputDir = useSettingsStore((s) => s.outputDir)
  const account = useSettingsStore((s) => s.account)
  const refreshAccount = useSettingsStore((s) => s.refreshAccount)
  const { selectedVoiceId, selectedModelId, selectedLanguageCode, voiceSettingsEnabled, voiceSettings } =
    useVoiceStore()
  const { running, start, stop, autoGenerateSrt, joinAudio, sourceLines } = useJobStore()
  const [error, setError] = useState<string | null>(null)

  // Ước tính credit sẽ tốn — CHỈ xác nhận tỉ lệ 1 ký tự = 1 credit cho
  // provider elevenlabs (xem CLAUDE.md mục 2.3), UI hiện chỉ hỗ trợ chọn
  // voice ElevenLabs nên coi ước tính này là hợp lý, nhưng luôn ghi rõ là
  // ước tính — số credit thật đọc từ `credits_deducted` sau khi task xong.
  const estimatedCredits = useMemo(
    () => sourceLines.reduce((sum, line) => sum + line.length, 0),
    [sourceLines]
  )
  const insufficientCredits = account != null && estimatedCredits > account.credit_balance

  const canStart =
    !!apiKey &&
    !!outputDir &&
    !!selectedVoiceId &&
    sourceLines.length > 0 &&
    !running &&
    !insufficientCredits

  async function handleStart(): Promise<void> {
    if (!apiKey || !outputDir) return
    setError(null)
    try {
      await start(apiKey, {
        voiceId: selectedVoiceId,
        modelId: selectedModelId,
        languageCode: selectedLanguageCode,
        voiceSettingsEnabled,
        voiceSettings,
        outputDir,
        autoGenerateSrt,
        joinAudio
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Cập nhật lại số dư hiển thị sau khi job chạy xong (dù thành công
      // hay lỗi giữa chừng, credit đã tốn cho các item đã xong là thật).
      refreshAccount()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-3">
      <button
        className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
        disabled={!canStart}
        onClick={handleStart}
      >
        Start
      </button>
      <button
        className="rounded bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
        disabled={!running}
        onClick={() => stop()}
      >
        Stop
      </button>
      <button
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
        disabled={!outputDir}
        onClick={() => outputDir && window.api.shell.openPath(outputDir)}
      >
        Open Audio Output
      </button>
      {sourceLines.length > 0 && (
        <span className={`text-xs ${insufficientCredits ? 'font-medium text-red-500' : 'text-gray-500'}`}>
          Ước tính: ~{estimatedCredits.toLocaleString('vi-VN')} credit
          {account && ` (còn ${account.credit_balance.toLocaleString('vi-VN')})`}
          {insufficientCredits && ' — KHÔNG ĐỦ CREDIT, không thể Start'}
        </span>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
      {!apiKey && <span className="text-xs text-gray-400">Cần nhập API key trước.</span>}
    </div>
  )
}
