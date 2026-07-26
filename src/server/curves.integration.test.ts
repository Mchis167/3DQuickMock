import { existsSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setKeyframe, type Channels } from '@/entities/animation'
import { evaluateAt } from '@/entities/scene-config/evaluate'
import { createDocument } from '@/entities/scene-config/document'

import { createServer, type AppServer } from './app'

/**
 * Cổng quyết định của Pha 6: giá trị mà UI HIỂN THỊ tại một frame phải bằng đúng giá trị
 * Blender dùng khi render frame đó.
 *
 * Vì sao phải chạy Blender thật: 13 kiểu nội suy × 4 hướng easing, cộng tay cầm bezier tự
 * động. Tự tính lại trong TS thì đường cong trên màn hình có thể trông rất hợp lý mà vẫn
 * lệch — và người dùng chỉ phát hiện sau khi export xong. Đây là chỗ duy nhất chứng minh
 * được rằng UI không tự bịa ra đường cong.
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

async function sample(channels: Channels, frames: number[]) {
  const response = await server.fastify.inject({
    method: 'POST',
    url: '/trpc/sampleCurves',
    payload: { channels, frames },
  })
  if (response.statusCode !== 200) {
    throw new Error(`sampleCurves -> ${response.statusCode}: ${response.body}`)
  }
  return JSON.parse(response.body).result.data as {
    frames: number[]
    values: Record<string, number[]>
  }
}

describe('đường cong lấy từ Blender', () => {
  /**
   * Tự kiểm DỤNG CỤ ĐO trước khi tin số nó cho.
   *
   * Lệnh `sample` chỉ tính fcurve, không render, nên cả bộ này chạy trong ~1.5 giây —
   * nhanh đến mức dễ tưởng là nó chưa hề gọi Blender. Dự án đã ba lần đo bằng dụng cụ
   * sai và mỗi lần đều làm code đúng trông như hỏng, nên chốt lại ở đây: có Blender thật,
   * có tiến trình thật.
   */
  it('worker đang chạy Blender thật', async () => {
    // Worker khởi động LƯỜI — chỉ chạy khi có lệnh đầu tiên. Hỏi health trước khi gửi
    // lệnh nào thì `workerRunning` là false, và đó là câu trả lời đúng.
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0)
    await sample(channels, [1])

    const health = await server.fastify
      .inject({ method: 'GET', url: '/trpc/health' })
      .then((r) => JSON.parse(r.body).result.data)
    expect(health.workerRunning).toBe(true)
    expect(health.workerPid).toBeGreaterThan(0)
    expect(existsSync(health.blender)).toBe(true)
  })

  it('LINEAR đi đúng tuyến tính qua các frame mốc', async () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0, { interpolation: 'LINEAR' })
    setKeyframe(channels, 'device.spin_z', 121, 360, { interpolation: 'LINEAR' })

    const { values } = await sample(channels, [1, 31, 61, 91, 121])
    const got = values['device.spin_z']!
    // Tuyến tính từ 0 đến 360 qua 120 frame: đúng 3°/frame.
    expect(got.map((v) => Math.round(v))).toEqual([0, 90, 180, 270, 360])
  })

  it('CONSTANT giữ nguyên giá trị tới đúng keyframe sau — không nội suy', async () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0, { interpolation: 'CONSTANT' })
    setKeyframe(channels, 'device.spin_z', 61, 90, { interpolation: 'CONSTANT' })

    const { values } = await sample(channels, [1, 30, 60, 61])
    expect(values['device.spin_z']!.map((v) => Math.round(v))).toEqual([0, 0, 0, 90])
  })

  it('BEZIER khác LINEAR ở GIỮA nhưng trùng ở hai đầu — bằng chứng easing có thật', async () => {
    const linear: Channels = {}
    setKeyframe(linear, 'camera.azimuth', 1, 0, { interpolation: 'LINEAR' })
    setKeyframe(linear, 'camera.azimuth', 101, 100, { interpolation: 'LINEAR' })

    const bezier: Channels = {}
    setKeyframe(bezier, 'camera.azimuth', 1, 0, { interpolation: 'BEZIER' })
    setKeyframe(bezier, 'camera.azimuth', 101, 100, { interpolation: 'BEZIER' })

    const frames = [1, 26, 51, 76, 101]
    const a = (await sample(linear, frames)).values['camera.azimuth']!
    const b = (await sample(bezier, frames)).values['camera.azimuth']!

    expect(b[0]).toBeCloseTo(a[0]!, 3)
    expect(b[4]).toBeCloseTo(a[4]!, 3)
    // Giữa quãng, bezier chậm ở đầu nên phải THẤP hơn tuyến tính.
    expect(b[1]!).toBeLessThan(a[1]!)
    // Điểm giữa của cả hai vẫn là 50 — bezier đối xứng.
    expect(b[2]!).toBeCloseTo(50, 1)
  })

  it('EASE_IN và EASE_OUT của cùng một kiểu cho hai đường KHÁC nhau', async () => {
    const make = (easing: 'EASE_IN' | 'EASE_OUT'): Channels => {
      const channels: Channels = {}
      setKeyframe(channels, 'camera.azimuth', 1, 0, { interpolation: 'QUAD', easing })
      setKeyframe(channels, 'camera.azimuth', 101, 100, { interpolation: 'QUAD', easing })
      return channels
    }
    const mid = 51
    const inValue = (await sample(make('EASE_IN'), [mid])).values['camera.azimuth']![0]!
    const outValue = (await sample(make('EASE_OUT'), [mid])).values['camera.azimuth']![0]!

    // EASE_IN khởi động chậm nên ở giữa còn thấp; EASE_OUT vọt sớm nên đã cao.
    expect(inValue).toBeLessThan(50)
    expect(outValue).toBeGreaterThan(50)
  })

  it('mọi tổ hợp 13 nội suy × 4 easing đều lấy mẫu được và cho số hữu hạn', async () => {
    const { INTERPOLATIONS, EASINGS } = await import('@schema/channels')
    for (const interpolation of INTERPOLATIONS) {
      const channels: Channels = {}
      for (const easing of EASINGS) {
        // Dồn cả bốn hướng vào một lần gọi để không phải khởi động lại 52 lần.
        setKeyframe(channels, 'camera.azimuth', 1, 0, { interpolation, easing })
        setKeyframe(channels, 'camera.azimuth', 101, 100, { interpolation, easing })
        const { values } = await sample(channels, [1, 51, 101])
        const got = values['camera.azimuth']!
        expect(got).toHaveLength(3)
        for (const value of got) {
          // ELASTIC và BACK vượt ra ngoài [0,100] một cách hợp lệ; điều phải giữ là
          // KHÔNG có NaN — một NaN lọt vào config là Blender render ra rác im lặng.
          expect(Number.isFinite(value)).toBe(true)
        }
      }
    }
  }, 120_000)

  it('evaluateAt đổ mẫu vào đúng ô của tài liệu', async () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0, { interpolation: 'LINEAR' })
    setKeyframe(channels, 'device.spin_z', 121, 360, { interpolation: 'LINEAR' })
    setKeyframe(channels, 'camera.elevation', 1, 0, { interpolation: 'LINEAR' })
    setKeyframe(channels, 'camera.elevation', 121, 60, { interpolation: 'LINEAR' })

    const frames = Array.from({ length: 121 }, (_, i) => i + 1)
    const { values } = await sample(channels, frames)

    const document = createDocument({ channels })
    const at61 = evaluateAt(document, values, 61)

    // Đây là phép kiểm end-to-end: số của Blender, đi qua đúng đường mà preview dùng.
    expect(at61.pose.spin_z).toBeCloseTo(180, 1)
    expect(at61.camera.elevation).toBeCloseTo(30, 1)
    // Kênh không animate giữ nguyên giá trị nền.
    expect(at61.camera.focal).toBe(document.camera.focal)
  })
})
