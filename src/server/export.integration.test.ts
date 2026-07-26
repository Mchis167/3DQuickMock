import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServer, type AppServer } from './app'
import { RenderJob, type JobInfo } from './render-queue'

/**
 * Blender THẬT — ba tiêu chí "xong" của Pha 4:
 *
 *  1. ảnh export ra ĐÚNG kích thước;
 *  2. alpha đúng (nền alpha thật trong suốt; nền màu thì đặc và đúng mã);
 *  3. bấm huỷ thì tiến trình render CHẾT THẬT — kiểm bằng `ps`.
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

const BASE = {
  world: { hdri: 'assets/hdri/studio_small_03.hdr', strength: 0.6 },
  screen: 'assets/test/uv_test.png',
  camera: { azimuth: 20, elevation: 12, frame_fill: 0.72 },
  pose: { spin_y: -10, ground: true },
}

async function call(procedure: string, input: Record<string, unknown>) {
  const response = await server.fastify.inject({
    method: 'POST',
    url: `/trpc/${procedure}`,
    payload: input,
  })
  if (response.statusCode !== 200) throw new Error(`${procedure}: ${response.body}`)
  return JSON.parse(response.body).result.data
}

/** Chờ job kết thúc bằng cách hỏi trạng thái — không dựa vào WebSocket trong test. */
async function waitForJob(jobId: string, timeoutMs = 300_000): Promise<JobInfo> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const response = await server.fastify.inject({
      method: 'GET',
      url: `/trpc/renderStatus?input=${encodeURIComponent(JSON.stringify({ jobId }))}`,
    })
    const info = JSON.parse(response.body).result.data as JobInfo
    if (info.state !== 'running') return info
    if (Date.now() > deadline) throw new Error(`job ${jobId} quá lâu`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

function alive(pid: number): boolean {
  return (
    execFileSync('sh', ['-c', `ps -p ${pid} -o pid= | wc -l`], { encoding: 'utf8' }).trim() !==
    '0'
  )
}

async function corner(absolute: string) {
  const { data, info } = await sharp(absolute).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  // Góc trên-trái: chắc chắn nằm ngoài thiết bị ở mọi góc camera đang dùng.
  return {
    r: data[0] ?? 0,
    g: data[1] ?? 0,
    b: data[2] ?? 0,
    a: data[3] ?? 0,
    channels: info.channels,
  }
}

describe('export ảnh với Blender thật', () => {
  it('nền alpha: đúng kích thước 1× và góc ảnh TRONG SUỐT', async () => {
    // EEVEE + ít samples: bài test này kiểm kích thước và alpha, không kiểm chất liệu.
    const { jobId, output } = await call('exportStill', {
      ...BASE,
      engine: 'eevee',
      samples: 8,
      scale: 1,
      background: null,
      name: 'alpha-1x',
    })
    const info = await waitForJob(jobId)
    expect(info.state).toBe('done')

    const absolute = path.join(ROOT, output)
    expect(existsSync(absolute)).toBe(true)
    const meta = await sharp(absolute).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 1080, height: 1440 })

    const px = await corner(absolute)
    // Alpha thật, không phải "trông như trong suốt" vì nền tối.
    expect(px.a).toBe(0)
    rmSync(path.dirname(absolute), { recursive: true, force: true })
  }, 300_000)

  it('2× render ở độ phân giải gấp đôi, không phóng ảnh lên', async () => {
    const { jobId, output } = await call('exportStill', {
      ...BASE,
      engine: 'eevee',
      samples: 4,
      scale: 2,
      background: null,
      name: 'alpha-2x',
    })
    expect((await waitForJob(jobId)).state).toBe('done')
    const meta = await sharp(path.join(ROOT, output)).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 2160, height: 2880 })
    rmSync(path.dirname(path.join(ROOT, output)), { recursive: true, force: true })
  }, 300_000)

  it('nền màu đặc: hết alpha và màu đúng mã đã chọn', async () => {
    const { jobId, output } = await call('exportStill', {
      ...BASE,
      engine: 'eevee',
      samples: 4,
      scale: 1,
      background: '#204080',
      name: 'solid',
    })
    expect((await waitForJob(jobId)).state).toBe('done')

    const absolute = path.join(ROOT, output)
    const px = await corner(absolute)
    expect(px.a).toBe(255)
    // Ghép sau khi render nên màu phải đúng từng byte, không bị tone map bóp.
    expect([px.r, px.g, px.b]).toEqual([0x20, 0x40, 0x80])
    rmSync(path.dirname(absolute), { recursive: true, force: true })
  }, 300_000)

  it('huỷ: tiến trình Blender chết thật, kiểm bằng ps', async () => {
    // Cycles 512 samples ở 2× để chắc chắn nó còn đang chạy lúc mình bấm huỷ.
    const { jobId, blender } = await call('exportStill', {
      ...BASE,
      engine: 'cycles',
      samples: 512,
      scale: 2,
      background: null,
      name: 'to-cancel',
    })
    expect(typeof blender).toBe('number')
    expect(alive(blender as number)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 3000))
    const cancelled = await call('cancelRender', { jobId })
    expect(cancelled.state).toBe('cancelled')

    await new Promise((resolve) => setTimeout(resolve, 500))
    // Đây là tiêu chí "xong" của pha: huỷ trên UI mà Blender còn render thì người dùng
    // vẫn mất máy, và mỗi lần bấm huỷ lại rò thêm một tiến trình.
    expect(alive(blender as number)).toBe(false)
    expect((await waitForJob(jobId)).state).toBe('cancelled')
  }, 300_000)

  it('thiếu file ảnh thì bị chặn NGAY, không tốn một giây render nào', async () => {
    const response = await server.fastify.inject({
      method: 'POST',
      url: '/trpc/exportStill',
      payload: {
        ...BASE,
        screen: 'assets/test/khong-ton-tai.png',
        engine: 'eevee',
        samples: 4,
      },
    })
    // Chặn ở biên: một bản Cycles chạy 28 phút rồi mới lộ ra thiếu ảnh là mất cả buổi.
    expect(response.statusCode).toBe(400)
    expect(response.body).toMatch(/screen không tồn tại/)
  })

  it('script Blender crash thì job báo FAILED, dù Blender thoát mã 0', async () => {
    // Blender thoát 0 kể cả khi script `-P` raise (kiểm chứng 2026-07-25, Blender 4.5.1).
    // Ở đây đi thẳng qua RenderJob với một config mà validate_config từ chối, để kiểm cả
    // hai lớp chắn: render_config.py tự đặt mã thoát, và job đòi phải có file ảnh thật.
    const job = new RenderJob({
      id: `crash-${Date.now()}`,
      root: ROOT,
      config: { schemaVersion: 1, screen: 'assets/test/uv_test.png', world: {}, output: {} },
      outputDir: 'cache/exports/crash-test',
      outputName: 'crash',
    })
    const ended = new Promise<JobInfo>((resolve) => job.once('end', resolve))
    job.start()
    const info = await ended
    expect(info.state).toBe('failed')
    expect(info.error).toBeTruthy()
    rmSync(path.join(ROOT, 'cache/exports/crash-test'), { recursive: true, force: true })
  }, 120_000)
})

