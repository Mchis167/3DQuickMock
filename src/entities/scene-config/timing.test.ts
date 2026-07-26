import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { frameCount } from './timing'

describe('frameCount', () => {
  it('ưu tiên frames tuyệt đối hơn duration', () => {
    expect(frameCount({ fps: 30, duration: 5, frames: 90 })).toBe(90)
  })

  it('quy duration ra frame theo fps', () => {
    expect(frameCount({ fps: 30, duration: 5 })).toBe(150)
    expect(frameCount({ fps: 60, duration: 2.5 })).toBe(150)
    expect(frameCount({ fps: 24, duration: 4 })).toBe(96)
  })

  it('mặc định 5 giây khi thiếu duration', () => {
    expect(frameCount({ fps: 30 })).toBe(150)
  })

  it('làm tròn giống Python, kể cả ở đúng mốc .5', () => {
    // Python round() làm tròn ngân hàng; Math.round của JS thì không. Các cặp dưới
    // đây rơi đúng .5 nên là chỗ duy nhất hai ngôn ngữ lệch nhau.
    const cases: [number, number][] = [
      [25, 4.02], // 100.5 -> 100
      [30, 4.05], // 121.5 -> 122
      [10, 0.25], // 2.5   -> 2
      [10, 0.35], // 3.5   -> 4
    ]

    const expected = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `import json
print(json.dumps([round(f*d) for f, d in ${JSON.stringify(cases)}]))`,
        ],
        { encoding: 'utf8' },
      ).trim(),
    ) as number[]

    expect(cases.map(([fps, duration]) => frameCount({ fps, duration }))).toEqual(expected)
  })
})
