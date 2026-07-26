import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setKeyframe, type Channels } from '@/entities/animation'

import { createServer, type AppServer } from './app'
import { sequenceArgs, SEQUENCE_PREFIX } from './screen-sequence'

/**
 * Cổng của tính năng "vừa xoay device vừa phát video trên màn hình".
 *
 * Vì sao KHÔNG dùng plate cho việc này: plate là MỘT lần render Blender mã hoá hình học và
 * ánh sáng của MỘT bộ (camera, pose) vào bốn buffer. Device xoay là UV và transmission đổi
 * hoàn toàn → plate hết hiệu lực. Làm plate mỗi frame thì phải chạy Cycles (light group là
 * tính năng Cycles) và đắt hơn render thẳng EEVEE 4.8–9.2× — tức là đắt hơn chính thứ nó
 * sinh ra để tối ưu.
 *
 * Cách dùng thay thế, đã đo: lúc device animate ta đã trả tiền một lần render mỗi frame, nên
 * đổi ảnh màn hình theo frame gần như miễn phí (97 vs 105 ms/frame). Blender làm việc đó
 * bằng `image.source = 'SEQUENCE'`.
 *
 * Phép kiểm ở đây đọc PIXEL, không đọc hash: ở samples thấp nhiễu EEVEE làm mọi frame khác
 * nhau và PNG còn có metadata — hash đã một lần cho bộ test xanh trong khi dải hoàn toàn sai
 * (xem PRD §7).
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
const CAMERA = { azimuth: 0, elevation: 12, frame_fill: 0.9, focal: 85 }
/** Bốn màu tách nhau hẳn trên từng kênh — đọc lại chỉ cần xem kênh nào trội. */
const COLOURS = [
  { tag: 'R', rgb: { r: 255, g: 0, b: 0 } },
  { tag: 'G', rgb: { r: 0, g: 255, b: 0 } },
  { tag: 'B', rgb: { r: 0, g: 0, b: 255 } },
  { tag: 'W', rgb: { r: 255, g: 255, b: 255 } },
]
const SEQ_DIR = 'cache/test-screen-seq'

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

/** Dải mốc, ghi thẳng ra đĩa theo đúng quy ước tên mà ffmpeg và Blender dùng. */
async function makeSequence() {
  const absolute = path.join(ROOT, SEQ_DIR)
  rmSync(absolute, { recursive: true, force: true })
  mkdirSync(absolute, { recursive: true })
  for (const [i, colour] of COLOURS.entries()) {
    const file = path.join(absolute, `${SEQUENCE_PREFIX}${String(i + 1).padStart(4, '0')}.png`)
    await sharp({
      create: { width: 256, height: 512, channels: 3, background: colour.rgb },
    })
      .png()
      .toFile(file)
    // Dụng cụ đo phải tự kiểm: đọc lại chính file vừa ghi.
    const data = await sharp(file).raw().toBuffer()
    if (data[0] !== colour.rgb.r || data[1] !== colour.rgb.g || data[2] !== colour.rgb.b) {
      throw new Error(`ghi sai màu mốc ở khung ${i + 1}`)
    }
  }
}

/**
 * Kênh màu trội trên vùng SÁNG của ảnh — tức là màn hình đang phát sáng, không phải thân
 * máy tối. Ngưỡng 60 loại thân máy ra để phép đo nói về màn hình.
 */
async function screenTag(file: string): Promise<string> {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 250) continue
    if ((data[i]! + data[i + 1]! + data[i + 2]!) / 3 < 60) continue
    r += data[i]!
    g += data[i + 1]!
    b += data[i + 2]!
    n++
  }
  if (n === 0) throw new Error(`${file}: không có pixel sáng nào — ảnh đen?`)
  const [mr, mg, mb] = [r / n, g / n, b / n]
  const max = Math.max(mr, mg, mb)
  const min = Math.min(mr, mg, mb)
  return max - min < max * 0.25 ? 'W' : mr === max ? 'R' : mg === max ? 'G' : 'B'
}

/** Mặt nạ alpha: device xoay thì hình bóng đổi — phép đo độc lập hoàn toàn với màu. */
async function silhouette(file: string): Promise<Uint8Array> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const mask = new Uint8Array(info.width * info.height)
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3]! > 128 ? 1 : 0
  return mask
}

function differing(a: Uint8Array, b: Uint8Array): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

function spinChannels(to: number, frames: number): Channels {
  const channels: Channels = {}
  setKeyframe(channels, 'device.spin_z', 1, 0, { interpolation: 'LINEAR' })
  setKeyframe(channels, 'device.spin_z', frames, to, { interpolation: 'LINEAR' })
  return channels
}

