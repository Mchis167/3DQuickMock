import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServer, type AppServer } from './app'

/**
 * Endpoint `plate` — Blender THẬT, đi qua đúng đường mà client sẽ đi.
 *
 * Bộ `plate.integration.test.ts` kiểm bản thân plate; bộ này kiểm phần NỐI: manifest có trỏ
 * đúng file không, file có phục vụ được qua HTTP không, và số byte tải về có đúng bằng số
 * byte mà client sẽ dựng texture không. Một buffer cụt vẫn nạp lên GPU "thành công" và chỉ
 * lộ ra thành một mảng ảnh sai lệch.
 */

const ROOT = process.cwd()
let server: AppServer

const REQUEST = {
  screen: 'assets/test/stimulus.png',
  world: { hdri: 'assets/hdri/studio_small_03.hdr', strength: 1 },
  camera: { azimuth: 20, elevation: 12, frame_fill: 0.72 },
  quality: { engine: 'eevee' as const, res: [180, 240] as [number, number], samples: 16 },
}

beforeAll(async () => {
  server = createServer({ root: ROOT })
  await server.fastify.ready()
}, 30_000)

afterAll(async () => {
  await server.close()
})

async function call(procedure: string, input: Record<string, unknown>) {
  const response = await server.fastify.inject({
    method: 'POST',
    url: `/trpc/${procedure}`,
    payload: input,
  })
  if (response.statusCode !== 200) {
    throw new Error(`${procedure} -> ${response.statusCode}: ${response.body}`)
  }
  return JSON.parse(response.body).result.data
}

describe('endpoint plate', () => {
  it('trả manifest trỏ đúng bốn buffer, và phục vụ chúng đủ byte', async () => {
    const plate = await call('plate', REQUEST)
    const [width, height] = plate.res
    expect([width, height]).toEqual([180, 240])
    expect(plate.screenPx).toBeGreaterThan(width * height * 0.05)

    const expected = {
      base: { channels: 3, dtype: 'half', bytes: 2 },
      t: { channels: 3, dtype: 'half', bytes: 2 },
      alpha: { channels: 1, dtype: 'half', bytes: 2 },
      uv: { channels: 3, dtype: 'float32', bytes: 4 },
    } as const

    for (const [name, want] of Object.entries(expected)) {
      const info = plate.files[name]
      expect(info.channels, name).toBe(want.channels)
      expect(info.dtype, name).toBe(want.dtype)
      // URL phải là đường tương đối dưới /cache/ — client ghép với API_BASE.
      expect(info.url, name).toMatch(/^\/cache\/plate\/[0-9a-f-]+\/\w+\.bin$/)

      const file = await server.fastify.inject({ method: 'GET', url: info.url })
      expect(file.statusCode, name).toBe(200)
      expect(file.rawPayload.byteLength, name).toBe(width * height * want.channels * want.bytes)
    }
  }, 180_000)

  it('ép Cycles bất kể client gửi engine gì', async () => {
    // Client trên gửi `engine: 'eevee'`. Light group là tính năng của Cycles: chạy EEVEE thì
    // AOV vẫn xuất hiện nhưng TOÀN SỐ 0, plate ra đủ file và màn hình đứng yên khi phát video.
    // Nếu ép Cycles không hiệu lực thì rào chắn trong plate.py đã ném lỗi và call ở trên fail.
    const plate = await call('plate', REQUEST)
    const t = await server.fastify.inject({ method: 'GET', url: plate.files.t.url })
    const view = new Uint16Array(
      t.rawPayload.buffer,
      t.rawPayload.byteOffset,
      t.rawPayload.byteLength / 2,
    )
    // Half khác 0 ở một phần đáng kể của khung: T là đóng góp của màn hình trắng.
    const nonZero = view.reduce((count, bits) => count + ((bits & 0x7fff) !== 0 ? 1 : 0), 0)
    expect(nonZero).toBeGreaterThan(view.length * 0.05)
  }, 180_000)
})
