import { mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { contentHash, flattenOnColor, prepareScreenImage, storeUpload } from './index'

const ROOT = process.cwd()
const TMP = 'cache/test-assets'
const TARGET = { width: 300, height: 650 }

/** Ảnh vào có nội dung KHÁC nhau ở giữa và ở mép, để biết được phần nào bị cắt. */
async function makeSource(name: string, width: number, height: number): Promise<string> {
  const relative = path.join(TMP, name)
  await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .composite([
      {
        // Vệt xanh dọc giữa ảnh: sau khi khớp tỉ lệ nó phải còn ở giữa.
        input: {
          create: {
            width: Math.max(2, Math.round(width / 10)),
            height,
            channels: 3,
            background: { r: 0, g: 0, b: 255 },
          },
        },
        gravity: 'center',
      },
    ])
    .png()
    .toFile(path.join(ROOT, relative))
  return relative
}

async function pixel(relative: string, x: number, y: number) {
  const { data, info } = await sharp(path.join(ROOT, relative))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const index = (y * info.width + x) * info.channels
  return {
    r: data[index] ?? 0,
    g: data[index + 1] ?? 0,
    b: data[index + 2] ?? 0,
    a: data[index + 3] ?? 0,
  }
}

beforeAll(() => {
  mkdirSync(path.join(ROOT, TMP), { recursive: true })
})

afterAll(() => {
  rmSync(path.join(ROOT, TMP), { recursive: true, force: true })
})

describe('storeUpload', () => {
  it('đặt tên theo nội dung: cùng byte thì cùng file', () => {
    const bytes = Buffer.from('nội dung ảnh giả')
    const first = storeUpload(ROOT, bytes, 'png')
    const second = storeUpload(ROOT, bytes, '.png')
    expect(second.relativePath).toBe(first.relativePath)
    expect(first.hash).toBe(contentHash(bytes))
    expect(statSync(first.absolutePath).size).toBe(bytes.byteLength)
    rmSync(first.absolutePath, { force: true })
  })

  it('nội dung khác thì tên khác', () => {
    const a = storeUpload(ROOT, Buffer.from('a'), 'png')
    const b = storeUpload(ROOT, Buffer.from('b'), 'png')
    // Nếu trùng tên thì ảnh mới bị ảnh cũ trong cache browser che mất.
    expect(a.relativePath).not.toBe(b.relativePath)
    rmSync(a.absolutePath, { force: true })
    rmSync(b.absolutePath, { force: true })
  })

  it('chặn phần mở rộng lạ — nó đi vào tên file trên đĩa', () => {
    expect(() => storeUpload(ROOT, Buffer.from('x'), '../../etc/passwd')).toThrow(
      /không hợp lệ/,
    )
    expect(() => storeUpload(ROOT, Buffer.from('x'), '')).toThrow(/không hợp lệ/)
  })
})

describe('prepareScreenImage', () => {
  it('fill: ảnh ra đúng kích thước đích, KHÔNG có dải đen', async () => {
    const source = await makeSource('wide.png', 1920, 1080)
    const prepared = await prepareScreenImage(ROOT, source, 'fill', TARGET)

    const meta = await sharp(path.join(ROOT, prepared.relativePath)).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual(TARGET)
    expect(prepared.plan.cropped).toBe(true)

    // Mép trên và mép dưới phải là nội dung ảnh (đỏ), không phải dải đen.
    for (const y of [1, TARGET.height - 2]) {
      const p = await pixel(prepared.relativePath, 5, y)
      expect(p.r).toBeGreaterThan(200)
      expect(p.b).toBeLessThan(60)
    }
    // Vệt xanh vẫn ở giữa: cắt lệch thì nó trôi đi.
    const center = await pixel(prepared.relativePath, TARGET.width / 2, TARGET.height / 2)
    expect(center.b).toBeGreaterThan(200)
  })

  it('fit: giữ trọn nội dung và dải là ĐEN ĐẶC, không phải trong suốt', async () => {
    const source = await makeSource('wide2.png', 1920, 1080)
    const prepared = await prepareScreenImage(ROOT, source, 'fit', TARGET)

    const meta = await sharp(path.join(ROOT, prepared.relativePath)).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual(TARGET)
    expect(prepared.plan.letterboxed).toBe(true)

    const top = await pixel(prepared.relativePath, TARGET.width / 2, 2)
    expect(top).toMatchObject({ r: 0, g: 0, b: 0 })
    // Alpha ở dải đen phải ĐẶC. Trong suốt thì Blender dán lên sẽ thành lỗ nhìn xuyên
    // qua mặt kính, và trên ảnh render trông như máy bị khoét.
    expect(top.a).toBe(255)

    const center = await pixel(prepared.relativePath, TARGET.width / 2, TARGET.height / 2)
    expect(center.b).toBeGreaterThan(200)
  })

  it('stretch: phủ kín, không cắt, không dải', async () => {
    const source = await makeSource('wide3.png', 1920, 1080)
    const prepared = await prepareScreenImage(ROOT, source, 'stretch', TARGET)
    expect(prepared.plan.distorted).toBe(true)
    const top = await pixel(prepared.relativePath, 3, 2)
    expect(top.r).toBeGreaterThan(200)
    expect(top.a).toBe(255)
  })

  it('đổi chế độ không ghi đè file của chế độ cũ', async () => {
    const source = await makeSource('wide4.png', 1920, 1080)
    const fill = await prepareScreenImage(ROOT, source, 'fill', TARGET)
    const fit = await prepareScreenImage(ROOT, source, 'fit', TARGET)
    expect(fill.relativePath).not.toBe(fit.relativePath)
  })

  it('file không phải ảnh thì báo lỗi rõ ràng', async () => {
    const junk = storeUpload(ROOT, Buffer.from('đây không phải ảnh'), 'png')
    await expect(prepareScreenImage(ROOT, junk.relativePath, 'fill', TARGET)).rejects.toThrow()
    rmSync(junk.absolutePath, { force: true })
  })
})

describe('flattenOnColor', () => {
  it('ghép nền màu thì hết alpha và màu đúng mã đã chọn', async () => {
    const relative = path.join(TMP, 'alpha.png')
    const absolute = path.join(ROOT, relative)
    await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(absolute)

    const flat = path.join(ROOT, TMP, 'flat.png')
    await flattenOnColor(absolute, flat, '#123456')

    const p = await pixel(path.join(TMP, 'flat.png'), 5, 5)
    // Đúng MÃ người dùng chọn, không phải màu đã đi qua tone map của Blender.
    expect(p).toMatchObject({ r: 0x12, g: 0x34, b: 0x56, a: 255 })
  })
})
