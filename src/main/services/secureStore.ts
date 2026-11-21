import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { TtsProvider } from '../../shared/types'

// Lưu API key mã hoá qua OS keychain (Electron safeStorage) — KHÔNG BAO GIỜ
// lưu plaintext. Xem CLAUDE.md mục 9. Chỉ dùng trong main process.
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json')

interface StoredSettings {
  apiKeyEncrypted?: string // base64 — key GenVoice (tên field cũ, giữ nguyên)
  elevenlabsApiKeyEncrypted?: string // base64
  provider?: TtsProvider // nguồn đang chọn trên UI
  outputDir?: string
}

async function readSettingsFile(): Promise<StoredSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeSettingsFile(settings: StoredSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf-8')
}

// Field lưu key theo nguồn. Key GenVoice giữ tên field cũ `apiKeyEncrypted`
// để bản cập nhật vẫn đọc được key user đã lưu trước khi có ElevenLabs.
const KEY_FIELD: Record<TtsProvider, 'apiKeyEncrypted' | 'elevenlabsApiKeyEncrypted'> = {
  genvoice: 'apiKeyEncrypted',
  elevenlabs: 'elevenlabsApiKeyEncrypted'
}

export async function saveApiKey(provider: TtsProvider, apiKey: string): Promise<void> {
  const settings = await readSettingsFile()
  if (safeStorage.isEncryptionAvailable()) {
    settings[KEY_FIELD[provider]] = safeStorage.encryptString(apiKey).toString('base64')
  } else {
    // Fallback hiếm khi xảy ra (OS không hỗ trợ keychain) — vẫn tránh
    // plaintext bằng base64 tối thiểu, KHÔNG coi đây là mã hoá thật sự.
    settings[KEY_FIELD[provider]] = Buffer.from(apiKey, 'utf-8').toString('base64')
  }
  await writeSettingsFile(settings)
}

export async function loadApiKey(provider: TtsProvider): Promise<string | null> {
  const settings = await readSettingsFile()
  const encrypted = settings[KEY_FIELD[provider]]
  if (!encrypted) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    }
    return Buffer.from(encrypted, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

export async function clearApiKey(provider: TtsProvider): Promise<void> {
  const settings = await readSettingsFile()
  delete settings[KEY_FIELD[provider]]
  await writeSettingsFile(settings)
}

export async function saveProvider(provider: TtsProvider): Promise<void> {
  const settings = await readSettingsFile()
  settings.provider = provider
  await writeSettingsFile(settings)
}

export async function loadProvider(): Promise<TtsProvider> {
  const settings = await readSettingsFile()
  return settings.provider === 'elevenlabs' ? 'elevenlabs' : 'genvoice'
}

export async function saveOutputDir(dir: string): Promise<void> {
  const settings = await readSettingsFile()
  settings.outputDir = dir
  await writeSettingsFile(settings)
}

export async function loadOutputDir(): Promise<string | null> {
  const settings = await readSettingsFile()
  return settings.outputDir ?? null
}
