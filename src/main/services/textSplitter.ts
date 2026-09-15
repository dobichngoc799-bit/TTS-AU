// Tương đương "Auto Split" trong app tham khảo (mục 3.5 CLAUDE.md): chẻ văn
// bản dài thành nhiều đoạn theo các ký tự phân tách do user cấu hình
// (mặc định ".,;:!?"). Giữ dấu câu ở cuối mỗi đoạn để câu đọc tự nhiên hơn.
export function autoSplitText(text: string, delimiters: string): string[] {
  const delimiterSet = new Set(delimiters.split(''))
  if (delimiterSet.size === 0) {
    return [text.trim()].filter(Boolean)
  }

  const segments: string[] = []
  let current = ''
  for (const char of text) {
    current += char
    if (delimiterSet.has(char)) {
      const trimmed = current.trim()
      if (trimmed) segments.push(trimmed)
      current = ''
    }
  }
  const rest = current.trim()
  if (rest) segments.push(rest)
  return segments
}

// Import file .txt/.srt/.dgt: với .srt, chỉ lấy phần text (bỏ số thứ tự +
// timestamp); với .txt/.dgt, mỗi dòng không rỗng là 1 đoạn.
export function extractLinesFromFileContent(content: string, extension: string): string[] {
  if (extension === '.srt') {
    return parseSrtText(content)
  }
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function parseSrtText(content: string): string[] {
  const blocks = content.split(/\r?\n\r?\n/)
  const lines: string[] = []
  for (const block of blocks) {
    const blockLines = block.split(/\r?\n/).filter(Boolean)
    // Bỏ dòng số thứ tự (vd "1") và dòng timestamp (chứa "-->")
    const textLines = blockLines.filter(
      (l) => !/^\d+$/.test(l.trim()) && !l.includes('-->')
    )
    const text = textLines.join(' ').trim()
    if (text) lines.push(text)
  }
  return lines
}
