import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cached } from '../../tests/fixtures/blender-cache'
import { createServer, type AppServer } from './app'

/**
 * Export video đầu-cuối: Blender THẬT, Chrome THẬT, ffmpeg THẬT.
 *
 * Ba lời hứa của Pha 5 được kiểm bằng vật chứng chứ không bằng lập luận:
 *
 *  1. **Shader cài đúng mô hình.** `plate.integration.test.ts` mới chỉ chứng minh phép toán
 *     đúng khi tính bằng numpy. Bộ này ghép bằng chính GPU, qua chính file shader mà preview
 *     dùng, rồi so với một render Blender đầy đủ. Hai chuyện khác nhau.
 *  2. **Video thật sự chạy.** Bẫy ở PRD §7: server không hỗ trợ HTTP Range thì
 *     `video.currentTime` bị bỏ qua ÂM THẦM — export ra đủ khung, `ffprobe` đếm đúng, mỗi
 *     khung trông bình thường, màn hình đứng yên.
 *  3. **ffmpeg chỉ mã hoá.**
 *
 * Plate và ảnh tham chiếu đi qua `tests/fixtures/blender-cache`: lần đầu tốn một render Cycles,
 * những lần sau lấy từ đệm. Không có nó thì mỗi lần chạy mất hàng phút, và một phép kiểm không
 * ai chịu chạy thì không bảo vệ được gì. Đệm khoá theo NỘI DUNG yêu cầu nên đổi tham số là tự
 * render lại — không có đường nào để nó trả về kết quả cũ cho một cấu hình mới.
 *
 * Yêu cầu: đã chạy `pnpm build` (trang export nằm trong `dist/`).
 */

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'cache', 'test-export')
const [WIDTH, HEIGHT] = [180, 240]
/** Mức xám của từng khung video mốc. Cách nhau đủ xa để nhiễu mã hoá không lẫn vào. */
const LEVELS = [40, 80, 120, 160, 200]
const FRAMES = LEVELS.length
/** Khung dùng cho phép so với render Blender. */
const PROBE = 2

let server: AppServer
let baseUrl: string
let videoAsset: string

const SCENE = {
  world: { hdri: 'assets/hdri/studio_small_03.hdr', strength: 1 },
  camera: { azimuth: 20, elevation: 12, frame_fill: 0.72 },
  quality: { res: [WIDTH, HEIGHT] as [number, number], samples: 32 },
}

async function call(procedure: string, input: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${procedure}: ${JSON.stringify(body)}`)
  return body.result.data
}

async function upload(file: string, ext: string): Promise<string> {
  const response = await fetch(`${baseUrl}/upload?ext=${ext}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(readFileSync(file)),
  })
  return `/${((await response.json()) as { asset: string }).asset}`
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: ROOT })
}

/**
 * Video mốc: khung `k` là một màu xám đặc đã biết trước, mỗi mức ĐÚNG MỘT khung.
 *
 * Không dùng nội dung ngẫu nhiên — cần biết CHÍNH XÁC khung nào đang hiện để bắt được ca "tua
 * không có tác dụng". VP9 4:4:4 lossless: mã hoá 4:2:0 lấy mẫu chroma thưa và tự nó làm sai
 * màu màn hình, lẫn vào đúng cái sai số đang đo.
 *
 * Sinh từ ẢNH chứ không từ nguồn `color` của ffmpeg: `color=...:d=0.034` ở 30fps làm tròn lên
 * thành HAI khung mỗi màu, và video ra có 10 khung thay vì 5. Lúc đó phép đo báo "ba khung đầu
 * trùng nhau" và trông y như lỗi tua — trong khi lỗi nằm ở chính dụng cụ đo.
 */
async function makeVideo(file: string): Promise<void> {
  const frames = path.join(OUT, 'src')
  mkdirSync(frames, { recursive: true })
  await Promise.all(
    LEVELS.map((level, index) =>
      sharp({
        create: {
          width: 128,
          height: 256,
          channels: 3,
          background: { r: level, g: level, b: level },
        },
      })
        .png()
        .toFile(path.join(frames, `f_${String(index).padStart(2, '0')}.png`)),
    ),
  )
  ffmpeg([
    '-framerate',
    '30',
    '-i',
    path.join(frames, 'f_%02d.png'),
    '-c:v',
    'libvpx-vp9',
    '-lossless',
    '1',
    '-pix_fmt',
    'yuv444p',
    '-r',
    '30',
    file,
  ])

  // Rào chắn đặt lên chính DỤNG CỤ ĐO: một video sai số khung sẽ làm mọi phép đo phía sau vô
  // nghĩa mà vẫn trông như lỗi của code.
  const counted = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-count_frames',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_read_frames',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  ).trim()
  if (Number(counted) !== LEVELS.length) {
    throw new Error(`video mốc có ${counted} khung, cần đúng ${LEVELS.length}`)
  }
}

async function raw(file: string) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

