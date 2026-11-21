import type {
  AccountInfo,
  GenvoiceLanguage,
  GenvoiceModel,
  GenvoiceVoice,
  TtsProvider
} from '../../shared/types'
import * as genvoiceApi from './genvoiceApi'
import * as elevenlabsApi from './elevenlabsApi'

// Chọn đúng API theo nguồn cho các lookup read-only (tài khoản, model, ngôn
// ngữ, voice). Phần tạo audio khác nhau nhiều (GenVoice: submit + poll + tải
// URL; ElevenLabs: trả thẳng bytes) nên rẽ nhánh trong batchJobQueue.ts.

export interface ListSharedVoicesParams {
  search?: string
  page?: number
  pageSize?: number
}

export async function getAccount(provider: TtsProvider, apiKey: string): Promise<AccountInfo> {
  if (provider === 'elevenlabs') return elevenlabsApi.getAccount(apiKey)
  const acc = await genvoiceApi.getAccount(apiKey)
  return {
    provider: 'genvoice',
    label: acc.email,
    remaining: acc.credit_balance,
    unit: 'credit'
  }
}

export async function listModels(provider: TtsProvider, apiKey: string): Promise<GenvoiceModel[]> {
  return provider === 'elevenlabs'
    ? elevenlabsApi.listModels(apiKey)
    : genvoiceApi.listModels(apiKey)
}

export async function listLanguages(
  provider: TtsProvider,
  apiKey: string
): Promise<GenvoiceLanguage[]> {
  if (provider === 'elevenlabs') {
    return elevenlabsApi.languagesFromModels(await elevenlabsApi.listModels(apiKey))
  }
  return genvoiceApi.listLanguages(apiKey)
}

// Danh sách voice hiện sẵn khi mở dropdown (chưa gõ tìm): GenVoice = voice
// mặc định; ElevenLabs = voice trong tài khoản (My Voices).
export async function listDefaultVoices(
  provider: TtsProvider,
  apiKey: string
): Promise<GenvoiceVoice[]> {
  return provider === 'elevenlabs'
    ? elevenlabsApi.listMyVoices(apiKey)
    : genvoiceApi.listDefaultVoices(apiKey)
}

export async function listSharedVoices(
  provider: TtsProvider,
  apiKey: string,
  params: ListSharedVoicesParams
): Promise<{ voices: GenvoiceVoice[]; hasMore: boolean }> {
  return provider === 'elevenlabs'
    ? elevenlabsApi.listSharedVoices(apiKey, params)
    : genvoiceApi.listSharedVoices(apiKey, params)
}
