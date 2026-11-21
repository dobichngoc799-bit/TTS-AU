import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AccountInfo,
  BatchJobConfig,
  BatchProgressEvent,
  BatchStartResult,
  GenvoiceLanguage,
  GenvoiceModel,
  GenvoiceVoice,
  ImportedFileGroup,
  SavedBatchJob,
  TtsProvider
} from '../shared/types'

export interface ListSharedVoicesParams {
  search?: string
  page?: number
  pageSize?: number
}

// Bề mặt API duy nhất renderer được phép dùng — không expose ipcRenderer
// trực tiếp (trừ qua @electron-toolkit/preload cho các nhu cầu chung chung),
// mọi hành động cụ thể của app đi qua các hàm được liệt kê rõ ràng ở đây.
const api = {
  settings: {
    getProvider: (): Promise<TtsProvider> => ipcRenderer.invoke('settings:getProvider'),
    setProvider: (provider: TtsProvider): Promise<void> =>
      ipcRenderer.invoke('settings:setProvider', provider),
    getApiKey: (provider: TtsProvider): Promise<string | null> =>
      ipcRenderer.invoke('settings:getApiKey', provider),
    setApiKey: (provider: TtsProvider, apiKey: string): Promise<void> =>
      ipcRenderer.invoke('settings:setApiKey', provider, apiKey),
    clearApiKey: (provider: TtsProvider): Promise<void> =>
      ipcRenderer.invoke('settings:clearApiKey', provider),
    getOutputDir: (): Promise<string | null> => ipcRenderer.invoke('settings:getOutputDir'),
    setOutputDir: (dir: string): Promise<void> => ipcRenderer.invoke('settings:setOutputDir', dir)
  },
  // Lookup read-only — main process tự chọn GenVoice/ElevenLabs theo provider.
  tts: {
    getAccount: (provider: TtsProvider, apiKey: string): Promise<AccountInfo> =>
      ipcRenderer.invoke('tts:getAccount', provider, apiKey),
    listModels: (provider: TtsProvider, apiKey: string): Promise<GenvoiceModel[]> =>
      ipcRenderer.invoke('tts:listModels', provider, apiKey),
    listLanguages: (provider: TtsProvider, apiKey: string): Promise<GenvoiceLanguage[]> =>
      ipcRenderer.invoke('tts:listLanguages', provider, apiKey),
    listDefaultVoices: (provider: TtsProvider, apiKey: string): Promise<GenvoiceVoice[]> =>
      ipcRenderer.invoke('tts:listDefaultVoices', provider, apiKey),
    listSharedVoices: (
      provider: TtsProvider,
      apiKey: string,
      params: ListSharedVoicesParams
    ): Promise<{ voices: GenvoiceVoice[]; hasMore: boolean }> =>
      ipcRenderer.invoke('tts:listSharedVoices', provider, apiKey, params)
  },
  dialog: {
    selectOutputDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectOutputDir'),
    importFiles: (): Promise<ImportedFileGroup[]> => ipcRenderer.invoke('dialog:importFiles'),
    importFolder: (): Promise<ImportedFileGroup[]> => ipcRenderer.invoke('dialog:importFolder')
  },
  shell: {
    openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path)
  },
  text: {
    autoSplit: (text: string, delimiters: string): Promise<string[]> =>
      ipcRenderer.invoke('text:autoSplit', text, delimiters),
    extractLines: (content: string, ext: string): Promise<string[]> =>
      ipcRenderer.invoke('text:extractLines', content, ext)
  },
  batchJob: {
    start: (apiKey: string, job: BatchJobConfig): Promise<BatchStartResult> =>
      ipcRenderer.invoke('batchJob:start', apiKey, job),
    resume: (): Promise<BatchStartResult> => ipcRenderer.invoke('batchJob:resume'),
    getSaved: (): Promise<SavedBatchJob | null> => ipcRenderer.invoke('batchJob:getSaved'),
    discardSaved: (): Promise<void> => ipcRenderer.invoke('batchJob:discardSaved'),
    stop: (): Promise<void> => ipcRenderer.invoke('batchJob:stop'),
    onProgress: (callback: (event: BatchProgressEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: BatchProgressEvent): void =>
        callback(payload)
      ipcRenderer.on('batchJob:progress', listener)
      return () => ipcRenderer.removeListener('batchJob:progress', listener)
    }
  }
}

export type PreloadApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