/** Độ sáng trung bình trong lòng mockup — chỉ pixel alpha đặc. */
function meanSolid(data: Buffer): number {
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 250) continue
    sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3
    count++
  }
  return sum / Math.max(count, 1)
}

beforeAll(async () => {
  if (!existsSync(path.join(ROOT, 'dist', 'export.html'))) {
    throw new Error('chưa có dist/export.html — chạy `pnpm build` trước')
  }
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  server = createServer({ root: ROOT })
  await server.fastify.ready()
  baseUrl = await server.listen(0)

  const video = path.join(OUT, 'clip.webm')
  await makeVideo(video)
  videoAsset = await upload(video, 'webm')
}, 300_000)

afterAll(async () => {
  await server?.close()
})

describe('export video đầu-cuối', () => {
  it('phục vụ video có HTTP Range — nếu không thì tua bị bỏ qua ÂM THẦM', async () => {
    const response = await fetch(`${baseUrl}${videoAsset}`, {
      headers: { range: 'bytes=0-99' },
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toMatch(/^bytes 0-99\//)
  })

  it('xuất video thật, mỗi khung khác nhau và ĐÚNG THỨ TỰ', async () => {
    const result = await call('exportVideo', {
      ...SCENE,
      screen: 'assets/test/stimulus.png',
      video: videoAsset,
      source: { width: 128, height: 256 },
      fitMode: 'stretch',
      scale: 1,
      fps: 30,
      frames: FRAMES,
      name: 'e2e',
      container: 'mov',
    })
    expect(result.frames).toBe(FRAMES)
    expect(result.bytes).toBeGreaterThan(1000)

    ffmpeg(['-i', path.join(ROOT, result.output), path.join(OUT, 'frame_%03d.png')])

    // Độ sáng trong lòng mockup phải TĂNG theo khung, đúng như video nguồn. Chỉ kiểm "các
    // khung khác nhau" là không đủ: nhiễu mã hoá cũng làm chúng khác nhau.
    const means: number[] = []
    for (let k = 1; k <= FRAMES; k++) {
      const { data } = await raw(path.join(OUT, `frame_${String(k).padStart(3, '0')}.png`))
      means.push(meanSolid(data))
    }
    for (let k = 1; k < means.length; k++) {
      expect(
        means[k],
        `khung ${k} phải sáng hơn khung ${k - 1}: ${means.map((m) => m.toFixed(1)).join(', ')}`,
      ).toBeGreaterThan((means[k - 1] ?? 0) + 0.5)
    }
  }, 300_000)

  it('ghép bằng SHADER THẬT khớp render Blender đầy đủ', async () => {
    // Khung PROBE của video là một màu xám đặc đã biết. Blender render với đúng màu đó trên
    // màn hình phải cho ra cùng một ảnh. Đây là phép kiểm chứng minh SHADER cài đúng mô hình,
    // khác với `plate.integration.test.ts` vốn chỉ chứng minh phép toán bằng numpy.
    const level = LEVELS[PROBE]!
    const solid = path.join(OUT, `solid_${level}.png`)
    await sharp({
      create: {
        width: 128,
        height: 256,
        channels: 3,
        background: { r: level, g: level, b: level },
      },
    })
      .png()
      .toFile(solid)

    const reference = await cached(ROOT, 'reference', { ...SCENE, level }, async () => {
      const value = await call('preview', {
        ...SCENE,
        screen: path.relative(ROOT, solid),
        quality: { ...SCENE.quality, engine: 'cycles' },
      })
      return {
        value,
        files: [path.join(server.context.previewDir, path.basename(value.url as string))],
      }
    })

    const probe = path.join(OUT, `frame_${String(PROBE + 1).padStart(3, '0')}.png`)
    const [got, want] = await Promise.all([
      raw(probe),
      raw(path.join(reference.dir, path.basename(reference.value['url'] as string))),
    ])

    // Đo trong lòng mockup (alpha đặc). Mép silhouette là chuyện khử răng cưa, không phải của
    // phép ghép; trộn vào sẽ pha loãng con số — đúng lỗi "đo sai vùng" ở PRD §7.
    let sum = 0
    let count = 0
    let worst = 0
    for (let i = 0; i < got.data.length; i += 4) {
      if ((got.data[i + 3] ?? 0) < 250 || (want.data[i + 3] ?? 0) < 250) continue
      for (let k = 0; k < 3; k++) {
        const delta = Math.abs((got.data[i + k] ?? 0) - (want.data[i + k] ?? 0))
        sum += delta
        worst = Math.max(worst, delta)
        count++
      }
    }
    const mean = sum / Math.max(count, 1)
    expect(count, 'không có pixel đặc nào để so').toBeGreaterThan(1000)
    // Nới hơn bản numpy (1.7/255) vì đường này cộng thêm: mã hoá video, lấy mẫu texture của
    // GPU, LUT AgX (0.06 tb) và nhiễu Monte Carlo khác seed. Vượt 8/255 là mô hình sai.
    expect(mean, `lệch tb ${mean.toFixed(2)}, max ${worst}`).toBeLessThan(8)
  }, 300_000)
})
