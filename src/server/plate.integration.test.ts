import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { locateBlender } from './worker-bridge/locate-blender'
import { BlenderWorker } from './worker-bridge/worker-process'

/**
 * Plate v2 cho Pha 5 — Blender THẬT. Xem `scripts/blender/plate.py`.
 *
 * Bộ này tồn tại vì plate hỏng theo kiểu **im lặng**: nó vẫn ra bốn buffer đúng kích thước
 * trong khi số bên trong là rác. Đã sập thật ba lần khác nhau:
 *  - `view_layer.material_override` của EEVEE Next KHÔNG đánh giá node UV, trả hằng số ~0.008;
 *  - gõ nhầm tên light group không raise, AOV vẫn tồn tại và toàn 0 (màn hình đứng yên);
 *  - `color_mode = "RGB"` làm EXR mất alpha, mặt nạ thành cả khung hình.
 * Không cái nào lộ ra qua "file có tồn tại không".
 */

const ROOT = process.cwd()
const CONFIG = {
  screen: 'assets/test/stimulus.png',
  world: { hdri: 'assets/hdri/studio_small_03.hdr', strength: 1, rotation: 0 },
  quality: { engine: 'cycles' as const, res: [240, 320] as [number, number], samples: 32 },
  camera: { azimuth: 20, elevation: 12, frame_fill: 0.72, focal: 85 },
  pose: { spin_x: 0, spin_y: 0, spin_z: 0, ground: true },
}
const [WIDTH, HEIGHT] = CONFIG.quality.res

let worker: BlenderWorker
let dir: string
let plate: PlateReply

interface BufferInfo {
  path: string
  width: number
  height: number
  channels: number
  dtype: 'half' | 'float32'
}
interface PlateReply {
  ok: boolean
  res: [number, number]
  files: Record<'base' | 't' | 'alpha' | 'uv', BufferInfo>
  screen_px: number
  pushed_px: number
  [key: string]: unknown
}

/** Đọc `.bin` thô về mảng float. `half` phải giải mã tay — JS không có Float16Array. */
function readBuffer(info: BufferInfo): Float64Array {
  const bytes = readFileSync(info.path)
  const count = info.width * info.height * info.channels
  const out = new Float64Array(count)
  if (info.dtype === 'float32') {
    const view = new Float32Array(bytes.buffer, bytes.byteOffset, count)
    out.set(view)
    return out
  }
  const view = new Uint16Array(bytes.buffer, bytes.byteOffset, count)
  for (let i = 0; i < count; i++) out[i] = decodeHalf(view[i] ?? 0)
  return out
}

function decodeHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'plate-'))
  worker = new BlenderWorker({ root: ROOT })
  await worker.start()
  plate = (await worker.send({
    cmd: 'plate',
    out_dir: path.join(dir, 'p'),
    ...CONFIG,
  })) as unknown as PlateReply
}, 180_000)

