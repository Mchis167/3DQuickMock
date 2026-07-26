import { describe, expect, it } from 'vitest'

import { formatTimecode, frameToX, tickFrames, xToFrame } from './scale'

const WIDTH = 600
const LAST = 150

describe('frameToX / xToFrame', () => {
  it('frame đầu ở mép trái, frame cuối ở mép phải', () => {
    expect(frameToX(1, WIDTH, LAST)).toBe(0)
    expect(frameToX(LAST, WIDTH, LAST)).toBe(WIDTH)
  })

  it('đi một vòng rồi về vẫn ra frame cũ', () => {
    for (const frame of [1, 2, 37, 75, 149, 150]) {
      expect(xToFrame(frameToX(frame, WIDTH, LAST), WIDTH, LAST)).toBe(frame)
    }
  })

  it('kẹp vào [1, lastFrame] khi chuột ra ngoài thước', () => {
    expect(xToFrame(-200, WIDTH, LAST)).toBe(1)
    expect(xToFrame(WIDTH + 200, WIDTH, LAST)).toBe(LAST)
  })

  it('không chia cho 0 khi timeline chỉ có một frame', () => {
    expect(xToFrame(300, WIDTH, 1)).toBe(1)
    expect(Number.isFinite(frameToX(1, WIDTH, 1))).toBe(true)
  })

  it('không chia cho 0 khi thước chưa có bề rộng (lần render đầu)', () => {
    expect(xToFrame(0, 0, LAST)).toBe(1)
  })
})

describe('tickFrames', () => {
  it('vạch cách nhau ít nhất mức đọc được', () => {
    const ticks = tickFrames(WIDTH, LAST, 30)
    for (let i = 1; i < ticks.length; i++) {
      const gap = frameToX(ticks[i]!, WIDTH, LAST) - frameToX(ticks[i - 1]!, WIDTH, LAST)
      expect(gap).toBeGreaterThan(20)
    }
  })

  it('luôn có vạch ở frame đầu và frame cuối', () => {
    for (const [w, last, fps] of [
      [600, 150, 30],
      [200, 1800, 30],
      [1200, 60, 24],
    ] as const) {
      const ticks = tickFrames(w, last, fps)
      expect(ticks[0]).toBe(1)
      expect(ticks[ticks.length - 1]).toBe(last)
    }
  })

  it('thước hẹp thì thưa vạch chứ không chồng chữ', () => {
    expect(tickFrames(160, 1800, 30).length).toBeLessThan(tickFrames(1600, 1800, 30).length)
  })
})

describe('formatTimecode', () => {
  it('frame 1 là 0:00.00', () => {
    expect(formatTimecode(1, 30)).toBe('0:00.00')
  })

  it('đếm đúng qua mốc phút', () => {
    expect(formatTimecode(31, 30)).toBe('0:01.00')
    expect(formatTimecode(1801, 30)).toBe('1:00.00')
  })

  it('khi isLast = true thì hiển thị tròn thời lượng giây', () => {
    expect(formatTimecode(150, 30, true)).toBe('0:05.00')
  })
})
