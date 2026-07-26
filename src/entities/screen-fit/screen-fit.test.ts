import { describe, expect, it } from 'vitest'

import { planScreenFit, screenTargetSize, type FitMode, type Size } from './index'

/** Màn hình iPhone 17 Pro Max: 73 × 158 mm. Đích tính theo tỉ lệ đó. */
const SCREEN: Size = screenTargetSize({ width: 73, height: 158 }, 1179)

const INPUTS: Record<string, Size> = {
  'video 16:9': { width: 1920, height: 1080 },
  'ảnh đúng tỉ lệ máy': { width: 1179, height: 2552 },
  'ảnh vuông': { width: 1000, height: 1000 },
  'ảnh dọc hơn máy': { width: 800, height: 2400 },
  'ảnh siêu rộng 21:9': { width: 2560, height: 1080 },
  'ảnh nhỏ hơn đích': { width: 300, height: 650 },
}

const MODES: FitMode[] = ['fill', 'fit', 'stretch']

describe('screenTargetSize', () => {
  it('giữ đúng tỉ lệ mesh màn hình', () => {
    expect(SCREEN.width).toBe(1179)
    expect(SCREEN.height).toBe(Math.round((1179 * 158) / 73))
    expect(SCREEN.width / SCREEN.height).toBeCloseTo(73 / 158, 4)
  })
})

describe('planScreenFit — bất biến chung cho cả ba chế độ', () => {
  for (const [name, source] of Object.entries(INPUTS)) {
    for (const mode of MODES) {
      it(`${mode} · ${name}: ảnh ra luôn đúng kích thước màn hình`, () => {
        const plan = planScreenFit(source, SCREEN, mode)
        // Đây là bất biến quan trọng nhất: Blender kéo giãn ảnh phủ kín màn hình, nên ảnh
        // ra sai tỉ lệ là méo mà không ai báo.
        expect(plan.output).toEqual(SCREEN)

        // Vùng cắt phải nằm trong ảnh gốc.
        expect(plan.crop.left).toBeGreaterThanOrEqual(0)
        expect(plan.crop.top).toBeGreaterThanOrEqual(0)
        expect(plan.crop.left + plan.crop.width).toBeLessThanOrEqual(source.width)
        expect(plan.crop.top + plan.crop.height).toBeLessThanOrEqual(source.height)

        // Ảnh sau thu/phóng phải nằm trong khung ra.
        expect(plan.offset.left).toBeGreaterThanOrEqual(0)
        expect(plan.offset.top).toBeGreaterThanOrEqual(0)
        expect(plan.offset.left + plan.resize.width).toBeLessThanOrEqual(SCREEN.width)
        expect(plan.offset.top + plan.resize.height).toBeLessThanOrEqual(SCREEN.height)

        // Mọi số là pixel nguyên: lệch nửa pixel làm ảnh có chữ bị nhoè.
        for (const value of [
          plan.crop.left,
          plan.crop.top,
          plan.crop.width,
          plan.crop.height,
          plan.resize.width,
          plan.resize.height,
          plan.offset.left,
          plan.offset.top,
        ]) {
          expect(Number.isInteger(value)).toBe(true)
        }
      })
    }
  }
})

describe('fill + crop', () => {
  it('video 16:9 bị cắt hai bên, KHÔNG méo', () => {
    const plan = planScreenFit(INPUTS['video 16:9']!, SCREEN, 'fill')
    // Ảnh vào rộng hơn nhiều -> phải cắt chiều RỘNG, giữ nguyên chiều cao.
    expect(plan.crop.height).toBe(1080)
    expect(plan.crop.width).toBeLessThan(1920)
    expect(plan.crop.width / plan.crop.height).toBeCloseTo(SCREEN.width / SCREEN.height, 3)
    expect(plan.cropped).toBe(true)
    expect(plan.distorted).toBe(false)
    expect(plan.letterboxed).toBe(false)
  })

  it('cắt ở giữa, không lệch về một phía', () => {
    const plan = planScreenFit({ width: 2000, height: 1000 }, SCREEN, 'fill')
    const right = 2000 - (plan.crop.left + plan.crop.width)
    expect(Math.abs(plan.crop.left - right)).toBeLessThanOrEqual(1)
  })

  it('ảnh dọc hơn máy thì cắt trên-dưới', () => {
    const plan = planScreenFit(INPUTS['ảnh dọc hơn máy']!, SCREEN, 'fill')
    expect(plan.crop.width).toBe(800)
    expect(plan.crop.height).toBeLessThan(2400)
    expect(plan.crop.top).toBeGreaterThan(0)
  })

  it('ảnh đã đúng tỉ lệ thì không cắt gì', () => {
    const plan = planScreenFit({ width: 1179, height: 2552 }, SCREEN, 'fill')
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 1179, height: 2552 })
    expect(plan.cropped).toBe(false)
  })
})

