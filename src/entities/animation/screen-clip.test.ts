import { describe, expect, it } from 'vitest'

import { clipEnd, renderChunks, screenClipSchema, videoFrameAt } from './screen-clip'

const clip = (start: number) => screenClipSchema.parse({ start })

describe('videoFrameAt', () => {
  it('khung đầu rơi đúng vào frame `start`', () => {
    expect(videoFrameAt(clip(40), 90, 40)).toBe(1)
    expect(videoFrameAt(clip(40), 90, 41)).toBe(2)
  })

  it('TRƯỚC clip thì giữ khung đầu — không hiện đen, không hiện khung cuối', () => {
    for (const frame of [1, 10, 39]) {
      expect(videoFrameAt(clip(40), 90, frame)).toBe(1)
    }
  })

  it('SAU khi hết video thì giữ khung cuối', () => {
    // clip 40..129 với 90 khung.
    expect(videoFrameAt(clip(40), 90, 129)).toBe(90)
    for (const frame of [130, 150, 999]) {
      expect(videoFrameAt(clip(40), 90, frame)).toBe(90)
    }
  })

  it('clip bắt đầu TRƯỚC frame 1 là hợp lệ — bỏ mấy giây đầu của video', () => {
    // start = -9 nghĩa là frame timeline 1 đã ứng với khung video thứ 11.
    expect(videoFrameAt(clip(-9), 90, 1)).toBe(11)
  })

  it('video chỉ có một khung thì mọi frame đều là khung đó', () => {
    expect(videoFrameAt(clip(5), 1, 1)).toBe(1)
    expect(videoFrameAt(clip(5), 1, 100)).toBe(1)
  })

  it('không bao giờ trả về chỉ số ngoài [1, videoFrames]', () => {
    for (const start of [-50, 1, 40, 500]) {
      for (const frame of [1, 25, 150]) {
        const index = videoFrameAt(clip(start), 90, frame)
        expect(index).toBeGreaterThanOrEqual(1)
        expect(index).toBeLessThanOrEqual(90)
      }
    }
  })
})

describe('clipEnd', () => {
  it('clip 90 khung bắt đầu ở frame 40 thì kết ở 129', () => {
    expect(clipEnd(clip(40), 90)).toBe(129)
  })
})

describe('renderChunks', () => {
  /** Bất biến chung: các lượt phải liên tiếp và phủ KÍN [1, frames]. */
  function expectCovers(chunks: ReturnType<typeof renderChunks>, frames: number) {
    expect(chunks[0]?.from).toBe(1)
    expect(chunks[chunks.length - 1]?.to).toBe(frames)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.from).toBe(chunks[i - 1]!.to + 1)
    }
    for (const chunk of chunks) expect(chunk.to).toBeGreaterThanOrEqual(chunk.from)
  }

  it('không có clip thì chia đều như cũ, mọi lượt dùng ảnh tĩnh', () => {
    const chunks = renderChunks(60, 24, null)
    expect(chunks).toEqual([
      { from: 1, to: 24, sequence: false },
      { from: 25, to: 48, sequence: false },
      { from: 49, to: 60, sequence: false },
    ])
    expectCovers(chunks, 60)
  })

  it('KHÔNG có lượt nào bắc qua mốc `start`', () => {
    const chunks = renderChunks(60, 24, clip(40))
    expectCovers(chunks, 60)
    // Mốc 40: mọi lượt phải nằm hẳn một bên.
    for (const chunk of chunks) {
      if (chunk.sequence) expect(chunk.from).toBeGreaterThanOrEqual(40)
      else expect(chunk.to).toBeLessThan(40)
    }
  })

  it('lượt trước mốc dùng ảnh tĩnh, lượt từ mốc trở đi dùng dải', () => {
    const chunks = renderChunks(60, 24, clip(40))
    expect(chunks).toEqual([
      { from: 1, to: 24, sequence: false },
      { from: 25, to: 39, sequence: false },
      { from: 40, to: 60, sequence: true },
    ])
  })

  it('clip bắt đầu ở frame 1 thì KHÔNG có lượt ảnh tĩnh nào', () => {
    const chunks = renderChunks(60, 24, clip(1))
    expectCovers(chunks, 60)
    expect(chunks.every((chunk) => chunk.sequence)).toBe(true)
  })

  it('clip bắt đầu trước frame 1 cũng vậy — mốc bị kẹp về 1', () => {
    const chunks = renderChunks(30, 24, clip(-5))
    expectCovers(chunks, 30)
    expect(chunks.every((chunk) => chunk.sequence)).toBe(true)
  })

  it('clip bắt đầu SAU frame cuối thì mọi lượt là ảnh tĩnh', () => {
    const chunks = renderChunks(30, 24, clip(999))
    expectCovers(chunks, 30)
    expect(chunks.every((chunk) => !chunk.sequence)).toBe(true)
  })

  it('phủ kín và không bắc qua mốc với MỌI tổ hợp — bất biến, không phải ví dụ', () => {
    for (const frames of [1, 2, 23, 24, 25, 60, 150]) {
      for (const start of [1, 2, 24, 25, 40, 149, 150, 151]) {
        const chunks = renderChunks(frames, 24, clip(start))
        expectCovers(chunks, frames)
        const boundary = Math.min(Math.max(start, 1), frames + 1)
        for (const chunk of chunks) {
          if (chunk.sequence) expect(chunk.from).toBeGreaterThanOrEqual(boundary)
          else expect(chunk.to).toBeLessThan(boundary)
        }
      }
    }
  })
})
