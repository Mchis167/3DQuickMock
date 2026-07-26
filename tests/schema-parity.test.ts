import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { safeParseSceneConfig } from '@schema/scene-config'
import { OUTPUT_RELATIVE_PATH, serialize } from '@schema/generate'

// Vitest chạy với cwd là gốc repo; `import.meta.url` không phải file URL dưới jsdom.
const ROOT = process.cwd()
const FIXTURES = path.join(ROOT, 'tests/fixtures/config')

/**
 * Phép kiểm quan trọng nhất của Pha 1: hai phía phải cho CÙNG một phán quyết.
 *
 * Schema sống ở hai ngôn ngữ. Nếu Python lỏng hơn Zod thì config sai vẫn render ra
 * ảnh sai mà không báo gì — đúng loại lỗi im lặng dự án này đã gặp bốn lần. Test này
 * chạy cả hai bên trên cùng bộ fixture nên độ lệch lộ ra ngay, kể cả với hai luật
 * `.refine()` phải chép tay sang Python.
 */

interface PyResult {
  ok: boolean
  errors: string[]
}

function validatePython(fixturePath: string): PyResult {
  const out = execFileSync(
    'python3',
    [
      '-c',
      `import json,sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts/blender'))})
import validate_config as v
cfg = json.load(open(sys.argv[1]))
errs = v.validate(cfg)
print(json.dumps({"ok": not errs, "errors": errs}))`,
      fixturePath,
    ],
    { encoding: 'utf8', cwd: ROOT },
  )
  return JSON.parse(out.trim().split('\n').pop() ?? '{}')
}

const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()

describe('Zod và Python phán quyết giống nhau', () => {
  it.each(fixtures)('%s', (name) => {
    const file = path.join(FIXTURES, name)
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))

    const zod = safeParseSceneConfig(raw)
    const py = validatePython(file)
    const expected = name.startsWith('valid-')

    expect(zod.success, `Zod: ${JSON.stringify(zod.error?.issues)}`).toBe(expected)
    expect(py.ok, `Python: ${py.errors.join(' | ')}`).toBe(expected)
  })
})

describe('config thật trong repo', () => {
  const real = ['configs/turntable_loop.json', 'configs/hero_cinematic.json']

  it.each(real)('%s hợp lệ ở cả hai phía', (rel) => {
    const file = path.join(ROOT, rel)
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const zod = safeParseSceneConfig(raw)
    expect(zod.success, JSON.stringify(zod.error?.issues)).toBe(true)
    expect(validatePython(file).ok).toBe(true)
  })
})

describe('JSON Schema đã commit', () => {
  it('khớp với nguồn Zod hiện tại', () => {
    // File này phải commit vì Python của Blender không chạy được Node. Nếu quên chạy
    // `pnpm schema:gen` thì Python sẽ validate theo hợp đồng CŨ mà không báo gì.
    const committed = readFileSync(path.join(ROOT, OUTPUT_RELATIVE_PATH), 'utf8')
    expect(committed).toBe(serialize())
  })

  it('không chứa từ khoá mà validator Python chưa hiểu', () => {
    const out = execFileSync(
      'python3',
      [
        '-c',
        `import sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts/blender'))})
import validate_config as v
v.check_schema_keywords(v.load_schema())
print("OK")`,
      ],
      { encoding: 'utf8', cwd: ROOT },
    )
    expect(out.trim()).toBe('OK')
  })
})
