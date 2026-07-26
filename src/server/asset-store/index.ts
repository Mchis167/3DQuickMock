import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

import { planScreenFit, type FitMode, type FitPlan, type Size } from '@/entities/screen-fit'

/**
 * Kho asset đánh địa chỉ theo NỘI DUNG: `cache/uploads/<sha256[:16]>.<ext>`.
 *
 * Vì sao theo nội dung: import lại cùng một file không sinh bản sao, và một tên file không
 * bao giờ trỏ vào hai nội dung khác nhau — nên URL của nó cache vĩnh viễn được. Pha 8 dùng
 * lại đúng cơ chế này cho project lưu ra đĩa.
 */
export const UPLOAD_DIR = 'cache/uploads'
export const SCREEN_DIR = 'cache/screens'

export interface StoredAsset {
  hash: string
  /** Đường dẫn tương đối gốc repo — dạng mà schema và Blender nhận. */
  relativePath: string
  absolutePath: string
  bytes: number
}

export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export function storeUpload(root: string, bytes: Uint8Array, extension: string): StoredAsset {
  const ext = normalizeExtension(extension)
  const hash = contentHash(bytes)
  const relativePath = path.join(UPLOAD_DIR, `${hash}${ext}`)
  const absolutePath = path.join(root, relativePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  // Cùng hash = cùng nội dung, ghi lại là vô nghĩa.
  if (!existsSync(absolutePath)) writeFileSync(absolutePath, bytes)
  return { hash, relativePath, absolutePath, bytes: bytes.byteLength }
}

export interface PreparedScreen {
  /** Ảnh đã đúng tỉ lệ màn hình, sẵn để Blender kéo giãn. */
  relativePath: string
  source: Size
  plan: FitPlan
}

/**
 * Biến ảnh vào thành ảnh có ĐÚNG tỉ lệ màn hình theo chế độ khớp đã chọn.
 *
 * Phải làm ở đây chứ không để Blender: UV màn hình trải đủ `[0,1]²` nên Blender luôn kéo
 * giãn phủ kín. Chuẩn bị trước thì phép kéo giãn đó thành phép đồng nhất.
 *
 * Tên file ra mang cả hash, chế độ và kích thước đích, nên đổi chế độ không ghi đè bản cũ
 * và ảnh trong cache của browser không lẫn sang chế độ khác.
 */
export async function prepareScreenImage(
  root: string,
  sourceRelativePath: string,
  mode: FitMode,
  target: Size,
): Promise<PreparedScreen> {
  const absoluteSource = path.resolve(root, sourceRelativePath)
  const meta = await sharp(absoluteSource).metadata()
  if (!meta.width || !meta.height) {
    throw new Error(`không đọc được kích thước ảnh: ${sourceRelativePath}`)
  }
  const source: Size = { width: meta.width, height: meta.height }
  const plan = planScreenFit(source, target, mode)

  const stem = contentHash(Buffer.from(sourceRelativePath))
  const relativePath = path.join(
    SCREEN_DIR,
    `${stem}_${mode}_${target.width}x${target.height}.png`,
  )
  const absoluteOutput = path.join(root, relativePath)
  mkdirSync(path.dirname(absoluteOutput), { recursive: true })

  await sharp(absoluteSource)
    .extract(plan.crop)
    .resize(plan.resize.width, plan.resize.height, { fit: 'fill' })
    .extend({
      top: plan.offset.top,
      left: plan.offset.left,
      bottom: target.height - plan.resize.height - plan.offset.top,
      right: target.width - plan.resize.width - plan.offset.left,
      // Dải ĐEN, không trong suốt: pixel tắt của màn hình là đen, còn alpha ở đây sẽ
      // thành lỗ nhìn xuyên qua mặt kính khi Blender dán lên.
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .png()
    .toFile(absoluteOutput)

  return { relativePath, source, plan }
}

/**
 * Ghép ảnh alpha lên nền màu đặc.
 *
 * Làm SAU khi render thay vì đặt nền trong Blender: một lần render dùng được cho cả hai
 * kiểu export, và màu ra đúng mã người dùng chọn thay vì đi qua tone map của Blender.
 */
export async function flattenOnColor(
  inputAbsolute: string,
  outputAbsolute: string,
  hex: string,
): Promise<void> {
  // sharp không cho đọc và ghi cùng một file. Ghi ra file tạm rồi đổi tên: đổi tên trong
  // cùng thư mục là nguyên tử, nên không có lúc nào file đích tồn tại ở trạng thái nửa vời.
  const temporary = `${outputAbsolute}.flatten.tmp.png`
  await sharp(inputAbsolute).flatten({ background: hex }).png().toFile(temporary)
  renameSync(temporary, outputAbsolute)
}

function normalizeExtension(extension: string): string {
  const clean = (extension.startsWith('.') ? extension : `.${extension}`).toLowerCase()
  if (!/^\.[a-z0-9]{1,5}$/.test(clean)) {
    throw new Error(`phần mở rộng không hợp lệ: ${extension}`)
  }
  return clean
}
