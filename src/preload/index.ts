import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { BatchJobConfig, BatchProgressEvent, GenvoiceVoice } from '../shared/types'

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
    getApiKey: (): Promise<string | null> => ipcRenderer.invoke('settings:getApiKey'),
    setApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', apiKey),
    clearApiKey: (): Promise<void> => ipcRenderer.invoke('settings:clearApiKey'),
    getOutputDir: (): Promise<string | null> => ipcRenderer.invoke('settings:getOutputDir'),
    setOutputDir: (dir: string): Promise<void> => ipcRenderer.invoke('settings:setOutputDir', dir)
  },
  genvoice: {
    getAccount: (apiKey: string) => ipcRenderer.invoke('genvoice:getAccount', apiKey),
    listModels: (apiKey: string) => ipcRenderer.invoke('genvoice:listModels', apiKey),
    listLanguages: (apiKey: string) => ipcRenderer.invoke('genvoice:listLanguages', apiKey),
    listDefaultVoices: (apiKey: string) => ipcRenderer.invoke('genvoice:listDefaultVoices', apiKey),
    listSharedVoices: (
      apiKey: string,
      params: ListSharedVoicesParams
    ): Promise<{ voices: GenvoiceVoice[]; hasMore: boolean }> =>
      ipcRenderer.invoke('genvoice:listSharedVoices', apiKey, params)
  },
  dialog: {
    selectOutputDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectOutputDir'),
    importFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:importFiles'),
    importFolder: (): Promise<string[]> => ipcRenderer.invoke('dialog:importFolder')
  },
  shell: {
    openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path)
  },
  text: {
    autoSplit: (text: string, delimiters: string): Promise<string[]> =>
      ipcRenderer.invoke('text:autoSplit', text, delimiters)
  },
  batchJob: {
    start: (apiKey: string, job: BatchJobConfig): Promise<void> =>
      ipcRenderer.invoke('batchJob:start', apiKey, job),
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
