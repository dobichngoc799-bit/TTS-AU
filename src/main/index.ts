import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname, basename } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as genvoiceApi from './services/genvoiceApi'
import * as secureStore from './services/secureStore'
import { initAutoUpdater } from './services/updateService'
import { autoSplitText, extractLinesFromFileContent } from './services/textSplitter'
import * as jobStateStore from './services/jobStateStore'
import { BatchJobRunner } from './queue/batchJobQueue'
import type {
  BatchJobConfig,
  BatchStartResult,
  ImportedFileGroup,
  JobItem
} from '../shared/types'

// Đọc 1 file import + tính sẵn outputDir (folder mới cùng tên, cạnh file gốc)
// và outputBaseName (tên file không đuôi) — xem ImportedFileGroup.
async function readImportedFileGroup(filePath: string): Promise<ImportedFileGroup> {
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  const content = await fs.readFile(filePath, 'utf-8')
  const base = basename(filePath, ext)
  return {
    filePath,
    ext,
    content,
    outputDir: join(dirname(filePath), base),
    outputBaseName: base
  }
}

// Thư mục userData (settings.json + API key mã hoá) mặc định đặt theo
// productName. App đổi tên "ttsau-scaffold" → "TTS V1" (2026-09-23) — ghim lại
// folder cũ để bản đóng gói mới vẫn đọc được API key/settings đã lưu. Bản dev
// dùng package.json `name` ("ttsau", không đổi) nên không bị ảnh hưởng.
if (app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'ttsau-scaffold'))
}

let mainWindow: BrowserWindow | null = null
let activeRunner: BatchJobRunner | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    resizable: false,
    maximizable: false,
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

  // Import 1 hay nhiều file: mỗi file trả về 1 "group" riêng, main process tự
  // tính sẵn outputDir = folder mới cùng tên file (không đuôi), tạo CẠNH file
  // gốc — theo yêu cầu "add file txt vào thì tự tạo folder + đổi tên audio
  // giống tên file". Không tự split ở đây — trả nguyên `content` để renderer
  // quyết định tách theo Auto Split đang bật/tắt (giống cách xử lý text gõ tay).
  ipcMain.handle('dialog:importFiles', async (): Promise<ImportedFileGroup[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text / Subtitles', extensions: ['txt', 'srt', 'dgt'] }]
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map((filePath) => readImportedFileGroup(filePath)))
  })

  ipcMain.handle('dialog:importFolder', async (): Promise<ImportedFileGroup[]> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return []
    const dir = result.filePaths[0]
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const groups: ImportedFileGroup[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = entry.name.slice(entry.name.lastIndexOf('.'))
      if (!['.txt', '.srt', '.dgt'].includes(ext)) continue
      groups.push(await readImportedFileGroup(join(dir, entry.name)))
    }
    return groups
  })

  // Dùng khi Auto Split TẮT (hoặc cho .srt — luôn tách theo block phụ đề gốc,
  // không áp Auto Split lên trên): trả lại đúng cách tách "mỗi dòng/1 block =
  // 1 đoạn" như cũ, không qua autoSplitText.
  ipcMain.handle('text:extractLines', (_e, content: string, ext: string) =>
    extractLinesFromFileContent(content, ext)
  )

  ipcMain.handle('shell:openPath', async (_e, path: string) => {
    await shell.openPath(path)
  })

  // --- Text utils ---
  ipcMain.handle('text:autoSplit', (_e, text: string, delimiters: string) =>
    autoSplitText(text, delimiters)
  )

  // --- Batch job ---
  // Chạy 1 job (mới hoặc đã lưu) + ghi trạng thái xuống đĩa sau mỗi thay
  // đổi. Xong hết mọi đoạn thì xoá file trạng thái; còn đoạn chưa xong thì
  // giữ lại để "Chạy tiếp".
  async function runJob(
    sender: Electron.WebContents,
    apiKey: string,
    job: BatchJobConfig,
    items: JobItem[],
    createdAt: number
  ): Promise<void> {
    if (activeRunner) {
      throw new Error('Đã có 1 batch job đang chạy — bấm Stop trước khi chạy job mới.')
    }
    const persister = jobStateStore.createJobPersister(job, createdAt)
    activeRunner = new BatchJobRunner(
      apiKey,
      job,
      items,
      (progress) => sender.send('batchJob:progress', progress),
      persister.persist
    )
    try {
      const result = await activeRunner.run()
      await persister.flush()
      if (result.every((i) => i.status === 'done')) await jobStateStore.clearSavedJob()
    } finally {
      await persister.flush()
      activeRunner = null
    }
  }

  ipcMain.handle(
    'batchJob:start',
    async (event, apiKey: string, job: BatchJobConfig): Promise<BatchStartResult> => {
      if (activeRunner) {
        throw new Error('Đã có 1 batch job đang chạy — bấm Stop trước khi chạy job mới.')
      }
      const stale = await jobStateStore.findStaleOutputs(job.groups)
      if (stale.length > 0) {
        const win = BrowserWindow.fromWebContents(event.sender)
        const opts: Electron.MessageBoxOptions = {
          type: 'warning',
          buttons: ['Xoá file cũ và chạy', 'Huỷ'],
          defaultId: 0,
          cancelId: 1,
          title: 'Thư mục output đã có audio cũ',
          message: `Thư mục output đã có ${stale.length} file audio/srt từ lần chạy trước.`,
          detail:
            'Nếu giữ lại, file cũ sẽ nằm lẫn với kết quả mới (vd. 045.mp3 của lần trước ' +
            'khi lần này chỉ có 30 đoạn). Chỉ xoá file do app tạo (001.mp3, 002.mp3..., ' +
            'file ghép và .srt), không đụng file khác.\n\n' +
            stale.slice(0, 8).join('\n') +
            (stale.length > 8 ? `\n... và ${stale.length - 8} file khác` : '')
        }
        const { response } = win
          ? await dialog.showMessageBox(win, opts)
          : await dialog.showMessageBox(opts)
        if (response !== 0) return { cancelled: true }
        await Promise.all(stale.map((p) => fs.unlink(p).catch(() => {})))
      }

      const items: JobItem[] = job.items.map((i) => ({ ...i, status: 'pending' }))
      await runJob(event.sender, apiKey, job, items, Date.now())
      return { cancelled: false }
    }
  )

  // Chạy tiếp job đã lưu: item đã xong giữ nguyên, item có taskId chỉ tải
  // lại, item lỗi/chưa chạy thì submit. Dùng lại đúng voice/settings gốc.
  ipcMain.handle('batchJob:resume', async (event, apiKey: string): Promise<BatchStartResult> => {
    const saved = await jobStateStore.loadSavedJob()
    if (!saved) throw new Error('Không tìm thấy job cũ để chạy tiếp.')
    await runJob(event.sender, apiKey, saved.config, saved.items, saved.createdAt)
    return { cancelled: false }
  })

  ipcMain.handle('batchJob:getSaved', async () => jobStateStore.loadSavedJob())
  ipcMain.handle('batchJob:discardSaved', async () => {
    if (activeRunner) throw new Error('Không thể bỏ job khi đang chạy.')
    await jobStateStore.clearSavedJob()
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
  initAutoUpdater(() => activeRunner !== null)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
