import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Blender KHÔNG có trong PATH trên macOS — nó nằm trong bundle .app. Trước đây đường
 * dẫn bị hardcode ở nhiều script; ở đây dò một lần và báo lỗi có hướng dẫn nếu thiếu.
 *
 * Thứ tự ưu tiên: biến môi trường (người dùng ghi đè được) → PATH → các vị trí cài
 * quen thuộc, bản mới nhất trước.
 */

export const BLENDER_ENV_VAR = 'BLENDER_PATH'

const MAC_APP_DIRS = ['/Applications', path.join(process.env['HOME'] ?? '', 'Applications')]
const LINUX_CANDIDATES = ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender']

export class BlenderNotFoundError extends Error {
  constructor(searched: string[]) {
    super(
      'Không tìm thấy Blender.\n\n' +
        'App cần Blender 4.5 LTS cài sẵn trên máy — nó là bộ render, không kèm theo được.\n' +
        `Đã tìm ở:\n${searched.map((p) => `  - ${p}`).join('\n')}\n\n` +
        `Cách sửa: cài từ https://www.blender.org/download/ hoặc trỏ thẳng đường dẫn:\n` +
        `  ${BLENDER_ENV_VAR}=/duong/dan/toi/Blender pnpm dev`,
    )
    this.name = 'BlenderNotFoundError'
  }
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Các bundle Blender*.app, bản có số hiệu lớn hơn xếp trước. */
function macBundles(): string[] {
  const found: string[] = []
  for (const dir of MAC_APP_DIRS) {
    if (!dir || !existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    const apps = entries
      .filter((n) => /^Blender.*\.app$/i.test(n))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const app of apps) {
      found.push(path.join(dir, app, 'Contents/MacOS/Blender'))
    }
  }
  return found
}

function pathCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'blender.exe' : 'blender'
  return (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, exe))
}

export function candidatePaths(): string[] {
  const fromEnv = process.env[BLENDER_ENV_VAR]
  return [
    ...(fromEnv ? [fromEnv] : []),
    ...pathCandidates(),
    ...(process.platform === 'darwin' ? macBundles() : []),
    ...(process.platform === 'linux' ? LINUX_CANDIDATES : []),
  ]
}

let cached: string | null = null

export function locateBlender(): string {
  if (cached) return cached
  const searched = candidatePaths()
  for (const candidate of searched) {
    if (existsSync(candidate) && isExecutable(candidate)) {
      cached = candidate
      return candidate
    }
  }
  // Biến môi trường trỏ sai thì phải báo riêng — nếu không, người dùng sẽ tưởng
  // mình chưa cài Blender trong khi thật ra chỉ gõ nhầm đường dẫn.
  const fromEnv = process.env[BLENDER_ENV_VAR]
  if (fromEnv) {
    throw new BlenderNotFoundError([`${fromEnv}  (từ ${BLENDER_ENV_VAR}, không chạy được)`])
  }
  throw new BlenderNotFoundError(searched.slice(0, 12))
}

/** Cho test: quên kết quả đã dò. */
export function resetBlenderCache(): void {
  cached = null
}
