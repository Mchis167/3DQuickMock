import { statSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setKeyframe, type Channels } from '@/entities/animation'

import { createServer, type AppServer } from './app'

/**
 * Dải ảnh phát lại, render bằng Blender thật.
 *
 * Cổng ở đây so từng frame với một ảnh `still` render ở ĐÚNG pose mà đường cong cho tại
 * frame đó. Không so hash, không đếm "ảnh khác nhau".
 *
 * Vì sao: bản đầu của bộ test này đếm hash khác nhau và **xanh trong khi dải hoàn toàn
 * sai** — mọi frame đều là pose cuối. Hash vô giá trị vì hai lý do độc lập: ở samples
 * thấp nhiễu EEVEE làm mọi frame khác nhau, và PNG còn có metadata. Một dải 150 ảnh y hệt
 * nhau vẫn "phát" được, vẫn đúng fps, và hoàn toàn vô dụng.
 *
 * Lỗi bị bỏ lọt: từ Blender 4.4, action chưa gắn slot **không được đánh giá** khi render,
 * nhưng `fcurve.evaluate()` vẫn trả đúng số — nên `sample` đúng, UI đúng, chỉ có ảnh là
 * sai. Xem PRD §7 và `_assert_animation_evaluates` trong anim.py.
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

function spinChannels(from: number, to: number, frames: number): Channels {
  const channels: Channels = {}
  setKeyframe(channels, 'device.spin_z', 1, from, { interpolation: 'LINEAR' })
  setKeyframe(channels, 'device.spin_z', frames, to, { interpolation: 'LINEAR' })
  return channels
}

/** Ảnh xám thô, để so bằng pixel thay vì bằng hash. */
async function greyscale(file: string): Promise<Uint8Array> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  // Dụng cụ đo phải tự kiểm: một buffer rỗng sẽ cho lệch NaN, và NaN so sánh nào cũng
  // "không lớn hơn" — tức là phép kiểm im lặng bỏ qua. Dự án đã sập vào đúng loại này.
  if (data.length !== info.width * info.height) {
    throw new Error(`đọc ảnh xám sai: ${data.length} byte cho ${info.width}×${info.height}`)
  }
  return new Uint8Array(data)
}

/** Lệch trung bình mỗi pixel, thang 0–255. */
function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error(`kích thước khác nhau: ${a.length} vs ${b.length}`)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / a.length
}