describe('dải ảnh màn hình + animate device', () => {
  it('màn hình đổi khung theo timeline VÀ device xoay, trong cùng một dải render', async () => {
    await makeSequence()
    const frames = 6
    const clipStart = 3
    // Chỉ 20°: xoay nhiều làm màn hình gần vuông góc với camera và biến mất khỏi khung —
    // lúc đó phép đo "kênh trội ở vùng sáng" quay ra đo phản chiếu trên thân máy.
    const channels = spinChannels(20, frames)
    const quality = { engine: 'eevee', res: [200, 260], samples: 8 }
    const common = { camera: CAMERA, world: WORLD, channels, fps: 30, frames, quality }

    // Lượt 1: TRƯỚC clip — ảnh tĩnh khung đầu. Trước `clipStart` Blender hiện màu magenta
    // "thiếu texture" nếu dùng dải, nên phần này phải là ảnh tĩnh.
    const before = await call('previewAnimation', {
      ...common,
      from: 1,
      to: clipStart - 1,
      screen: `${SEQ_DIR}/${SEQUENCE_PREFIX}0001.png`,
    })

    // Lượt 2: từ clip trở đi — dải ảnh, khung đầu rơi vào frame `clipStart`.
    const during = await call('previewAnimation', {
      ...common,
      from: clipStart,
      to: frames,
      session: before.session,
      screenSequence: { dir: SEQ_DIR, frames: COLOURS.length, start: clipStart },
    })
    expect(during.session).toBe(before.session)

    const urls = [...before.urls, ...during.urls] as string[]
    expect(urls).toHaveLength(frames)

    const tags: string[] = []
    const masks: Uint8Array[] = []
    for (const url of urls) {
      const served = await server.fastify.inject({ method: 'GET', url })
      expect(served.statusCode).toBe(200)
      const file = path.join(ROOT, url.replace(/^\//, ''))
      tags.push(await screenTag(file))
      masks.push(await silhouette(file))
    }

    // Cổng thật: frame 1,2 giữ khung đầu (R); frame 3..6 chạy dải R,G,B,W.
    expect(tags).toEqual(['R', 'R', 'R', 'G', 'B', 'W'])

    // Và device phải xoay THẬT. Không có phép kiểm này thì "màn hình đổi màu" có thể đúng
    // trong khi device đứng im — chỉ chứng minh được một nửa.
    expect(differing(masks[0]!, masks[frames - 1]!)).toBeGreaterThan(200)
  }, 180_000)

  it('từ chối gửi cả `screen` lẫn `screenSequence` — hai nguồn cho một màn hình', async () => {
    const response = await server.fastify.inject({
      method: 'POST',
      url: '/trpc/previewAnimation',
      payload: {
        camera: CAMERA,
        world: WORLD,
        channels: spinChannels(20, 4),
        fps: 30,
        frames: 4,
        screen: `${SEQ_DIR}/${SEQUENCE_PREFIX}0001.png`,
        screenSequence: { dir: SEQ_DIR, frames: 4, start: 1 },
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('dải thiếu khung cuối thì BÁO LỖI, không lặng lẽ dán màu magenta', async () => {
    await makeSequence()
    const response = await server.fastify.inject({
      method: 'POST',
      url: '/trpc/previewAnimation',
      payload: {
        camera: CAMERA,
        world: WORLD,
        channels: spinChannels(20, 4),
        fps: 30,
        frames: 4,
        // Khai 99 khung trong khi trên đĩa chỉ có 4 — rào chắn trong scene_lib phải cắn.
        screenSequence: { dir: SEQ_DIR, frames: 99, start: 1 },
        quality: { engine: 'eevee', res: [160, 200], samples: 2 },
      },
    })
    expect(response.statusCode).not.toBe(200)
    expect(response.body).toMatch(/thiếu khung cuối|magenta/)
  }, 60_000)
})

describe('sequenceArgs', () => {
  it('luôn ép fps cố định — video variable-frame-rate sẽ lệch số khung nếu không', () => {
    const args = sequenceArgs('/in.mp4', '/out', 30)
    expect(args).toContain('-vf')
    expect(args).toContain('fps=30')
    expect(args).toContain('cfr')
    // Đánh số từ 1 để khung thứ k của dải là khung thứ k của clip, không phải k-1.
    expect(args[args.indexOf('-start_number') + 1]).toBe('1')
    expect(args[args.length - 1]).toBe(`/out/${SEQUENCE_PREFIX}%04d.png`)
  })
})
