import { describe, expect, it } from 'vitest'

import {
  centerView,
  clampScale,
  fitScale,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  wheelFactor,
  zoomAt,
} from './zoom'

const VIEWPORT = { width: 800, height: 600 }
const CONTENT = { width: 480, height: 640 }

describe('zoomAt — giữ điểm dưới con trỏ bất động', () => {
  it('điểm dưới con trỏ không xê dịch sau khi zoom', () => {
    const view = { scale: 1, offset: { x: 100, y: 50 } }
    const cursor = { x: 300, y: 200 }
    // Toạ độ trong ảnh của điểm đang nằm dưới con trỏ.
    const before = {
      x: (cursor.x - view.offset.x) / view.scale,
      y: (cursor.y - view.offset.y) / view.scale,
    }

    const next = zoomAt(view, 2, cursor)
    const after = {
      x: (cursor.x - next.offset.x) / next.scale,
      y: (cursor.y - next.offset.y) / next.scale,
    }

    // Đây là toàn bộ mục đích của hàm: sai dấu là ảnh trôi khỏi con trỏ.
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('zoom quanh gốc toạ độ thì offset không đổi', () => {
    const next = zoomAt({ scale: 1, offset: { x: 0, y: 0 } }, 2, { x: 0, y: 0 })
    expect(next.offset).toEqual({ x: 0, y: 0 })
    expect(next.scale).toBe(2)
  })

  it('kẹp ở tỉ lệ tối đa và tối thiểu', () => {
    expect(zoomAt({ scale: 6, offset: { x: 0, y: 0 } }, 100, { x: 0, y: 0 }).scale).toBe(
      MAX_SCALE,
    )
    expect(zoomAt({ scale: 0.2, offset: { x: 0, y: 0 } }, 0.001, { x: 0, y: 0 }).scale).toBe(
      MIN_SCALE,
    )
  })

  it('đã chạm biên thì KHÔNG dịch ảnh nữa', () => {
    const view = { scale: MAX_SCALE, offset: { x: 30, y: 40 } }
    // Cuộn tiếp ở mức tối đa: nếu vẫn tính offset thì ảnh trôi đi trong khi tỉ lệ đứng yên,
    // trông như bug mà rất khó mô tả.
    expect(zoomAt(view, 1.5, { x: 100, y: 100 })).toBe(view)
  })

  it('zoom ra rồi zoom vào cùng điểm thì về đúng chỗ cũ', () => {
    const view = { scale: 1.5, offset: { x: -20, y: 35 } }
    const cursor = { x: 250, y: 180 }
    const round = zoomAt(zoomAt(view, 0.5, cursor), 2, cursor)
    expect(round.scale).toBeCloseTo(view.scale, 9)
    expect(round.offset.x).toBeCloseTo(view.offset.x, 9)
    expect(round.offset.y).toBeCloseTo(view.offset.y, 9)
  })
})

describe('panBy', () => {
  it('dịch theo đúng delta, không phụ thuộc tỉ lệ', () => {
    const next = panBy({ scale: 3, offset: { x: 10, y: 10 } }, -5, 25)
    expect(next).toEqual({ scale: 3, offset: { x: 5, y: 35 } })
  })
})

describe('centerView', () => {
  it('đặt ảnh vào giữa khung nhìn', () => {
    const view = centerView(VIEWPORT, CONTENT, 1)
    expect(view.offset.x).toBe((800 - 480) / 2)
    expect(view.offset.y).toBe((600 - 640) / 2)
    // Ảnh cao hơn khung nên offset y âm — đúng, phần trên/dưới bị tràn đều nhau.
    expect(view.offset.y).toBeLessThan(0)
  })

  it('tâm ảnh trùng tâm khung nhìn ở mọi tỉ lệ', () => {
    for (const scale of [0.5, 1, 2.5]) {
      const view = centerView(VIEWPORT, CONTENT, scale)
      expect(view.offset.x + (CONTENT.width * scale) / 2).toBeCloseTo(VIEWPORT.width / 2, 9)
      expect(view.offset.y + (CONTENT.height * scale) / 2).toBeCloseTo(VIEWPORT.height / 2, 9)
    }
  })
})

describe('fitScale', () => {
  it('lấy chiều bị giới hạn — ảnh dọc trong khung ngang thì theo chiều cao', () => {
    expect(fitScale(VIEWPORT, CONTENT)).toBeCloseTo(600 / 640, 9)
  })

  it('ảnh ngang trong khung dọc thì theo chiều rộng', () => {
    expect(fitScale({ width: 400, height: 900 }, { width: 800, height: 600 })).toBeCloseTo(
      0.5,
      9,
    )
  })

  it('kích thước 0 thì trả về 1, không ra NaN hay Infinity', () => {
    // Xảy ra thật ở lần render đầu: ảnh chưa tải nên naturalWidth = 0.
    expect(fitScale(VIEWPORT, { width: 0, height: 0 })).toBe(1)
  })
})

describe('wheelFactor', () => {
  it('cuộn lên phóng to, cuộn xuống thu nhỏ', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
  })

  it('hai lần cuộn ngược nhau triệt tiêu nhau', () => {
    expect(wheelFactor(-40) * wheelFactor(40)).toBeCloseTo(1, 9)
  })

  it('không cuộn thì không đổi gì', () => {
    expect(wheelFactor(0)).toBe(1)
  })
})

describe('clampScale', () => {
  it('giữ trong khoảng cho phép', () => {
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(999)).toBe(MAX_SCALE)
    expect(clampScale(2)).toBe(2)
  })
})
