import { describe, expect, it, vi } from 'vitest'

import { loadPlate, meanLinearColour, srgbToLinear } from './load'

describe('màu trung bình tuyến tính', () => {
  it('sRGB byte đổi sang tuyến tính đúng ở các mốc đã biết', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(255)).toBeCloseTo(1, 6)
    // 128/255 là xám giữa của màn hình, không phải xám giữa của ánh sáng.
    expect(srgbToLinear(128)).toBeCloseTo(0.21586, 5)
  })

  it('lấy trung bình TRONG không gian tuyến tính, không trên byte', () => {
    // Nửa đen nửa trắng. Trung bình byte là 127.5 -> tuyến tính 0.2140.
    // Trung bình tuyến tính đúng là (0 + 1)/2 = 0.5. Chênh hơn gấp đôi.
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    const [r, g, b] = meanLinearColour(pixels)
    expect(r).toBeCloseTo(0.5, 6)
    expect(g).toBeCloseTo(0.5, 6)
    expect(b).toBeCloseTo(0.5, 6)
    expect(r).not.toBeCloseTo(srgbToLinear(127.5), 2)
  })

  it('ảnh một màu thì trả về đúng màu đó', () => {
    const pixels = new Uint8ClampedArray(4 * 16)
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200
      pixels[i + 1] = 100
      pixels[i + 2] = 50
      pixels[i + 3] = 255
    }
    const mean = meanLinearColour(pixels)
    expect(mean[0]).toBeCloseTo(srgbToLinear(200), 9)
    expect(mean[1]).toBeCloseTo(srgbToLinear(100), 9)
    expect(mean[2]).toBeCloseTo(srgbToLinear(50), 9)
  })
})

describe('nạp buffer từ server', () => {
  const manifest = {
    res: [4, 2] as [number, number],
    files: {
      base: { url: '/base.bin', channels: 3, dtype: 'half' as const },
      t: { url: '/t.bin', channels: 3, dtype: 'half' as const },
      alpha: { url: '/alpha.bin', channels: 1, dtype: 'half' as const },
      uv: { url: '/uv.bin', channels: 3, dtype: 'float32' as const },
    },
  }
  const sizes: Record<string, number> = {
    '/base.bin': 4 * 2 * 3 * 2,
    '/t.bin': 4 * 2 * 3 * 2,
    '/alpha.bin': 4 * 2 * 1 * 2,
    '/uv.bin': 4 * 2 * 3 * 4,
  }

  it('nạp đủ bốn buffer với đúng mô tả', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(sizes[url] ?? 0),
      })),
    )
    const plate = await loadPlate(manifest)
    expect(Object.keys(plate).sort()).toEqual(['alpha', 'base', 't', 'uv'])
    expect(plate.uv.dtype).toBe('float32')
    expect(plate.base.width).toBe(4)
    vi.unstubAllGlobals()
  })

  it('buffer THIẾU BYTE phải báo lỗi ngay, không để lọt xuống GPU', async () => {
    // Buffer cụt vẫn nạp lên texture "thành công" và chỉ lộ ra thành một mảng ảnh sai lệch —
    // truy ngược từ ảnh về nguyên nhân rất tốn, nên chặn ngay ở cửa.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(url === '/uv.bin' ? 4 : (sizes[url] ?? 0)),
      })),
    )
    await expect(loadPlate(manifest)).rejects.toThrow(/uv\.bin: 4 byte, cần 96/)
    vi.unstubAllGlobals()
  })
})