const local = (url: string) => path.join(ROOT, url.replace(/^\//, ''))

describe('previewAnimation', () => {
  it('mỗi frame của dải khớp ĐÚNG pose mà đường cong cho tại frame đó', async () => {
    const frames = 5
    const spinEnd = 180
    // 16 spp để nhiễu không lấn số đo. Đây là phép kiểm về HÌNH HỌC, không phải về tốc độ.
    const quality = { engine: 'eevee', res: [200, 260], samples: 16 }
    const camera = { azimuth: 0, elevation: 12, frame_fill: 0.72, focal: 85 }
    const channels = spinChannels(0, spinEnd, frames)

    const strip = await call('previewAnimation', {
      camera,
      // Pose nền để ở giá trị CUỐI, đúng như auto-key để lại sau khi người dùng dựng xong.
      // Nếu animation không được đánh giá thì mọi frame sẽ ra pose này — và đó chính là
      // lỗi đã lọt qua bộ test cũ.
      pose: { spin_x: 0, spin_y: 0, spin_z: spinEnd, ground: true },
      world: WORLD,
      channels,
      fps: 30,
      frames,
      quality,
    })
    expect(strip.urls).toHaveLength(frames)

    // Giá trị đường cong tại từng frame — do Blender tính, không phải UI đoán.
    const sampled = await call('sampleCurves', {
      channels,
      frames: Array.from({ length: frames }, (_, i) => i + 1),
    })
    const spin = sampled.values['device.spin_z'] as number[]
    // float32 của Blender: so gần đúng, không so bằng.
    for (const [i, want] of [0, 45, 90, 135, 180].entries()) {
      expect(spin[i]).toBeCloseTo(want, 3)
    }

    const stripGrey = []
    for (const url of strip.urls as string[]) {
      const served = await server.fastify.inject({ method: 'GET', url })
      expect(served.statusCode).toBe(200)
      expect(statSync(local(url)).size).toBeGreaterThan(0)
      stripGrey.push(await greyscale(local(url)))
    }

    const stillGrey = []
    for (const value of spin) {
      const still = await call('preview', {
        camera,
        pose: { spin_x: 0, spin_y: 0, spin_z: value, ground: true },
        world: WORLD,
        quality,
      })
      stillGrey.push(
        await greyscale(path.join(ROOT, 'cache', still.url.replace('/preview/', 'preview/'))),
      )
    }

    for (let i = 0; i < frames; i++) {
      // Cùng scene, cùng pose, cùng samples → phải trùng khít. Ngưỡng 1.0/255 chỉ để
      // chừa cho nhiễu Monte Carlo, không phải để nới cho sai hình học.
      expect(meanAbsDiff(stripGrey[i]!, stillGrey[i]!)).toBeLessThan(1.0)
    }

    // Và dải phải THỰC SỰ chuyển động: frame cuối lệch xa frame đầu. Không có phép kiểm
    // này thì một dải toàn ảnh giống nhau vẫn qua được cổng trên nếu still cũng sai.
    expect(meanAbsDiff(stripGrey[0]!, stripGrey[frames - 1]!)).toBeGreaterThan(10)
  }, 180_000)

  it('URL suy ra từ số frame khớp ĐÚNG tên file Blender đặt', async () => {
    const result = await call('previewAnimation', {
      world: WORLD,
      channels: spinChannels(0, 30, 2),
      fps: 30,
      frames: 2,
      quality: { engine: 'eevee', res: [160, 200], samples: 2 },
    })

    // Router tự suy tên `frame_0001.png` chứ không đọc thư mục. Nếu Blender đổi quy ước
    // đánh số thì client nhận về một danh sách URL 404 mà server vẫn báo thành công.
    expect(result.urls[0]).toMatch(/\/frame_0001\.png$/)
    expect(result.urls[1]).toMatch(/\/frame_0002\.png$/)
    for (const url of result.urls as string[]) {
      const served = await server.fastify.inject({ method: 'GET', url })
      expect(served.statusCode).toBe(200)
    }
  }, 60_000)

  it('render theo LƯỢT ghi vào cùng thư mục và ghép lại thành dải liền', async () => {
    const frames = 6
    const channels = spinChannels(0, 120, frames)
    const quality = { engine: 'eevee', res: [160, 200], samples: 2 }

    const first = await call('previewAnimation', {
      world: WORLD,
      channels,
      fps: 30,
      frames,
      from: 1,
      to: 3,
      quality,
    })
    expect(first.urls).toHaveLength(3)

    const second = await call('previewAnimation', {
      world: WORLD,
      channels,
      fps: 30,
      frames,
      from: 4,
      to: 6,
      // Lượt sau phải ghi vào ĐÚNG thư mục của lượt đầu; thiếu `session` là dải bị xé
      // thành nhiều chỗ và không ghép lại được.
      session: first.session,
      quality,
    })
    expect(second.session).toBe(first.session)
    expect(second.urls).toHaveLength(3)

    const all = [...first.urls, ...second.urls] as string[]
    expect(all[0]).toMatch(/frame_0001\.png$/)
    expect(all[5]).toMatch(/frame_0006\.png$/)

    const grey = []
    for (const url of all) {
      const served = await server.fastify.inject({ method: 'GET', url })
      expect(served.statusCode).toBe(200)
      grey.push(await greyscale(local(url)))
    }

    // Chia lượt không được làm mất chuyển động ở CHỖ NỐI: frame 3 (cuối lượt đầu) và
    // frame 4 (đầu lượt sau) phải khác nhau đúng như hai frame liền kề bình thường.
    const step = meanAbsDiff(grey[0]!, grey[1]!)
    expect(step).toBeGreaterThan(1)
    expect(meanAbsDiff(grey[2]!, grey[3]!)).toBeGreaterThan(step * 0.3)
    // Và cả dải phải đơn điệu tiến: frame cuối xa frame đầu nhất.
    expect(meanAbsDiff(grey[0]!, grey[5]!)).toBeGreaterThan(meanAbsDiff(grey[0]!, grey[2]!))
  }, 60_000)

  it('từ chối khoảng frame rỗng thay vì render ra thư mục trống', async () => {
    const response = await server.fastify.inject({
      method: 'POST',
      url: '/trpc/previewAnimation',
      payload: {
        world: WORLD,
        channels: spinChannels(0, 90, 10),
        fps: 30,
        frames: 10,
        from: 8,
        to: 3,
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('từ chối `session` không phải UUID — nó ghép thẳng vào đường dẫn', async () => {
    const response = await server.fastify.inject({
      method: 'POST',
      url: '/trpc/previewAnimation',
      payload: {
        world: WORLD,
        channels: spinChannels(0, 90, 4),
        fps: 30,
        frames: 4,
        session: '../../../etc',
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('từ chối dải quá dài thay vì để người dùng chờ vài phút mới biết', async () => {
    const response = await server.fastify.inject({
      method: 'POST',
      url: '/trpc/previewAnimation',
      payload: {
        world: WORLD,
        channels: spinChannels(0, 360, 601),
        fps: 30,
        frames: 601,
      },
    })
    expect(response.statusCode).toBe(400)
  })
})
