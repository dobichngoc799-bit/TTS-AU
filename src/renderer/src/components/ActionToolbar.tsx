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
  const {
    running,
    start,
    stop,
    autoGenerateSrt,
    joinAudio,
    joinGapSeconds,
    sourceLines,
    importedGroups
  } = useJobStore()
  const [error, setError] = useState<string | null>(null)

  const totalLineCount = sourceLines.length + importedGroups.reduce((sum, g) => sum + g.lines.length, 0)

  // Ước tính credit sẽ tốn — CHỈ xác nhận tỉ lệ 1 ký tự = 1 credit cho
  // provider elevenlabs (xem CLAUDE.md mục 2.3), UI hiện chỉ hỗ trợ chọn
  // voice ElevenLabs nên coi ước tính này là hợp lý, nhưng luôn ghi rõ là
  // ước tính — số credit thật đọc từ `credits_deducted` sau khi task xong.
  const estimatedCredits = useMemo(() => {
    const manualChars = sourceLines.reduce((sum, line) => sum + line.length, 0)
    const importedChars = importedGroups.reduce(
      (sum, g) => sum + g.lines.reduce((s, l) => s + l.length, 0),
      0
    )
    return manualChars + importedChars
  }, [sourceLines, importedGroups])
  const insufficientCredits = account != null && estimatedCredits > account.credit_balance

  // "Thư mục output" chỉ bắt buộc khi có văn bản gõ tay (importedGroups tự có
  // outputDir riêng cạnh file gốc, không cần chọn).
  const canStart =
    !!apiKey &&
    (sourceLines.length === 0 || !!outputDir) &&
    !!selectedVoiceId &&
    totalLineCount > 0 &&
    !running &&
    !insufficientCredits

  // Mở TẤT CẢ folder audio liên quan tới batch hiện tại: folder "Thư mục
  // output" (nếu có văn bản gõ tay) + folder riêng của từng file đã import
  // (mỗi file 1 cửa sổ Explorer) — trước đây chỉ mở đúng "Thư mục output",
  // bỏ sót các file import (mỗi file giờ có folder riêng cạnh file gốc).
  const outputFolders = Array.from(
    new Set([
      ...(sourceLines.length > 0 && outputDir ? [outputDir] : []),
      ...importedGroups.map((g) => g.outputDir)
    ])
  )

  function handleOpenOutput(): void {
    for (const dir of outputFolders) {
      window.api.shell.openPath(dir)
    }
  }

  async function handleStart(): Promise<void> {
    if (!apiKey) return
    setError(null)
    try {
      await start(apiKey, {
        voiceId: selectedVoiceId,
        modelId: selectedModelId,
        languageCode: selectedLanguageCode,
        voiceSettingsEnabled,
        voiceSettings,
        manualOutputDir: outputDir,
        autoGenerateSrt,
        joinAudio,
        joinGapSeconds
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
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-2 shadow-[0_-1px_0_rgba(0,0,0,0.03)]">
      <button
        className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        disabled={!canStart}
        onClick={handleStart}
      >
        ▶ Start
      </button>
      <button
        className="rounded-lg bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300"
        disabled={!running}
        onClick={() => stop()}
      >
        ■ Stop
      </button>
      <button
        className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={outputFolders.length === 0}
        title={outputFolders.length > 1 ? `Mở ${outputFolders.length} folder` : undefined}
        onClick={handleOpenOutput}
      >
        Open Audio Output{outputFolders.length > 1 ? ` (${outputFolders.length})` : ''}
      </button>
      {totalLineCount > 0 && (
        <span
          className={`ml-1 rounded-full px-3 py-1 text-xs font-medium ${
            insufficientCredits ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Ước tính: ~{estimatedCredits.toLocaleString('vi-VN')} credit
          {account && ` (còn ${account.credit_balance.toLocaleString('vi-VN')})`}
          {insufficientCredits && ' — KHÔNG ĐỦ CREDIT, không thể Start'}
        </span>
      )}
      {error && <span className="text-xs font-medium text-red-500">{error}</span>}
      {!apiKey && <span className="text-xs text-gray-400">Cần nhập API key trước.</span>}
    </div>
  )
}
