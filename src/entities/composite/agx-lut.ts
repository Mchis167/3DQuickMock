import lutUrl from './agx/agx-lut.bin?url'
import meta from './agx/agx-lut.json'

import type { AgxLut } from './compositor'

/**
 * LUT AgX nướng từ chính Blender — `scripts/blender/bake_agx_lut.py`.
 *
 * Đi qua Vite (`?url`) chứ không qua route của server: nó là tài sản của BUILD, gắn với đúng
 * phiên bản shader trong cùng bundle. Phục vụ qua server thì bản build cũ và LUT mới gặp nhau
 * được, và lệch màu kiểu đó không có cách nào truy ra.
 */
export const AGX_META = meta

let cached: Promise<AgxLut> | null = null

export function agxLut(): Promise<AgxLut> {
  cached ??= (async () => {
    const response = await fetch(lutUrl)
    if (!response.ok) throw new Error(`không nạp được LUT AgX: HTTP ${response.status}`)
    const data = await response.arrayBuffer()
    const expected = meta.size ** 3 * 3 * 2
    // Buffer cụt vẫn nạp lên texture "thành công"; ảnh ra chỉ sai màu ở vùng sáng.
    if (data.byteLength !== expected) {
      throw new Error(`LUT AgX ${data.byteLength} byte, cần ${expected}`)
    }
    return { size: meta.size, logMin: meta.logMin, logRange: meta.logRange, data }
  })()
  return cached
}
