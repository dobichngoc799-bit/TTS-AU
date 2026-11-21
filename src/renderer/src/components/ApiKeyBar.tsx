import { useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { useJobStore } from '../store/jobStore'
import type { TtsProvider } from '@shared/types'
import { TTS_PROVIDER_LABELS } from '@shared/types'

const PROVIDERS: TtsProvider[] = ['genvoice', 'elevenlabs']

const KEY_PLACEHOLDER: Record<TtsProvider, string> = {
  genvoice: 'Dán GenVoice API Key (xi-api-key)...',
  elevenlabs: 'Dán ElevenLabs API Key (elevenlabs.io → Developers → API Keys)...'
}

export function ApiKeyBar(): React.JSX.Element {
  const { provider, apiKey, account, loading, error, setProvider, saveApiKey, clearApiKey } =
    useSettingsStore()
  const running = useJobStore((s) => s.running)
  const [input, setInput] = useState('')

  const providerSwitch = (
    <div
      className="flex shrink-0 rounded-lg bg-gray-100 p-0.5"
      title={running ? 'Không đổi nguồn khi job đang chạy' : 'Chọn nguồn tạo audio'}
    >
      {PROVIDERS.map((p) => (
        <button
          key={p}
          type="button"
          disabled={running}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
            p === provider
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 disabled:hover:text-gray-500'
          }`}
          onClick={() => {
            setInput('')
            setProvider(p)
          }}
        >
          {TTS_PROVIDER_LABELS[p]}
        </button>
      ))}
    </div>
  )

  const logo = (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
      T
    </div>
  )

  if (apiKey && account) {
    return (
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
        {logo}
        <h1 className="text-sm font-semibold text-gray-800">TTS V1</h1>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        {providerSwitch}
        <span className="truncate text-sm font-medium text-gray-700">{account.label}</span>
        {account.remaining !== null && (
          <div className="ml-2 flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-0.5">
            <span className="text-xs text-emerald-700">
              {account.unit === 'credit' ? 'Credit' : 'Còn'}
            </span>
            <span className="text-sm font-semibold text-emerald-600">
              {account.remaining.toLocaleString('vi-VN')}
              {account.limit !== undefined && (
                <span className="font-normal text-emerald-700/70">
                  {' '}
                  / {account.limit.toLocaleString('vi-VN')} {account.unit}
                </span>
              )}
            </span>
          </div>
        )}
        <button
          className="ml-auto shrink-0 rounded-md px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
          onClick={() => clearApiKey()}
        >
          Đổi API key
        </button>
      </header>
    )
  }

  return (
    <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      {logo}
      {providerSwitch}
      <input
        type="password"
        placeholder={KEY_PLACEHOLDER[provider]}
        className="ml-1 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) saveApiKey(input.trim()).catch(() => {})
        }}
      />
      <button
        className="shrink-0 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={loading || !input.trim()}
        onClick={() => saveApiKey(input.trim()).catch(() => {})}
      >
        {loading ? 'Đang kiểm tra...' : 'Lưu'}
      </button>
      {error && <span className="max-w-[40%] truncate text-xs text-red-500" title={error}>{error}</span>}
    </header>
  )
}
