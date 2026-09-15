import { useJobStore } from '../store/jobStore'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ',
  submitting: 'Đang gửi...',
  polling: 'Đang xử lý...',
  queued_on_server: 'Server đang xử lý',
  done: 'Xong',
  error: 'Lỗi',
  skipped: 'Đã bỏ qua'
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-gray-400',
  submitting: 'text-blue-500',
  polling: 'text-blue-500',
  queued_on_server: 'text-blue-500',
  done: 'text-emerald-600',
  error: 'text-red-500',
  skipped: 'text-gray-400'
}

export function JobQueueTable(): React.JSX.Element {
  const { items, done, processing, total, elapsedMs } = useJobStore()

  return (
    <section className="flex flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-sm text-gray-600">
        Subtitles (Done: {done} Processing: {processing} Total: {total}) Elapsed:{' '}
        {Math.round(elapsedMs / 1000)}s
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Text</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Credits</th>
              <th className="px-3 py-2">Lỗi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-400">{item.index + 1}</td>
                <td className="max-w-md truncate px-3 py-1.5">{item.sourceText}</td>
                <td className={`px-3 py-1.5 font-medium ${STATUS_COLOR[item.status] ?? ''}`}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </td>
                <td className="px-3 py-1.5 text-gray-500">{item.creditsDeducted ?? '-'}</td>
                <td className="max-w-xs truncate px-3 py-1.5 text-red-500">
                  {item.errorMessage ?? ''}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                  Chưa có job nào — nhập text và bấm Start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
