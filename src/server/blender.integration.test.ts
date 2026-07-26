import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServer, type AppServer } from './app'

/**
 * Blender THẬT. Không chạy mỗi commit — mỗi lần khởi động tốn ~1.4 giây và mỗi still
 * ~0.25 giây. Bị loại khỏi `pnpm test` qua mẫu `*.integration.test.ts`.
 *
 *   pnpm test:integration
 *
 * Đây là chỗ duy nhất chứng minh được cái mà worker giả không chứng minh nổi: giao
 * thức của chúng ta khớp với worker.py thật, và ảnh ra thật.
 */

const ROOT = process.cwd()
let server: AppServer

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
  const body = JSON.parse(response.body)
  if (response.statusCode !== 200) {
    throw new Error(`${procedure} -> ${response.statusCode}: ${response.body}`)
  }
  return body.result.data
}

const WORLD = { hdri: 'assets/hdri/studio_small_03.hdr', strength: 0.6 }
const SCREEN = 'assets/raw/iphone-17-pro-max/gltf/textures/17ProMax_Screen_baseColor.jpeg'

describe('worker Blender thật', () => {
  it('trả về đường dẫn Blender và pid', async () => {
    const health = await server.fastify
      .inject({ method: 'GET', url: '/trpc/health' })
      .then((r) => JSON.parse(r.body).result.data)
    expect(existsSync(health.blender)).toBe(true)
  })

  it('render ra PNG thật, phục vụ được qua route tĩnh', async () => {
    const result = await call('preview', {
      camera: { azimuth: 20, elevation: 12, frame_fill: 0.72 },
      world: WORLD,
      screen: SCREEN,
      quality: { engine: 'eevee', res: [320, 420], samples: 8 },
    })

    const file = path.join(server.context.previewDir, path.basename(result.url))
    expect(existsSync(file)).toBe(true)
    // File PNG rỗng cũng "tồn tại" — kiểm kích thước để không tự lừa mình.
    expect(statSync(file).size).toBeGreaterThan(2000)

    const served = await server.fastify.inject({ method: 'GET', url: result.url })
    expect(served.statusCode).toBe(200)
    expect(served.rawPayload.subarray(1, 4).toString()).toBe('PNG')
  }, 120_000)

  it('sampleCurves lấy giá trị từ Blender, không phải UI tự tính', async () => {
    const result = await call('sampleCurves', {
      channels: {
        'device.spin_z': {
          keyframes: [
            { frame: 1, value: 0, interpolation: 'LINEAR' },
            { frame: 61, value: 360, interpolation: 'LINEAR' },
          ],
        },
      },
      frames: [1, 31, 61],
    })

    const values = result.values['device.spin_z'] as number[]
    // Nội suy LINEAR nên giữa quãng phải đúng một nửa. Nếu UI tự tính bezier thì con
    // số này sẽ lệch và người dùng chỉ phát hiện sau khi export xong.
    expect(values[0]).toBeCloseTo(0, 3)
    expect(values[1]).toBeCloseTo(180, 3)
    expect(values[2]).toBeCloseTo(360, 3)
  }, 120_000)

  it('kéo slider: nhiều yêu cầu liên tiếp chỉ chạy cái đầu và cái cuối', async () => {
    const results = await Promise.allSettled(
      [0, 10, 20, 30, 40, 50].map((azimuth) =>
        call('preview', {
          camera: { azimuth, elevation: 12 },
          world: WORLD,
          screen: SCREEN,
          quality: { engine: 'eevee', res: [240, 320], samples: 4 },
        }),
      ),
    )

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    // Cái đang chạy không huỷ được + cái mới nhất = đúng 2. Nếu cả 6 đều chạy thì
    // hàng đợi "mới nhất thắng" không hoạt động và kéo slider sẽ lag chồng chất.
    expect(fulfilled.length).toBe(2)
  }, 180_000)

  it('meta khớp danh sách kênh của anim.py', async () => {
    const meta = await server.fastify
      .inject({ method: 'GET', url: '/trpc/meta' })
      .then((r) => JSON.parse(r.body).result.data)
    expect(meta.channels).toContain('device.spin_z')
    expect(meta.interpolations).toHaveLength(13)
    expect(meta.easings).toHaveLength(4)
  })
})
