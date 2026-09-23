export interface SrtEntry {
  text: string
  durationMs: number
}

function formatTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}

// Sinh nội dung file .srt từ danh sách đoạn text + duration audio tương ứng
// (dùng khi "Join Mp3 & Tạo srt" — mục 3.6 CLAUDE.md). `gapMs` = khoảng lặng
// chèn giữa các đoạn khi ghép mp3 (xem joinMp3Files) — phải truyền đúng độ
// dài thật để phụ đề khớp với file ghép.
export function buildSrt(entries: SrtEntry[], gapMs = 0): string {
  let cursorMs = 0
  const blocks: string[] = []
  entries.forEach((entry, i) => {
    const startMs = cursorMs
    const endMs = cursorMs + entry.durationMs
    cursorMs = endMs + gapMs
    blocks.push(
      [
        String(i + 1),
        `${formatTimestamp(startMs)} --> ${formatTimestamp(endMs)}`,
        entry.text,
        ''
      ].join('\n')
    )
  })
  return blocks.join('\n')
}
