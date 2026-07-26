import type { PlateBuffers } from './compositor'

/**
 * Nạp plate và LUT từ server. Buffer đi qua HTTP dưới dạng `.bin` THÔ, không phải ảnh.
 *
 * Vì sao không dùng PNG: 8-bit thì mất dải động của dữ liệu scene-linear, còn PNG 16-bit qua
 * `<img>` thì trình duyệt **âm thầm hạ xuống 8 bit** (spike Pha 2.5 đo lệch 5.01 px). Buffer
 * thô đi thẳng vào `texImage2D` đúng kiểu dữ liệu đã ghi nên không có chỗ nào để mất bit.
 * Đây là localhost: ~19 MB ở 1080×1440 là chuyện nhỏ.
 */

export interface PlateManifest {
  res: [number, number]
  files: Record<
    keyof PlateBuffers,
    { url: string; channels: number; dtype: 'half' | 'float32' }
  >
}

async function fetchBuffer(url: string, expected: number): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  const data = await response.arrayBuffer()
  // Kiểm kích thước ngay tại đây: một buffer thiếu byte vẫn nạp lên texture "thành công" và
  // chỉ lộ ra thành một mảng ảnh sai lệch, rất khó truy ngược.
  if (data.byteLength !== expected) {
    throw new Error(`${url}: ${data.byteLength} byte, cần ${expected}`)
  }
  return data
}

export async function loadPlate(manifest: PlateManifest): Promise<PlateBuffers> {
  const [width, height] = manifest.res
  const entries = await Promise.all(
    (Object.keys(manifest.files) as (keyof PlateBuffers)[]).map(async (name) => {
      const spec = manifest.files[name]
      const bytesPerSample = spec.dtype === 'float32' ? 4 : 2
      const data = await fetchBuffer(spec.url, width * height * spec.channels * bytesPerSample)
      return [
        name,
        { width, height, channels: spec.channels, dtype: spec.dtype, data },
      ] as const
    }),
  )
  return Object.fromEntries(entries) as unknown as PlateBuffers
}

/** Chuyển sRGB byte sang tuyến tính — dùng cho màu trung bình của frame. */
export function srgbToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * Màu trung bình TUYẾN TÍNH của một frame — số hạng hắt sáng hạng 1 của shader.
 *
 * Phải lấy trung bình trong không gian tuyến tính, không phải trên byte sRGB: trung bình của
 * byte rồi mới chuyển sang tuyến tính cho kết quả tối hơn hẳn với ảnh tương phản cao.
 */
export function meanLinearColour(pixels: Uint8ClampedArray): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  const count = pixels.length / 4
  for (let i = 0; i < pixels.length; i += 4) {
    r += srgbToLinear(pixels[i] ?? 0)
    g += srgbToLinear(pixels[i + 1] ?? 0)
    b += srgbToLinear(pixels[i + 2] ?? 0)
  }
  return [r / count, g / count, b / count]
}
