import { useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'

export function ApiKeyBar(): React.JSX.Element {
  const { apiKey, account, loading, error, saveApiKey, clearApiKey } = useSettingsStore()
  const [input, setInput] = useState('')

  if (apiKey && account) {
    return (
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          T
        </div>
        <h1 className="text-sm font-semibold text-gray-800">TTS AU</h1>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <span className="text-xs text-gray-400">Tài khoản</span>
        <span className="text-sm font-medium text-gray-700">{account.email}</span>
        <div className="ml-2 flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-0.5">
          <span className="text-xs text-emerald-700">Credit</span>
          <span className="text-sm font-semibold text-emerald-600">
            {account.credit_balance.toLocaleString('vi-VN')}
          </span>
        </div>
        <button
          className="ml-auto rounded-md px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
          onClick={() => clearApiKey()}
        >
          Đổi API key
        </button>
      </header>
    )
  }

  return (
    <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
        T
      </div>
      <input
        type="password"
        placeholder="Dán GenVoice API Key (xi-api-key)..."
        className="ml-1 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) saveApiKey(input.trim()).catch(() => {})
        }}
      />
      <button
        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={loading || !input.trim()}
        onClick={() => saveApiKey(input.trim()).catch(() => {})}
      >
        {loading ? 'Đang kiểm tra...' : 'Lưu'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </header>
  )
}
