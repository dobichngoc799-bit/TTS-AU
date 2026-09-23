import { useState } from 'react'
import { useJobStore } from '../store/jobStore'
import { useSettingsStore } from '../store/settingsStore'
import type { ImportedFileGroup } from '@shared/types'

// Mục 3.4 + 3.5 CLAUDE.md: nhập/import text, Auto Split, chọn output dir.
export function BatchJobPanel(): React.JSX.Element {
  const [text, setText] = useState('')
  const outputDir = useSettingsStore((s) => s.outputDir)
  const pickOutputDir = useSettingsStore((s) => s.pickOutputDir)
  const {
    sourceLines,
    importedGroups,
    autoSplitEnabled,
    autoSplitDelimiters,
    autoGenerateSrt,
    joinAudio,
    joinGapSeconds,
    setSourceText,
    addImportedGroups,
    clearLines,
    setAutoSplitEnabled,
    setAutoSplitDelimiters,
    setAutoGenerateSrt,
    setJoinAudio,
    setJoinGapSeconds
  } = useJobStore()
  const [collapsed, setCollapsed] = useState(false)

  const importedLineCount = importedGroups.reduce((sum, g) => sum + g.lines.length, 0)
  const totalLineCount = sourceLines.length + importedLineCount

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-indigo-500" />
        <h2 className="text-sm font-semibold text-gray-800">Batch Job</h2>
        {collapsed && (
          <span className="text-xs font-normal text-gray-400">
            ({totalLineCount} đoạn text sẵn sàng)
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          <span
            className={`inline-block text-xs transition-transform ${collapsed ? '-rotate-90' : ''}`}
          >
            ▼
          </span>
        </button>
      </div>

      {!collapsed && (
        <>
          <textarea
            className="h-16 w-full resize-none rounded-lg border border-gray-300 p-2.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            placeholder="Nhập hoặc dán văn bản cần chuyển thành audio... (mỗi câu sẽ tự chẻ theo dấu câu nếu bật Auto Split)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setSourceText(text)}
          />

          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoSplitEnabled}
                onChange={(e) => setAutoSplitEnabled(e.target.checked)}
              />
              Auto Split
            </label>
            <input
              className="w-24 rounded-lg border border-gray-300 px-2.5 py-1 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              value={autoSplitDelimiters}
              onChange={(e) => setAutoSplitDelimiters(e.target.value)}
              title="Ký tự phân tách"
            />
            <span className="h-4 w-px bg-gray-200" />
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoGenerateSrt}
                onChange={(e) => setAutoGenerateSrt(e.target.checked)}
              />
              Tự động tạo Srt
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={joinAudio}
                onChange={(e) => setJoinAudio(e.target.checked)}
              />
              Join Mp3 sau khi xong
            </label>
            <label
              className={`flex items-center gap-2 ${joinAudio ? '' : 'opacity-40'}`}
              title="Chèn khoảng lặng giữa các đoạn khi ghép, để dễ nhận ra chỗ cắt. 0 = nối liền."
            >
              Khoảng lặng
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                disabled={!joinAudio}
                className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed"
                value={joinGapSeconds}
                onChange={(e) => setJoinGapSeconds(parseFloat(e.target.value))}
              />
              giây
            </label>
          </div>

          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="shrink-0 text-xs font-medium text-gray-500">
              Thư mục output (cho văn bản gõ tay):
            </span>
            <span className="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-gray-700">
              {outputDir ?? 'Chưa chọn...'}
            </span>
            <button
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              onClick={() => pickOutputDir()}
            >
              ...
            </button>
          </div>

          {importedGroups.length > 0 && (
            <div className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
              <p className="mb-1 font-medium text-gray-500">
                {importedGroups.length} file đã import — mỗi file tự tạo 1 folder cùng tên, cạnh
                file gốc:
              </p>
              <ul className="space-y-0.5">
                {importedGroups.map((g) => (
                  <li key={g.id} className="truncate">
                    <span className="font-medium text-gray-700">{g.outputBaseName}</span> —{' '}
                    {g.lines.length} đoạn ·{' '}
                    <span className="text-gray-400">{g.outputDir}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-medium text-gray-500">{totalLineCount} đoạn text sẵn sàng</span>
            {totalLineCount > 0 && (
              <button className="font-medium text-red-500 hover:underline" onClick={clearLines}>
                Xoá hết
              </button>
            )}
          </div>

          <ImportRow onImported={(groups) => addImportedGroups(groups)} />
        </>
      )}
    </section>
  )
}

function ImportRow(props: {
  onImported: (groups: ImportedFileGroup[]) => void
}): React.JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <button
        className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-600 transition-colors hover:bg-gray-50"
        onClick={async () => props.onImported(await window.api.dialog.importFiles())}
      >
        Import File (*.srt;*.txt;*.dgt)
      </button>
      <button
        className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-600 transition-colors hover:bg-gray-50"
        onClick={async () => props.onImported(await window.api.dialog.importFolder())}
      >
        Import Folder
      </button>
    </div>
  )
}
