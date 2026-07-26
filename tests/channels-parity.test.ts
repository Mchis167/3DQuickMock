import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHANNEL_KEYS, EASINGS, HANDLE_TYPES, INTERPOLATIONS } from '@schema/channels'

const ROOT = process.cwd()

/**
 * `anim.py` là nơi tên kênh được ánh xạ sang data-path thật của Blender. Nếu
 * `channels.ts` liệt kê một tên không có ở đó, UI sẽ dựng được keyframe rồi Blender
 * ném KeyError giữa lúc render; ngược lại thì kênh có thật nhưng UI không cho chỉnh.
 *
 * Đọc anim.py bằng chính Python, không parse bằng regex — regex sẽ nói dối khi file
 * đổi cách viết.
 */
function pythonLists(): Record<string, string[]> {
  const out = execFileSync(
    'python3',
    [
      '-c',
      `import ast, json, sys
src = open(${JSON.stringify(path.join(ROOT, 'scripts/blender/anim.py'))}).read()
tree = ast.parse(src)

# Không import anim.py được: nó cần bpy. Đọc AST thay vì chạy.
keys, lists = [], {}
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "Channel":
        keys.append(ast.literal_eval(node.args[0]))
    if isinstance(node, ast.Assign):
        target = node.targets[0]
        name = getattr(target, "id", None)
        if name in ("INTERPOLATIONS", "EASINGS", "HANDLE_TYPES"):
            lists[name] = ast.literal_eval(node.value)

print(json.dumps({"CHANNELS": keys, **lists}))`,
    ],
    { encoding: 'utf8', cwd: ROOT },
  )
  return JSON.parse(out.trim())
}

describe('channels.ts khớp anim.py', () => {
  const py = pythonLists()

  it('tên kênh trùng khớp và cùng thứ tự', () => {
    expect(py['CHANNELS']).toEqual([...CHANNEL_KEYS])
  })

  it('13 kiểu nội suy trùng khớp', () => {
    expect(py['INTERPOLATIONS']).toEqual([...INTERPOLATIONS])
  })

  it('4 kiểu easing trùng khớp', () => {
    expect(py['EASINGS']).toEqual([...EASINGS])
  })

  it('5 kiểu tay cầm trùng khớp', () => {
    expect(py['HANDLE_TYPES']).toEqual([...HANDLE_TYPES])
  })
})
