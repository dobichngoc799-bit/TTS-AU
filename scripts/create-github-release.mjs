// Tạo sẵn GitHub release v<version> TRƯỚC khi chạy `electron-builder --publish`.
// Lý do: electron-builder upload nhiều file song song, mỗi file tự "tạo release
// nếu chưa có" → 2 request tạo cùng lúc, 1 cái lỗi 422 và file .exe/latest.yml
// không được upload (đã gặp thật 2026-09-23). Khi release đã tồn tại (< 2 giờ),
// electron-builder chỉ upload vào đó, không tạo nữa.
import { readFileSync } from 'node:fs'

const OWNER = 'dobichngoc799-bit'
const REPO = 'TTS-AU'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`

const token = process.env.GH_TOKEN
if (!token) {
  console.error('Chưa đặt GH_TOKEN. Chạy: $env:GH_TOKEN="<token>" rồi npm run release')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
const tag = `v${version}`
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'tts-v1-release'
}

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`GitHub ${init.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}

const releases = await gh('/releases?per_page=100')
const existing = releases.find((r) => r.tag_name === tag)

if (existing) {
  const hasInstaller = existing.assets.some((a) => a.name.endsWith('.exe'))
  if (hasInstaller) {
    console.error(
      `Release ${tag} đã có file cài rồi. Tăng "version" trong package.json trước khi phát hành bản mới.`
    )
    process.exit(1)
  }
  console.log(`Release ${tag} đã tồn tại (chưa có file cài) — electron-builder sẽ upload vào đó.`)
} else {
  await gh('/releases', {
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: version, draft: false })
  })
  console.log(`Đã tạo release ${tag}.`)
}
