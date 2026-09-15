import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as genvoiceApi from './services/genvoiceApi'
import * as secureStore from './services/secureStore'
import { initAutoUpdater } from './services/updateService'
import { autoSplitText, extractLinesFromFileContent } from './services/textSplitter'
import { BatchJobRunner } from './queue/batchJobQueue'
import type { BatchJobConfig } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let activeRunner: BatchJobRunner | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // --- Settings / API key ---
  ipcMain.handle('settings:getApiKey', async () => secureStore.loadApiKey())
  ipcMain.handle('settings:setApiKey', async (_e, apiKey: string) => {
    await secureStore.saveApiKey(apiKey)
  })
  ipcMain.handle('settings:clearApiKey', async () => secureStore.clearApiKey())
  ipcMain.handle('settings:getOutputDir', async () => secureStore.loadOutputDir())
  ipcMain.handle('settings:setOutputDir', async (_e, dir: string) => secureStore.saveOutputDir(dir))

  // --- GenVoice read-only lookups ---
  ipcMain.handle('genvoice:getAccount', async (_e, apiKey: string) => genvoiceApi.getAccount(apiKey))
  ipcMain.handle('genvoice:listModels', async (_e, apiKey: string) => genvoiceApi.listModels(apiKey))
  ipcMain.handle('genvoice:listLanguages', async (_e, apiKey: string) =>
    genvoiceApi.listLanguages(apiKey)
  )
  ipcMain.handle('genvoice:listDefaultVoices', async (_e, apiKey: string) =>
    genvoiceApi.listDefaultVoices(apiKey)
  )
  ipcMain.handle(
    'genvoice:listSharedVoices',
    async (_e, apiKey: string, params: genvoiceApi.ListSharedVoicesParams) =>
      genvoiceApi.listSharedVoices(apiKey, params)
  )

  // --- File / folder dialogs ---
  ipcMain.handle('dialog:selectOutputDir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:importFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text / Subtitles', extensions: ['txt', 'srt', 'dgt'] }]
    })
    if (result.canceled) return []
    const lines: string[] = []
    for (const filePath of result.filePaths) {
      const ext = filePath.slice(filePath.lastIndexOf('.'))
      const content = await fs.readFile(filePath, 'utf-8')
      lines.push(...extractLinesFromFileContent(content, ext))
    }
    return lines
  })

  ipcMain.handle('dialog:importFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return []
    const dir = result.filePaths[0]
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const lines: string[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = entry.name.slice(entry.name.lastIndexOf('.'))
      if (!['.txt', '.srt', '.dgt'].includes(ext)) continue
      const content = await fs.readFile(join(dir, entry.name), 'utf-8')
      lines.push(...extractLinesFromFileContent(content, ext))
    }
    return lines
  })

  ipcMain.handle('shell:openPath', async (_e, path: string) => {
    await shell.openPath(path)
  })

  // --- Text utils ---
  ipcMain.handle('text:autoSplit', (_e, text: string, delimiters: string) =>
    autoSplitText(text, delimiters)
  )

  // --- Batch job ---
  ipcMain.handle('batchJob:start', async (event, apiKey: string, job: BatchJobConfig) => {
    if (activeRunner) {
      throw new Error('Đã có 1 batch job đang chạy — bấm Stop trước khi chạy job mới.')
    }
    const sender = event.sender
    activeRunner = new BatchJobRunner(apiKey, job, (progress) => {
      sender.send('batchJob:progress', progress)
    })
    try {
      await activeRunner.run()
    } finally {
      activeRunner = null
    }
  })

  ipcMain.handle('batchJob:stop', async () => {
    activeRunner?.stop()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.ttsau.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()
  initAutoUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
