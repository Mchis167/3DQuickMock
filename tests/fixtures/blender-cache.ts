import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Bộ nhớ đệm cho những thứ Blender render trong test integration.
 *
 * Vì sao cần: một plate Cycles mất hàng chục giây, và bộ test export gọi nó nhiều lần. Vòng
 * lặp sửa-chạy vì thế dài tới mức người ta ngại chạy — mà một phép kiểm không ai chạy thì
 * không bảo vệ được gì.
 *
 * Khoá theo NỘI DUNG yêu cầu, không theo tên: đổi một tham số scene là ra khoá khác và tự
 * render lại. Nên cache không thể trả về kết quả cũ cho một cấu hình mới — đúng loại lỗi im
 * lặng mà dự án này sợ.
 *
 * Xoá bằng `rm -rf cache/test-fixtures`.
 */

const DIR = 'cache/test-fixtures'

export function fixtureKey(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)
}

export function fixtureDir(root: string, kind: string, key: string): string {
  return path.join(root, DIR, `${kind}-${key}`)
}

/**
 * Trả về kết quả đã đệm, hoặc chạy `produce` rồi đệm lại.
 *
 * `produce` trả về (kết quả JSON, danh sách file tuyệt đối cần giữ). File được CHÉP vào thư
 * mục fixture: nguồn nằm trong `cache/plate/<uuid>` và có thể bị dọn bất cứ lúc nào.
 */
export async function cached<T extends Record<string, unknown>>(
  root: string,
  kind: string,
  input: unknown,
  produce: () => Promise<{ value: T; files: string[] }>,
): Promise<{ value: T; dir: string; hit: boolean }> {
  const key = fixtureKey(input)
  const dir = fixtureDir(root, kind, key)
  const marker = path.join(dir, 'fixture.json')
  if (existsSync(marker)) {
    return { value: JSON.parse(readFileSync(marker, 'utf8')) as T, dir, hit: true }
  }
  mkdirSync(dir, { recursive: true })
  const { value, files } = await produce()
  for (const file of files) copyFileSync(file, path.join(dir, path.basename(file)))
  writeFileSync(marker, JSON.stringify(value, null, 2))
  return { value, dir, hit: false }
}
