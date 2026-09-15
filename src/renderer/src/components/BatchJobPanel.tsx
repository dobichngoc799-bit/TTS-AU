import { useState } from 'react'
import { useJobStore } from '../store/jobStore'
import { useSettingsStore } from '../store/settingsStore'

// Mục 3.4 + 3.5 CLAUDE.md: nhập/import text, Auto Split, chọn output dir.
export function BatchJobPanel(): React.JSX.Element {
  const [text, setText] = useState('')
  const outputDir = useSettingsStore((s) => s.outputDir)
  const pickOutputDir = useSettingsStore((s) => s.pickOutputDir)
  const {
    sourceLines,
    autoSplitEnabled,
    autoSplitDelimiters,
    autoGenerateSrt,
    joinAudio,
    setSourceText,
    addLines,
    clearLines,
    setAutoSplitEnabled,
    setAutoSplitDelimiters,
    setAutoGenerateSrt,
    setJoinAudio
  } = useJobStore()

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Batch Job</h2>

      <textarea
        className="h-28 w-full resize-none rounded border border-gray-300 p-2 text-sm"
        placeholder="Nhập hoặc dán văn bản cần chuyển thành audio... (mỗi câu sẽ tự chẻ theo dấu câu nếu bật Auto Split)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setSourceText(text)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoSplitEnabled}
            onChange={(e) => setAutoSplitEnabled(e.target.checked)}
          />
          Auto Split
        </label>
        <input
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
          value={autoSplitDelimiters}
          onChange={(e) => setAutoSplitDelimiters(e.target.value)}
          title="Ký tự phân tách"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoGenerateSrt}
            onChange={(e) => setAutoGenerateSrt(e.target.checked)}
          />
          Tự động tạo Srt
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={joinAudio}
            onChange={(e) => setJoinAudio(e.target.checked)}
          />
          Join Mp3 sau khi xong
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-gray-500">Thư mục output:</span>
        <span className="flex-1 truncate rounded border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
          {outputDir ?? 'Chưa chọn...'}
        </span>
        <button
          className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
          onClick={() => pickOutputDir()}
        >
          ...
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>{sourceLines.length} đoạn text sẵn sàng</span>
        {sourceLines.length > 0 && (
          <button className="text-red-500 hover:underline" onClick={clearLines}>
            Xoá hết
          </button>
        )}
      </div>

      <ImportRow onImported={(lines) => addLines(lines)} />
    </section>
  )
}

function ImportRow(props: { onImported: (lines: string[]) => void }): React.JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <button
        className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
        onClick={async () => props.onImported(await window.api.dialog.importFiles())}
      >
        Import File (*.srt;*.txt;*.dgt)
      </button>
      <button
        className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
        onClick={async () => props.onImported(await window.api.dialog.importFolder())}
      >
        Import Folder
      </button>
    </div>
  )
}