describe('import ảnh với server thật', () => {
  it('upload rồi khớp tỉ lệ ra ảnh đúng tỉ lệ màn hình', async () => {
    const png = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer()

    const uploaded = await server.fastify.inject({
      method: 'POST',
      url: '/upload?ext=png',
      headers: { 'content-type': 'application/octet-stream' },
      payload: png,
    })
    expect(uploaded.statusCode).toBe(200)
    const { asset } = JSON.parse(uploaded.body) as { asset: string }

    const prepared = await call('prepareScreen', { asset, mode: 'fit' })
    const meta = await sharp(path.join(ROOT, prepared.screen)).metadata()
    expect(meta.width).toBe(1179)
    // 73:158 -> 1179 × 2552. Sai tỉ lệ ở đây là ảnh méo trên màn hình mà không ai báo.
    expect(meta.height).toBe(Math.round((1179 * 158) / 73))
    expect(prepared.letterboxed).toBe(true)

    // Và ảnh đó render được thật.
    const { jobId, output } = await call('exportStill', {
      ...BASE,
      screen: prepared.screen,
      engine: 'eevee',
      samples: 4,
      name: 'imported',
    })
    expect((await waitForJob(jobId)).state).toBe('done')
    expect(existsSync(path.join(ROOT, output))).toBe(true)
    rmSync(path.dirname(path.join(ROOT, output)), { recursive: true, force: true })
  }, 300_000)
})