afterAll(async () => {
  await worker?.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('plate v2 — Blender thật', () => {
  it('ra đủ bốn buffer, đúng kích thước và đúng kiểu dữ liệu', () => {
    expect(plate.ok).toBe(true)
    expect(plate.res).toEqual([WIDTH, HEIGHT])
    const expected = {
      base: { channels: 3, dtype: 'half' },
      t: { channels: 3, dtype: 'half' },
      alpha: { channels: 1, dtype: 'half' },
      // uv KHÔNG được là half: gần 1.0 thì half sai 1/2048, nhân với 1179 px chiều ngang ảnh
      // màn hình là 0.58 px — vượt ngưỡng "dưới một pixel" mà spike Pha 2.5 đặt ra.
      uv: { channels: 3, dtype: 'float32' },
    } as const
    for (const [name, want] of Object.entries(expected)) {
      const info = plate.files[name as keyof typeof expected]
      expect(existsSync(info.path), name).toBe(true)
      expect(info.channels, name).toBe(want.channels)
      expect(info.dtype, name).toBe(want.dtype)
      const bytesPerSample = want.dtype === 'float32' ? 4 : 2
      expect(statSync(info.path).size, name).toBe(
        WIDTH * HEIGHT * want.channels * bytesPerSample,
      )
    }
  })

  it('mặt nạ chiếm một phần hợp lý của khung, và `push_uv` nới nó ra', () => {
    const total = WIDTH * HEIGHT
    // `color_mode = "RGB"` làm EXR mất alpha và mặt nạ thành 100% khung hình — trong khi rào
    // chắn kênh B và rào chắn dải UV đều vẫn xanh.
    expect(plate.screen_px / total).toBeGreaterThan(0.05)
    expect(plate.screen_px / total).toBeLessThan(0.6)
    // Nới ra phải THÊM pixel, nhưng chỉ một vành mỏng — nới quá tay là video tràn ra thân máy.
    expect(plate.pushed_px).toBeGreaterThan(plate.screen_px)
    expect(plate.pushed_px).toBeLessThan(plate.screen_px * 1.25)
  })

  it('UV liên tục và nằm trong [0,1]; T mang dữ liệu thật', () => {
    const uv = readBuffer(plate.files.uv)
    const t = readBuffer(plate.files.t)
    let uMin = 1
    let uMax = 0
    let biggestJump = 0
    let transmissionSum = 0
    let inside = 0
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        const i = (y * WIDTH + x) * 3
        if ((uv[i + 2] ?? 0) <= 0.5) continue
        inside++
        uMin = Math.min(uMin, uv[i] ?? 0)
        uMax = Math.max(uMax, uv[i] ?? 0)
        transmissionSum += ((t[i] ?? 0) + (t[i + 1] ?? 0) + (t[i + 2] ?? 0)) / 3
        const right = i + 3
        if ((uv[right + 2] ?? 0) > 0.5) {
          biggestJump = Math.max(
            biggestJump,
            Math.abs((uv[i] ?? 0) - (uv[right] ?? 0)),
            Math.abs((uv[i + 1] ?? 0) - (uv[right + 1] ?? 0)),
          )
        }
      }
    }
    expect(inside).toBeGreaterThan(1000)
    expect(uMax - uMin).toBeGreaterThan(0.9)
    expect(uMin).toBeGreaterThanOrEqual(0)
    expect(uMax).toBeLessThanOrEqual(1)
    // Màn hình là MỘT mảnh phẳng nên hai pixel kề nhau phải sát nhau. Bản material_override
    // hỏng cho ra dải hằng số; loại rác khác thì nhảy lung tung.
    expect(biggestJump).toBeLessThan(0.08)
    // T là đóng góp của màn hình trắng ở `Emission Strength = 1.6` — phải rõ ràng lớn hơn 0.
    // Light group gõ nhầm tên vẫn ra AOV hợp lệ nhưng TOÀN SỐ 0, và đó là ca này bắt.
    expect(transmissionSum / inside).toBeGreaterThan(0.5)
  })

  it('base không âm và tối hơn hẳn T — hai số hạng tách bạch', () => {
    const uv = readBuffer(plate.files.uv)
    const base = readBuffer(plate.files.base)
    const t = readBuffer(plate.files.t)
    let baseSum = 0
    let transmissionSum = 0
    let inside = 0
    let negative = 0
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      if ((uv[i * 3 + 2] ?? 0) <= 0.5) continue
      inside++
      for (let k = 0; k < 3; k++) {
        const b = base[i * 3 + k] ?? 0
        if (b < 0) negative++
        baseSum += b
        transmissionSum += t[i * 3 + k] ?? 0
      }
    }
    // Bức xạ âm là vô nghĩa; plate cắt về 0 nên ở đây phải sạch tuyệt đối.
    expect(negative).toBe(0)
    // Trong lòng màn hình, base chỉ còn phản chiếu trên kính nên phải nhỏ hơn T nhiều lần.
    // Sát nhau nghĩa là phân rã hỏng và phép ghép sẽ gần như không đổi theo nội dung video.
    expect(baseSum / inside).toBeLessThan(transmissionSum / inside / 3)
  })

  it('KHÔNG để lại dấu vết: still sau plate trùng từng pixel với still trước', async () => {
    const before = path.join(dir, 'before.png')
    const after = path.join(dir, 'after.png')
    const still = { ...CONFIG, quality: { ...CONFIG.quality, engine: 'eevee' as const } }
    await worker.send({ cmd: 'still', out: before, ...still })
    await worker.send({ cmd: 'plate', out_dir: path.join(dir, 'p2'), ...CONFIG })
    await worker.send({ cmd: 'still', out: after, ...still })

    // Plate đổi engine, compositor, light group, vật liệu màn hình, view transform, filter
    // size, `color_mode` và cờ holdout của từng object. Khôi phục sót một thứ thì mọi preview
    // SAU đó sai — và sai theo kiểu không ai nghi ngờ vì ảnh vẫn đẹp.
    //
    // So PIXEL ĐÃ GIẢI MÃ chứ không so file: hai lần ghi PNG giống hệt vẫn lệch 5 byte trong
    // chunk `eXIf` (dấu thời gian).
    const [a, b] = await Promise.all([
      sharp(before).raw().toBuffer(),
      sharp(after).raw().toBuffer(),
    ])
    expect(Buffer.compare(a, b)).toBe(0)
  }, 180_000)
})

describe('plate ghép ra có bằng render Blender đầy đủ không', () => {
  it('đạt ngưỡng ở cả bốn vùng, và bỏ xa mô hình sRGB của Pha 5a', () => {
    // Chạy qua script riêng vì phép đo cần numpy và cần một render tham chiếu — cả hai đều
    // nằm trong Blender. Script in ra một dòng `@@` JSON, cùng quy ước với worker.
    const stdout = execFileSync(
      locateBlender(),
      [
        '-b',
        '--factory-startup',
        '-P',
        'scripts/blender/plate_fidelity.py',
        '--',
        path.join(dir, 'fidelity'),
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
    const line = stdout.split('\n').find((l) => l.startsWith('@@'))
    expect(line, 'không thấy dòng kết quả').toBeTruthy()
    const r = JSON.parse(line!.slice(2))

    // Rào chắn đặt lên chính BỘ KÍCH THÍCH. Bộ chỉ có 0 và 255 sẽ cho mọi mô hình điểm gần
    // như nhau — đó đúng là cách Pha 5a chọn nhầm công thức, sai hơn 30 lần mà số đo vẫn đẹp.
    expect(r.stimulus.mid_levels, 'kích thích phải quét GIỮA dải').toBeGreaterThanOrEqual(3)
    expect(r.stimulus.saturated_px, 'kích thích phải có màu bão hoà').toBeGreaterThan(1000)

    // Ngưỡng theo vùng. Đo thật (240×320, Cycles 128 spp, denoise off, az 20 / el 12):
    //   lòng 1.700 · vành 0.160 · thân 0.412 · silhouette 0.029
    expect(r.screen_core.mean).toBeLessThan(2.0)
    expect(r.screen_edge.mean).toBeLessThan(2.0)
    expect(r.body.mean).toBeLessThan(4.0)
    expect(r.silhouette.mean).toBeLessThan(2.0)

    // Và phải bỏ xa mô hình cũ. Không có đối chứng này thì "1.7/255" chỉ là một con số trôi
    // nổi — chính vì thiếu nó mà 5a tin rằng 4.32/255 là tốt.
    expect(r.legacy_srgb_lerp_screen_core.mean).toBeGreaterThan(r.screen_core.mean * 10)
  }, 300_000)
})
