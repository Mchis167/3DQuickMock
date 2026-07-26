/**
 * Sinh JSON Schema từ nguồn Zod, ghi ra file để COMMIT vào repo.
 *
 * Phải commit vì Python của Blender không chạy được Node — nó chỉ đọc file JSON.
 * Test `schema-freshness.test.ts` bắt lỗi khi file commit đã cũ so với nguồn Zod.
 *
 *   pnpm schema:gen
 */

import { z } from 'zod'

import { SCHEMA_VERSION, sceneConfigSchema } from './scene-config'

/** Tương đối so với gốc repo — tránh `import.meta.url`, thứ không phải file URL
 *  khi chạy dưới jsdom của Vitest. */
export const OUTPUT_RELATIVE_PATH = 'schema/scene-config.schema.json'

/**
 * Zod xuất tuple thành `prefixItems` mà KHÔNG kèm giới hạn độ dài, nên
 * `res: [1080]` và `res: [1, 2, 3]` lọt qua JSON Schema dù Zod chặn cả hai.
 * Đây đúng là kiểu lệch schema giữa hai ngôn ngữ mà §5 muốn tránh — siết lại tại đây.
 */
function tightenTuples(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tightenTuples)
  if (node === null || typeof node !== 'object') return node

  const obj = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = tightenTuples(v)

  if (Array.isArray(obj['prefixItems']) && obj['items'] === undefined) {
    const n = obj['prefixItems'].length
    out['minItems'] = n
    out['maxItems'] = n
    out['items'] = false
  }
  return out
}

export function buildJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment: 'SINH TỰ ĐỘNG từ schema/scene-config.ts — đừng sửa tay. Chạy `pnpm schema:gen`.',
    title: `3DQuickMock scene config v${SCHEMA_VERSION}`,
    // `io: 'input'` để schema mô tả thứ NGƯỜI TA VIẾT (field có default là optional),
    // không phải thứ sau khi Zod điền default. Python validate đầu vào thô.
    ...(tightenTuples(
      z.toJSONSchema(sceneConfigSchema, { io: 'input', target: 'draft-2020-12' }),
    ) as Record<string, unknown>),
  }
}

export function serialize() {
  return JSON.stringify(buildJsonSchema(), null, 2) + '\n'
}
