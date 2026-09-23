import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import ffmpegPathRaw from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

// ffmpeg-static/ffprobe-static trả về path bên trong app.asar khi build
// production — asar là archive nên binary không chạy trực tiếp từ đó được.
// electron-builder.yml đã cấu hình asarUnpack cho 2 package này (giải nén
// ra app.asar.unpacked cạnh app.asar), nên chỉ cần thay chuỗi path tương ứng.
function unpackAsarPath(p: string): string {
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}

const ffmpegPath = unpackAsarPath(ffmpegPathRaw as string)
const ffprobePath = unpackAsarPath(ffprobeStatic.path)

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
  const out = await run(ffprobePath, [
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

// Tạo 1 file mp3 im lặng dài `seconds`, cùng sample rate + số kênh với
// `referencePath` — để concat demuxer ghép chung với audio GenVoice mà không
// cần re-encode (mp3 khác bitrate vẫn nối được, nhưng khác sample rate/kênh
// thì player dễ lỗi). Trả về duration thật (mp3 làm tròn theo frame ~26ms).
async function createSilenceMp3(
  referencePath: string,
  seconds: number,
  outputPath: string
): Promise<number> {
  const out = await run(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels',
    '-of',
    'json',
    referencePath
  ])
  const stream = JSON.parse(out)?.streams?.[0] ?? {}
  const sampleRate = Number(stream.sample_rate) || 44100
  const channels = Number(stream.channels) || 1
  await run(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=${sampleRate}:cl=${channels === 1 ? 'mono' : 'stereo'}`,
    '-t',
    String(seconds),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    outputPath
  ])
  return getAudioDurationMs(outputPath)
}

// Ghép nhiều mp3 thành 1 file — dùng ffmpeg concat demuxer (không re-encode,
// giữ nguyên chất lượng, nhanh). Yêu cầu các file input cùng codec (đều là
// mp3 do GenVoice trả về nên an toàn). `gapSeconds` > 0 thì chèn khoảng lặng
// giữa các đoạn (không chèn sau đoạn cuối). Trả về độ dài thật (ms) của mỗi
// khoảng lặng để tính SRT cho khớp (0 nếu không chèn).
export async function joinMp3Files(
  inputPaths: string[],
  outputPath: string,
  gapSeconds = 0
): Promise<number> {
  if (inputPaths.length === 0) throw new Error('joinMp3Files: danh sách input rỗng')

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const listFile = join(tmpdir(), `ttsau-concat-${stamp}.txt`)
  const silenceFile = join(tmpdir(), `ttsau-silence-${stamp}.mp3`)
  const useGap = gapSeconds > 0 && inputPaths.length > 1
  const gapMs = useGap ? await createSilenceMp3(inputPaths[0], gapSeconds, silenceFile) : 0

  const entry = (p: string): string => `file '${p.replace(/'/g, "'\\''")}'`
  const listLines: string[] = []
  inputPaths.forEach((p, i) => {
    if (useGap && i > 0) listLines.push(entry(silenceFile))
    listLines.push(entry(p))
  })
  await fs.writeFile(listFile, listLines.join('\n'), 'utf-8')

  try {
    await run(ffmpegPath, [
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
    if (useGap) await fs.unlink(silenceFile).catch(() => {})
  }
  return gapMs
}
