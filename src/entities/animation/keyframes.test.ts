import { describe, expect, it } from 'vitest'

import { channelsSchema } from '@schema/scene-config'

import {
  clampFrame,
  keyedFrames,
  keyframeAt,
  loopWarnings,
  moveKeyframe,
  removeKeyframe,
  setKeyframe,
  setKeyframeInterpolation,
  type Channels,
} from './keyframes'
import { TIMELINE_LAYERS, layerOf } from './layers'

const LAST = 150

function spin(...frames: [number, number][]): Channels {
  const channels: Channels = {}
  for (const [frame, value] of frames) setKeyframe(channels, 'device.spin_z', frame, value)
  return channels
}

describe('setKeyframe', () => {
  it('tạo kênh mới khi chưa có', () => {
    const channels = spin([1, 0])
    expect(channels['device.spin_z']?.keyframes).toEqual([
      { frame: 1, value: 0, interpolation: 'BEZIER', easing: 'AUTO' },
    ])
  })

  it('giữ thứ tự tăng dần dù thêm ngược', () => {
    const channels = spin([90, 360], [1, 0], [45, 180])
    expect(channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([1, 45, 90])
  })

  it('ghi đè giá trị khi thêm lại đúng frame cũ, không tạo key trùng', () => {
    const channels = spin([1, 0], [1, 90])
    expect(channels['device.spin_z']?.keyframes).toHaveLength(1)
    expect(channels['device.spin_z']?.keyframes[0]?.value).toBe(90)
  })

  it('làm tròn frame — timeline chỉ có frame nguyên', () => {
    const channels = spin([12.4, 5])
    expect(channels['device.spin_z']?.keyframes[0]?.frame).toBe(12)
  })

  it('từ chối giá trị không hữu hạn thay vì để NaN chui vào config', () => {
    expect(() => setKeyframe({}, 'device.spin_z', 1, Number.NaN)).toThrow(/hữu hạn/)
  })
})

describe('moveKeyframe', () => {
  it('dời và sắp xếp lại', () => {
    const channels = spin([1, 0], [50, 180], [100, 360])
    moveKeyframe(channels, 'device.spin_z', 50, 120, LAST)
    expect(channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([1, 100, 120])
  })

  it('kéo đè lên keyframe khác thì cái bị đè biến mất', () => {
    const channels = spin([1, 0], [50, 180], [100, 360])
    moveKeyframe(channels, 'device.spin_z', 50, 100, LAST)
    const kfs = channels['device.spin_z']?.keyframes ?? []
    expect(kfs.map((k) => k.frame)).toEqual([1, 100])
    // Cái ĐANG KÉO thắng, không phải cái đứng yên.
    expect(kfs[1]?.value).toBe(180)
  })

  it('kẹp vào [1, lastFrame] và trả về frame thật', () => {
    const channels = spin([1, 0], [50, 180])
    expect(moveKeyframe(channels, 'device.spin_z', 50, 9999, LAST)).toBe(LAST)
    expect(moveKeyframe(channels, 'device.spin_z', LAST, -5, LAST)).toBe(1)
    // Đã có key ở frame 1 nên key vừa kéo về đè lên nó.
    expect(channels['device.spin_z']?.keyframes).toHaveLength(1)
  })

  it('bỏ qua khi frame nguồn không có keyframe', () => {
    const channels = spin([1, 0])
    expect(moveKeyframe(channels, 'device.spin_z', 42, 60, LAST)).toBe(42)
    expect(channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([1])
  })
})

describe('removeKeyframe', () => {
  it('xoá keyframe cuối cùng thì xoá luôn kênh — schema đòi tối thiểu một key', () => {
    const channels = spin([1, 0])
    removeKeyframe(channels, 'device.spin_z', 1)
    expect(channels['device.spin_z']).toBeUndefined()
    expect(Object.keys(channels)).toHaveLength(0)
  })

  it('giữ kênh khi vẫn còn key khác', () => {
    const channels = spin([1, 0], [50, 180])
    removeKeyframe(channels, 'device.spin_z', 1)
    expect(channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([50])
  })
})

describe('bất biến của schema', () => {
  it('kết quả của một chuỗi thao tác bất kỳ vẫn hợp lệ với channelsSchema', () => {
    const channels = spin([1, 0], [30, 90], [60, 180], [90, 270], [120, 360])
    moveKeyframe(channels, 'device.spin_z', 30, 61, LAST)
    moveKeyframe(channels, 'device.spin_z', 90, 60, LAST)
    removeKeyframe(channels, 'device.spin_z', 1)
    setKeyframe(channels, 'camera.azimuth', 45, 12)
    // Đây là cổng thật sự: schema chặn key trùng frame và sai thứ tự, và Blender dùng
    // đúng schema này. Nếu thao tác nào phá bất biến thì lỗi lộ ở đây, không phải lúc render.
    expect(() => channelsSchema.parse(channels)).not.toThrow()
  })
})

describe('clampFrame', () => {
  it('không bao giờ trả về frame 0 — Blender đếm từ 1', () => {
    expect(clampFrame(0, LAST)).toBe(1)
    expect(clampFrame(-99, LAST)).toBe(1)
    expect(clampFrame(Number.NaN, LAST)).toBe(1)
  })
})

describe('keyedFrames', () => {
  it('gộp frame của mọi kênh, không trùng, tăng dần', () => {
    const channels = spin([1, 0], [60, 180])
    setKeyframe(channels, 'camera.azimuth', 60, 10)
    setKeyframe(channels, 'camera.azimuth', 30, 5)
    expect(keyedFrames(channels)).toEqual([1, 30, 60])
  })

  it('lọc theo kênh khi được chỉ định', () => {
    const channels = spin([1, 0], [60, 180])
    setKeyframe(channels, 'camera.azimuth', 30, 5)
    expect(keyedFrames(channels, ['camera.azimuth'])).toEqual([30])
  })
})

describe('keyframeAt', () => {
  it('tìm đúng key để UI biết nút thêm/xoá đang ở trạng thái nào', () => {
    const channels = spin([1, 0], [60, 180])
    expect(keyframeAt(channels, 'device.spin_z', 60)?.value).toBe(180)
    expect(keyframeAt(channels, 'device.spin_z', 61)).toBeUndefined()
  })
})

describe('loopWarnings', () => {
  it('cảnh báo khi vòng 360° dùng nội suy BEZIER', () => {
    const channels = spin([1, 0], [120, 360])
    const [warning] = loopWarnings(channels)
    expect(warning?.channel).toBe('device.spin_z')
    expect(warning?.turns).toBe(1)
    expect(warning?.message).toMatch(/LINEAR/)
  })

  it('im lặng khi toàn bộ vòng đã là LINEAR', () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0, { interpolation: 'LINEAR' })
    setKeyframe(channels, 'device.spin_z', 120, 360, { interpolation: 'LINEAR' })
    expect(loopWarnings(channels)).toEqual([])
  })

  it('im lặng khi không phải vòng tròn khép kín', () => {
    expect(loopWarnings(spin([1, 0], [120, 180]))).toEqual([])
  })

  it('nhận ra nhiều vòng', () => {
    expect(loopWarnings(spin([1, 0], [120, 720]))[0]?.turns).toBe(2)
  })

  it('bỏ qua kênh không phải góc — strength 360 chỉ là một con số', () => {
    const channels: Channels = {}
    setKeyframe(channels, 'world.strength', 1, 0)
    setKeyframe(channels, 'world.strength', 120, 360)
    expect(loopWarnings(channels)).toEqual([])
  })

  it('đổi keyframe cuối sang LINEAR nhưng còn key giữa thì vẫn cảnh báo', () => {
    const channels = spin([1, 0], [60, 180], [120, 360])
    setKeyframeInterpolation(channels, 'device.spin_z', 1, 'LINEAR', 'AUTO')
    setKeyframeInterpolation(channels, 'device.spin_z', 120, 'LINEAR', 'AUTO')
    expect(loopWarnings(channels)).toHaveLength(1)
  })
})

describe('layer timeline', () => {
  it('ba layer cố định phủ HẾT các kênh, không kênh nào thuộc hai layer', () => {
    const seen = TIMELINE_LAYERS.flatMap((l) => l.channels)
    expect(new Set(seen).size).toBe(seen.length)
    // Kênh mới thêm vào CHANNELS mà quên xếp layer sẽ biến mất khỏi timeline mà không báo.
    for (const key of seen) expect(layerOf(key).channels).toContain(key)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('layerOf phủ mọi kênh trong CHANNEL_KEYS', async () => {
    const { CHANNEL_KEYS } = await import('@schema/channels')
    for (const key of CHANNEL_KEYS) expect(() => layerOf(key)).not.toThrow()
  })
})
