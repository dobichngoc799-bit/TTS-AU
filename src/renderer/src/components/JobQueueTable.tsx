import { useJobStore } from '../store/jobStore'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ',
  submitting: 'Đang gửi...',
  polling: 'Đang xử lý...',
  queued_on_server: 'Server đang xử lý',
  rate_limited: 'Đợi rate limit',
  done: 'Xong',
  error: 'Lỗi',
  skipped: 'Đã bỏ qua',
  interrupted: 'Chưa tải xong'
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500',
  submitting: 'bg-blue-50 text-blue-600',
  polling: 'bg-blue-50 text-blue-600',
  queued_on_server: 'bg-blue-50 text-blue-600',
  rate_limited: 'bg-amber-50 text-amber-600',
  done: 'bg-emerald-50 text-emerald-600',
  error: 'bg-red-50 text-red-600',
  skipped: 'bg-gray-100 text-gray-500',
  interrupted: 'bg-amber-50 text-amber-600'
}

export function JobQueueTable(): React.JSX.Element {
  const { items, done, processing, total, elapsedMs } = useJobStore()
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <section className="flex min-h-[160px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2">
        <span className="h-4 w-1 rounded-full bg-indigo-500" />
        <h2 className="text-sm font-semibold text-gray-800">Subtitles</h2>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-indigo-500 transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-xs text-gray-500">
          Done: <span className="font-medium text-gray-700">{done}</span> · Processing:{' '}
          <span className="font-medium text-gray-700">{processing}</span> · Total:{' '}
          <span className="font-medium text-gray-700">{total}</span>
        </span>
        <span className="ml-auto text-xs text-gray-400">
          Elapsed: {Math.round(elapsedMs / 1000)}s
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs font-medium tracking-wide text-gray-500 uppercase">
            <tr>
              <th className="w-12 px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Text</th>
              <th className="w-36 px-4 py-2.5 font-medium">Status</th>
              <th className="w-24 px-4 py-2.5 font-medium">Credits</th>
              <th className="px-4 py-2.5 font-medium">Lỗi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={item.id}
                className={`border-t border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}
              >
                <td className="px-4 py-3 text-gray-400">{item.index + 1}</td>
                <td className="px-4 py-3 leading-relaxed text-gray-700">{item.sourceText}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[item.status] ?? 'bg-gray-100 text-gray-500'}`}
                  >
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 tabular-nums">
                  {item.creditsDeducted ?? '–'}
                </td>
                <td
                  className={`max-w-xs px-4 py-3 ${item.status === 'interrupted' ? 'text-amber-600' : 'text-red-500'}`}
                >
                  {item.errorMessage ?? ''}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-center text-sm text-gray-400">
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
