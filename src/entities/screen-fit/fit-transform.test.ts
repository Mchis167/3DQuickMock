import { describe, expect, it } from 'vitest'

import { screenFitTransform } from './index'

/** Màn hình iPhone 17 Pro Max: 73 × 158 mm ≈ 19.5:9. */
const SCREEN = { width: 73, height: 158 }
const WIDE = { width: 1920, height: 1080 } // 16:9 nằm ngang
const TALL = { width: 1080, height: 1920 } // 9:16, vẫn rộng hơn màn hình
const EXACT = { width: 730, height: 1580 }

describe('phép khớp tỉ lệ cho video (biến đổi toạ độ)', () => {
  it('stretch không đổi gì — và đó chính là lý do nó méo', () => {
    expect(screenFitTransform(WIDE, SCREEN, 'stretch')).toEqual({
      scale: { x: 1, y: 1 },
      letterbox: false,
    })
  })

  it('nội dung ĐÚNG tỉ lệ màn hình thì cả ba chế độ đều là phép đồng nhất', () => {
    for (const mode of ['fill', 'fit', 'stretch'] as const) {
      const { scale } = screenFitTransform(EXACT, SCREEN, mode)
      expect(scale.x, mode).toBeCloseTo(1, 6)
      expect(scale.y, mode).toBeCloseTo(1, 6)
    }
  })

  it('fill thì PHÓNG TO và cắt; fit thì THU NHỎ và để dải đen', () => {
    const fill = screenFitTransform(WIDE, SCREEN, 'fill')
    const fit = screenFitTransform(WIDE, SCREEN, 'fit')
    // Video 16:9 rộng hơn màn hình 9:19.5 rất nhiều -> fill cắt hai bên.
    expect(fill.scale.x).toBeLessThan(1)
    expect(fill.scale.y).toBe(1)
    expect(fill.letterbox).toBe(false)
    // fit giữ trọn chiều rộng -> phải lấy mẫu rộng hơn theo chiều dọc, sinh dải đen.
    expect(fit.scale.y).toBeGreaterThan(1)
    expect(fit.letterbox).toBe(true)
  })

  it('fill và fit là hai chiều NGƯỢC nhau trên cùng một nội dung', () => {
    // Bất biến này bắt được ca đảo dấu — thứ vẫn cho ra ảnh trông hợp lý, chỉ sai chế độ.
    for (const source of [WIDE, TALL]) {
      const fill = screenFitTransform(source, SCREEN, 'fill')
      const fit = screenFitTransform(source, SCREEN, 'fit')
      const fillArea = fill.scale.x * fill.scale.y
      const fitArea = fit.scale.x * fit.scale.y
      expect(fillArea).toBeLessThanOrEqual(1 + 1e-9)
      expect(fitArea).toBeGreaterThanOrEqual(1 - 1e-9)
    }
  })

  it('kích thước không dương thì báo lỗi, không trả về NaN', () => {
    expect(() => screenFitTransform({ width: 0, height: 10 }, SCREEN, 'fill')).toThrow(/dương/)
  })
})
