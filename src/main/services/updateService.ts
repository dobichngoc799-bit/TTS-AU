import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

// Auto-update qua GitHub Releases — xem CLAUDE.md mục "Auto-update".
// electron-builder khi build với `--publish always` sẽ upload installer +
// latest-mac.yml/latest.yml lên GitHub Releases của repo cấu hình trong
// electron-builder.yml (publish.owner/publish.repo). App lúc chạy production
// tự tải file yml đó để biết có version mới không.
// `isBusy`: có batch job đang chạy (tốn credit thật) — khi đó KHÔNG restart
// để cài update vì sẽ huỷ các item chưa xong; bản mới tự cài khi user tắt app
// (autoInstallOnAppQuit mặc định bật).
export function initAutoUpdater(isBusy: () => boolean = () => false): void {
  // Không check update khi chạy `npm run dev` (app chưa packaged, không có
  // gì để so sánh version, và electron-updater sẽ báo lỗi vô nghĩa).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Có bản cập nhật mới',
        message: `Đã có bản ${info.version}, bạn đang dùng ${app.getVersion()}. Tải về ngay?`,
        buttons: ['Tải về', 'Để sau'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.downloadUpdate()
      })
  })

  autoUpdater.on('update-downloaded', () => {
    if (isBusy()) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Đã tải xong bản cập nhật',
        message:
          'Đang có batch job chạy nên chưa khởi động lại. Bản mới sẽ tự cài khi bạn tắt app.'
      })
      return
    }
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Đã tải xong bản cập nhật',
        message: 'Khởi động lại app để cài bản mới?',
        buttons: ['Khởi động lại', 'Để sau'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
  })

  autoUpdater.on('error', (err) => {
    // Không làm phiền user bằng dialog cho mỗi lỗi mạng vặt (vd offline) —
    // chỉ log để debug khi cần.
    console.error('[autoUpdater]', err)
  })

  autoUpdater.checkForUpdates().catch((err) => console.error('[autoUpdater] check failed', err))
}
