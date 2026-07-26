import { describe, expect, it } from 'vitest'

import {
  ASPECT_IDS,
  PLAYBACK_LONG_EDGE,
  playbackResolution,
  frameToSeconds,
  lastFrame,
  resolutionOf,
  timelineFrames,
  timelineSchema,
} from './timeline'

describe('timelineSchema', () => {
  it('mặc định là 5 giây 30fps tỉ lệ 3:4', () => {
    expect(timelineSchema.parse({})).toEqual({ fps: 30, duration: 5, aspect: '3:4' })
  })

  it('từ chối field lạ — gõ sai tên phải báo lỗi, không im lặng dùng mặc định', () => {
    expect(() => timelineSchema.parse({ fps: 30, framerate: 60 })).toThrow()
  })
})

describe('timelineFrames', () => {
  it('5 giây 30fps là 150 frame', () => {
    expect(timelineFrames({ fps: 30, duration: 5 })).toBe(150)
  })

  it('làm tròn ngân hàng như Python, không như Math.round', () => {
    // 5 × 0.5 = 2.5 → Python cho 2 (về số chẵn), Math.round cho 3.
    expect(timelineFrames({ fps: 5, duration: 0.5 })).toBe(2)
    expect(Math.round(5 * 0.5)).toBe(3)
  })

  it('lastFrame không bao giờ nhỏ hơn 1', () => {
    expect(lastFrame({ fps: 1, duration: 0.01 })).toBe(1)
  })
})

describe('resolutionOf', () => {
  it('nhân đúng hệ số phóng', () => {
    expect(resolutionOf({ aspect: '3:4' })).toEqual([1080, 1440])
    expect(resolutionOf({ aspect: '3:4' }, 2)).toEqual([2160, 2880])
    expect(resolutionOf({ aspect: '9:16' }, 4)).toEqual([4320, 7680])
  })

  it('mọi tỉ lệ ở mọi hệ số đều cho hai chiều CHẴN — chroma 4:2:0 đòi vậy', () => {
    for (const aspect of ASPECT_IDS) {
      for (const scale of [1, 2, 4]) {
        const [w, h] = resolutionOf({ aspect }, scale)
        expect(w % 2).toBe(0)
        expect(h % 2).toBe(0)
      }
    }
  })
})

describe('playbackResolution', () => {
  it('giữ đúng tỉ lệ, cạnh dài bằng ngưỡng đã chọn', () => {
    expect(playbackResolution({ aspect: '3:4' })).toEqual([360, 480])
    expect(playbackResolution({ aspect: '9:16' })).toEqual([270, 480])
    expect(playbackResolution({ aspect: '16:9' })).toEqual([480, 270])
    expect(playbackResolution({ aspect: '1:1' })).toEqual([480, 480])
  })

  it('cạnh dài không bao giờ vượt ngưỡng, và hai chiều đều chẵn', () => {
    for (const aspect of ASPECT_IDS) {
      const [w, h] = playbackResolution({ aspect })
      expect(Math.max(w, h)).toBeLessThanOrEqual(PLAYBACK_LONG_EDGE)
      expect(w % 2).toBe(0)
      expect(h % 2).toBe(0)
    }
  })

  it('nhỏ hơn hẳn độ phân giải export — nó là dải để xem NHỊP, không phải bản cuối', () => {
    for (const aspect of ASPECT_IDS) {
      const [pw] = playbackResolution({ aspect })
      const [ew] = resolutionOf({ aspect })
      expect(pw).toBeLessThan(ew)
    }
  })
})

describe('frameToSeconds', () => {
  it('frame 1 là mốc 0 giây', () => {
    expect(frameToSeconds(1, 30)).toBe(0)
    expect(frameToSeconds(31, 30)).toBe(1)
  })
})
