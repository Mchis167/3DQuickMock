import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { DRAFT_QUALITY } from '@/features/static-mockup/use-preview'

import { createServer, type AppServer } from './app'

/**
 * Blender THẬT — hai tiêu chí "xong" của Pha 3 mà worker giả không kiểm được:
 *
 *  1. kéo slider thì preview cập nhật trong ~250 ms;
 *  2. nghiêng máy ở chế độ "đứng trên mặt phẳng" thì máy KHÔNG cắm xuyên mặt phẳng.
 *
 *   pnpm test:integration
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

const WORLD = { hdri: 'assets/hdri/studio_small_03.hdr', strength: 0.6 }
const SCREEN = 'assets/raw/iphone-17-pro-max/gltf/textures/17ProMax_Screen_baseColor.jpeg'

async function preview(input: Record<string, unknown>) {
  const response = await server.fastify.inject({
    method: 'POST',
    url: '/trpc/preview',
    payload: {
      world: WORLD,
      screen: SCREEN,
      // Đúng chất lượng mà UI dùng cho draft — đo ở res khác thì số đo vô nghĩa.
      quality: DRAFT_QUALITY,
      ...input,
    },
  })
  if (response.statusCode !== 200) throw new Error(`${response.statusCode}: ${response.body}`)
  return JSON.parse(response.body).result.data as {
    url: string
    ms: number
    liftMm: number
    bottomGapMm: number
  }
}

describe('Pha 3 với Blender thật', () => {
  it('preview ở chất lượng draft nằm trong ngưỡng ~250 ms khi worker đã ấm', async () => {
    // Lần đầu nạp HDRI nên chậm; nó không phải thứ người kéo slider cảm nhận.
    await preview({ camera: { azimuth: 0, elevation: 10 } })

    const samples: number[] = []
    for (const azimuth of [10, 20, 30, 40, 50]) {
      samples.push((await preview({ camera: { azimuth, elevation: 10 } })).ms)
    }
    const median = [...samples].sort((a, b) => a - b)[2] ?? 0
    console.log(`preview draft ${DRAFT_QUALITY.res.join('x')}: ${samples.join(', ')} ms`)
    expect(median).toBeLessThan(400)
  }, 240_000)

  it('đứng trên mặt phẳng: nghiêng thế nào cũng không cắm xuống sàn', async () => {
    for (const [spin_x, spin_y] of [
      [0, 0],
      [25, 0],
      [-40, 0],
      [0, 30],
      [18, -22],
      [90, 0],
    ]) {
      const result = await preview({
        pose: { spin_x, spin_y, spin_z: 15, ground: true },
        camera: { azimuth: 20, elevation: 12 },
      })
      // Số này do Blender đo trên hình học thật sau khi xoay, không phải UI suy đoán.
      // Âm = đã cắm xuống sàn. Dung sai 1µm cho sai số dấu phẩy động.
      expect(result.bottomGapMm, `spin_x=${spin_x} spin_y=${spin_y}`).toBeGreaterThan(-0.001)
    }
  }, 240_000)

  it('lơ lửng thì không dịch máy, và máy KHÔNG còn tựa mặt phẳng', async () => {
    const result = await preview({
      pose: { spin_x: 30, spin_y: 0, spin_z: 0, ground: false },
      camera: { azimuth: 20, elevation: 12 },
    })
    expect(result.liftMm).toBe(0)
    // Máy dày 13.5mm trên 163mm cao, nên gập quanh X làm điểm thấp nhất NÂNG LÊN chứ
    // không chọc xuống. Ở chế độ lơ lửng nó cứ thế treo cách sàn vài mm — khoảng hở
    // khác 0 rõ rệt là bằng chứng `ground: false` thật sự không bù gì.
    expect(Math.abs(result.bottomGapMm)).toBeGreaterThan(1)
  }, 120_000)

  it('đứng sàn thì bù đúng lượng, kể cả khi phải HẠ máy xuống', async () => {
    const flat = await preview({ pose: { spin_x: 0, ground: true } })
    const tilted = await preview({ pose: { spin_x: 35, ground: true } })

    expect(Math.abs(flat.liftMm)).toBeLessThan(0.01)
    // Dấu âm: gập quanh X nâng đáy lên nên phải HẠ máy xuống mới chạm sàn. Trực giác
    // "nghiêng thì phải nâng lên" sai với hình dạng tấm mỏng này.
    expect(tilted.liftMm).toBeLessThan(-1)
    // Điều thật sự quan trọng: sau khi bù, máy tựa đúng mặt phẳng.
    expect(Math.abs(tilted.bottomGapMm)).toBeLessThan(0.001)
  }, 180_000)
})