describe('fit + dải đen', () => {
  it('video 16:9 giữ trọn nội dung, thêm dải trên-dưới', () => {
    const plan = planScreenFit(INPUTS['video 16:9']!, SCREEN, 'fit')
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 1920, height: 1080 })
    expect(plan.resize.width).toBe(SCREEN.width)
    expect(plan.resize.height).toBeLessThan(SCREEN.height)
    // Dải nằm trên và dưới, cân nhau.
    expect(plan.offset.left).toBe(0)
    expect(plan.offset.top).toBeGreaterThan(0)
    expect(plan.letterboxed).toBe(true)
    expect(plan.cropped).toBe(false)
  })

  it('giữ đúng tỉ lệ gốc sau khi thu nhỏ', () => {
    const source = INPUTS['ảnh siêu rộng 21:9']!
    const plan = planScreenFit(source, SCREEN, 'fit')
    expect(plan.resize.width / plan.resize.height).toBeCloseTo(source.width / source.height, 2)
  })

  it('ảnh nhỏ hơn đích vẫn được PHÓNG cho vừa, không để nguyên rồi viền', () => {
    const plan = planScreenFit(INPUTS['ảnh nhỏ hơn đích']!, SCREEN, 'fit')
    // Để nguyên 300×650 giữa khung 1179×2552 thì mockup ra một ô nhỏ giữa màn hình đen.
    expect(plan.resize.width).toBeGreaterThan(300)
    expect(plan.resize.width === SCREEN.width || plan.resize.height === SCREEN.height).toBe(
      true,
    )
  })

  it('ảnh đúng tỉ lệ thì không có dải đen', () => {
    const plan = planScreenFit({ width: 1179, height: 2552 }, SCREEN, 'fit')
    expect(plan.letterboxed).toBe(false)
    expect(plan.offset).toEqual({ left: 0, top: 0 })
  })
})

describe('stretch', () => {
  it('không cắt, không dải, nhưng báo méo với video 16:9', () => {
    const plan = planScreenFit(INPUTS['video 16:9']!, SCREEN, 'stretch')
    expect(plan.cropped).toBe(false)
    expect(plan.letterboxed).toBe(false)
    // 16:9 lên 19.5:9 méo rất nặng — UI phải cảnh báo được, nên cờ này là dữ liệu chứ
    // không phải để trang trí.
    expect(plan.distorted).toBe(true)
  })

  it('ảnh đúng tỉ lệ thì stretch KHÔNG méo', () => {
    const exact = planScreenFit(
      { width: SCREEN.width, height: SCREEN.height },
      SCREEN,
      'stretch',
    )
    expect(exact.distorted).toBe(false)
  })

  it('ba chế độ cho cùng kết quả khi ảnh vào đã đúng tỉ lệ', () => {
    const source = { width: SCREEN.width * 2, height: SCREEN.height * 2 }
    const plans = MODES.map((mode) => planScreenFit(source, SCREEN, mode))
    expect(plans).toHaveLength(3)
    for (const plan of plans) {
      expect(plan.cropped).toBe(false)
      expect(plan.letterboxed).toBe(false)
      expect(plan.distorted).toBe(false)
      expect(plan.resize).toEqual(SCREEN)
    }
  })
})

describe('đầu vào sai', () => {
  it('kích thước 0 hoặc âm thì báo lỗi, không trả kế hoạch vô nghĩa', () => {
    expect(() => planScreenFit({ width: 0, height: 100 }, SCREEN, 'fill')).toThrow(/dương/)
    expect(() => planScreenFit({ width: 100, height: -1 }, SCREEN, 'fit')).toThrow(/dương/)
    expect(() =>
      planScreenFit({ width: 100, height: 100 }, { width: 0, height: 1 }, 'fit'),
    ).toThrow(/dương/)
  })

  it('NaN cũng bị chặn — ảnh không đọc được kích thước sẽ ra NaN chứ không ra 0', () => {
    expect(() => planScreenFit({ width: Number.NaN, height: 100 }, SCREEN, 'fill')).toThrow()
  })
})
