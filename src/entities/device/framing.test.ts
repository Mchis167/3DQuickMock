import { describe, expect, it } from 'vitest'

import { IPHONE_17_PRO_MAX, cameraUpVector, fitFrameFill, projectedHeightRatio } from './index'

const DIMS = IPHONE_17_PRO_MAX.dimsMm
const FRONT = { azimuth: 0, elevation: 0 }

describe('cameraUpVector', () => {
  it('camera ngang tầm thì trục lên là +Z', () => {
    const up = cameraUpVector(FRONT)
    expect(up[2]).toBeCloseTo(1, 6)
    expect(Math.hypot(up[0], up[1])).toBeCloseTo(0, 6)
  })

  it('camera nhìn chúc xuống thì trục lên nghiêng theo, vẫn là vector đơn vị', () => {
    const up = cameraUpVector({ azimuth: 0, elevation: 60 })
    expect(Math.hypot(up[0], up[1], up[2])).toBeCloseTo(1, 6)
    // Camera đứng ở phía +Y; nhìn chúc xuống thì "lên" trên khung hình chỉ ra XA camera,
    // tức về -Y. Đây là chỗ dễ nhầm dấu nhất trong cả file.
    expect(up[1]).toBeLessThan(0)
    expect(up[2]).toBeCloseTo(Math.cos(60 * (Math.PI / 180)), 6)
  })
})

describe('projectedHeightRatio', () => {
  it('không xoay thì bằng 1', () => {
    expect(projectedHeightRatio(DIMS, { spin_x: 0, spin_y: 0, spin_z: 0 }, FRONT)).toBeCloseTo(
      1,
      9,
    )
  })

  it('xoay quanh Z không đổi chiều cao — trục Z vẫn trùng trục lên', () => {
    // Đây là ca dễ nhầm: xoay 90° quanh Z làm máy quay ngang NHÌN TỪ TRÊN, nhưng chiều
    // cao trên khung hình không đổi vì trục dài vẫn thẳng đứng.
    expect(projectedHeightRatio(DIMS, { spin_x: 0, spin_y: 0, spin_z: 90 }, FRONT)).toBeCloseTo(
      1,
      9,
    )
  })

  it('gập 90° quanh X thì chiều cao thành chiều sâu', () => {
    const ratio = projectedHeightRatio(DIMS, { spin_x: 90, spin_y: 0, spin_z: 0 }, FRONT)
    expect(ratio).toBeCloseTo(DIMS.depth / DIMS.height, 9)
  })

  it('nghiêng 45° quanh X thì THẤP lại, không cao lên', () => {
    const ratio = projectedHeightRatio(DIMS, { spin_x: 45, spin_y: 0, spin_z: 0 }, FRONT)
    const c = Math.SQRT1_2
    expect(ratio).toBeCloseTo((DIMS.height * c + DIMS.depth * c) / DIMS.height, 9)
    // Trực giác "nghiêng thì đường chéo dài hơn nên cao lên" chỉ đúng với tiết diện gần
    // vuông. Máy dày 13.5mm trên 163mm cao nên gập quanh X luôn làm nó thấp lại.
    expect(ratio).toBeLessThan(1)
  })

  it('nghiêng quanh Y thì cao lên — chiều rộng lớn nên đường chéo thắng', () => {
    const ratio = projectedHeightRatio(DIMS, { spin_x: 0, spin_y: 20, spin_z: 0 }, FRONT)
    const r = 20 * (Math.PI / 180)
    expect(ratio).toBeCloseTo(
      (DIMS.height * Math.cos(r) + DIMS.width * Math.sin(r)) / DIMS.height,
      9,
    )
    expect(ratio).toBeGreaterThan(1)
  })

  it('nghiêng 90° quanh Y thành chiều rộng', () => {
    const ratio = projectedHeightRatio(DIMS, { spin_x: 0, spin_y: 90, spin_z: 0 }, FRONT)
    expect(ratio).toBeCloseTo(DIMS.width / DIMS.height, 9)
  })

  it('dấu của góc không đổi kết quả — hộp đối xứng', () => {
    const a = projectedHeightRatio(DIMS, { spin_x: 30, spin_y: 0, spin_z: 0 }, FRONT)
    const b = projectedHeightRatio(DIMS, { spin_x: -30, spin_y: 0, spin_z: 0 }, FRONT)
    expect(a).toBeCloseTo(b, 12)
  })

  it('camera chúc xuống làm máy thấp lại trên khung hình', () => {
    const flat = projectedHeightRatio(DIMS, { spin_x: 0, spin_y: 0, spin_z: 0 }, FRONT)
    const tilted = projectedHeightRatio(
      DIMS,
      { spin_x: 0, spin_y: 0, spin_z: 0 },
      { azimuth: 0, elevation: 70 },
    )
    expect(tilted).toBeLessThan(flat)
  })
})

describe('fitFrameFill', () => {
  it('không xoay thì trả về đúng target', () => {
    expect(fitFrameFill(DIMS, { spin_x: 0, spin_y: 0, spin_z: 0 }, FRONT, 0.9)).toBeCloseTo(
      0.9,
      9,
    )
  })

  it('nghiêng làm máy cao lên thì frame_fill giảm', () => {
    const pose = { spin_x: 0, spin_y: 20, spin_z: 0 }
    const fill = fitFrameFill(DIMS, pose, FRONT, 0.9)
    expect(fill).toBeLessThan(0.9)
    // Và bù đúng lượng: fill × ratio phải quay lại target.
    expect(fill * projectedHeightRatio(DIMS, pose, FRONT)).toBeCloseTo(0.9, 9)
  })

  it('máy thấp lại thì frame_fill tăng, cũng bù đúng lượng', () => {
    const pose = { spin_x: 30, spin_y: 0, spin_z: 0 }
    const fill = fitFrameFill(DIMS, pose, FRONT, 0.7)
    expect(fill).toBeGreaterThan(0.7)
    expect(fill * projectedHeightRatio(DIMS, pose, FRONT)).toBeCloseTo(0.7, 9)
  })

  it('kẹp ở 1.0 chứ không trả về giá trị schema từ chối', () => {
    // Gập gần phẳng thì bóng của máy chỉ còn mỏng, công thức đòi frame_fill > 1.
    const fill = fitFrameFill(DIMS, { spin_x: 90, spin_y: 0, spin_z: 0 }, FRONT, 0.9)
    expect(fill).toBe(1)
  })
})
