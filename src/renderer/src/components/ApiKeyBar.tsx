import { useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'

export function ApiKeyBar(): React.JSX.Element {
  const { apiKey, account, loading, error, saveApiKey, clearApiKey } = useSettingsStore()
  const [input, setInput] = useState('')

  if (apiKey && account) {
    return (
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 text-sm">
        <span className="text-gray-500">Tài khoản:</span>
        <span className="font-medium">{account.email}</span>
        <span className="text-gray-500">Credit còn lại:</span>
        <span className="font-semibold text-emerald-600">
          {account.credit_balance.toLocaleString('vi-VN')}
        </span>
        <button
          className="ml-auto text-xs text-gray-400 hover:text-red-500"
          onClick={() => clearApiKey()}
        >
          Đổi API key
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
      <input
        type="password"
        placeholder="Dán GenVoice API Key (xi-api-key)..."
        className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) saveApiKey(input.trim()).catch(() => {})
        }}
      />
      <button
        className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={loading || !input.trim()}
        onClick={() => saveApiKey(input.trim()).catch(() => {})}
      >
        {loading ? 'Đang kiểm tra...' : 'Lưu'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
