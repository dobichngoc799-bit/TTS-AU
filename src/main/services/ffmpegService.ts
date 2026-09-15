import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

// Trả về duration (ms) của 1 file audio bằng ffprobe.
export async function getAudioDurationMs(filePath: string): Promise<number> {
  const out = await run(ffprobeStatic.path, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath
  ])
  const parsed = JSON.parse(out)
  const seconds = parseFloat(parsed?.format?.duration ?? '0')
  return Math.round(seconds * 1000)
}

// Ghép nhiều mp3 thành 1 file — dùng ffmpeg concat demuxer (không re-encode,
// giữ nguyên chất lượng, nhanh). Yêu cầu các file input cùng codec (đều là
// mp3 do GenVoice trả về nên an toàn).
export async function joinMp3Files(inputPaths: string[], outputPath: string): Promise<void> {
  if (inputPaths.length === 0) throw new Error('joinMp3Files: danh sách input rỗng')

  const listFile = join(tmpdir(), `ttsau-concat-${Date.now()}.txt`)
  const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  await fs.writeFile(listFile, listContent, 'utf-8')

  try {
    await run(ffmpegPath as string, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-c',
      'copy',
      outputPath
    ])
  } finally {
    await fs.unlink(listFile).catch(() => {})
  }
}
