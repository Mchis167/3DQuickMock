import { describe, expect, it } from 'vitest'

import { EASINGS, INTERPOLATIONS } from '@/entities/scene-config'

import { curveIconPoints } from './curve-shape'

describe('curveIconPoints', () => {
  it('mọi tổ hợp 13×4 đều sinh 24 điểm hữu hạn, không NaN', () => {
    for (const interpolation of INTERPOLATIONS) {
      for (const easing of EASINGS) {
        const points = curveIconPoints(interpolation, easing)
        expect(points).toHaveLength(24)
        for (const [t, y] of points) {
          expect(Number.isFinite(t)).toBe(true)
          expect(Number.isFinite(y)).toBe(true)
        }
      }
    }
  })

  it('t chạy từ 0 đến 1 đều đặn', () => {
    const points = curveIconPoints('LINEAR', 'AUTO')
    expect(points[0]![0]).toBe(0)
    expect(points[points.length - 1]![0]).toBe(1)
  })

  it('LINEAR và CONSTANT không đổi hình theo easing — chúng không có gia tốc', () => {
    for (const interpolation of ['LINEAR', 'CONSTANT'] as const) {
      const a = curveIconPoints(interpolation, 'EASE_IN')
      const b = curveIconPoints(interpolation, 'EASE_OUT')
      expect(a).toEqual(b)
    }
  })

  it('CONSTANT giữ nguyên 0 rồi nhảy thẳng lên 1 ở điểm cuối', () => {
    const points = curveIconPoints('CONSTANT', 'AUTO')
    expect(points.slice(0, -1).every(([, y]) => y === 0)).toBe(true)
    expect(points[points.length - 1]![1]).toBe(1)
  })

  it('EASE_IN và EASE_OUT của cùng một kiểu là ảnh gương nhau', () => {
    const a = curveIconPoints('QUAD', 'EASE_IN')
    const b = curveIconPoints('QUAD', 'EASE_OUT')
    for (let i = 0; i < a.length; i++) {
      expect(b[i]![1]).toBeCloseTo(1 - a[a.length - 1 - i]![1], 5)
    }
  })

  it('mọi hình đi từ gần 0 tới gần 1 (cho phép overshoot của BACK/ELASTIC/BOUNCE)', () => {
    for (const interpolation of INTERPOLATIONS) {
      const points = curveIconPoints(interpolation, 'AUTO')
      const [, firstY] = points[0]!
      const [, lastY] = points[points.length - 1]!
      expect(firstY).toBeLessThan(0.3)
      expect(lastY).toBeGreaterThan(0.7)
    }
  })
})
