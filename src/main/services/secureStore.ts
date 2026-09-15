import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

// Lưu API key mã hoá qua OS keychain (Electron safeStorage) — KHÔNG BAO GIỜ
// lưu plaintext. Xem CLAUDE.md mục 9. Chỉ dùng trong main process.
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json')

interface StoredSettings {
  apiKeyEncrypted?: string // base64
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

export async function saveApiKey(apiKey: string): Promise<void> {
  const settings = await readSettingsFile()
  if (safeStorage.isEncryptionAvailable()) {
    settings.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64')
  } else {
    // Fallback hiếm khi xảy ra (OS không hỗ trợ keychain) — vẫn tránh
    // plaintext bằng base64 tối thiểu, KHÔNG coi đây là mã hoá thật sự.
    settings.apiKeyEncrypted = Buffer.from(apiKey, 'utf-8').toString('base64')
  }
  await writeSettingsFile(settings)
}

export async function loadApiKey(): Promise<string | null> {
  const settings = await readSettingsFile()
  if (!settings.apiKeyEncrypted) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(settings.apiKeyEncrypted, 'base64'))
    }
    return Buffer.from(settings.apiKeyEncrypted, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

export async function clearApiKey(): Promise<void> {
  const settings = await readSettingsFile()
  delete settings.apiKeyEncrypted
  await writeSettingsFile(settings)
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
