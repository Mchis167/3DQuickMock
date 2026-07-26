import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Trích video thành DẢI PNG để Blender dán lên màn hình theo từng frame.
 *
 * Vì sao cần: plate (Pha 5) khoá cứng vào MỘT góc camera nên nó vô dụng khi device đang
 * animate — làm plate mỗi frame đắt hơn render thẳng 4.8–9.2× (đã đo). Nhưng lúc device
 * animate thì ta đã trả tiền một lần render mỗi frame rồi, nên đổi ảnh màn hình theo frame
 * gần như miễn phí: đo được 97 ms/frame với dải vs 105 ms/frame với ảnh tĩnh
 * (`bench_screen_sequence.py`). Đó là cách "vừa xoay máy vừa phát video" mà không cần plate.
 *
 * Dải được lấy mẫu ĐÚNG fps của timeline, nên khung thứ k của dải là khung mà timeline cần
 * ở frame thứ k của clip — không phải quy đổi thời gian ở đâu nữa.
 */

/** Tên file khung đầu; Blender suy các khung sau theo số thứ tự trong tên này. */
export const SEQUENCE_PREFIX = 'scr_'

export interface ScreenSequence {
  /** Thư mục tương đối so với gốc repo, để client dựng URL. */
  dir: string
  /** Số khung trích được. Đây là ĐỘ DÀI THẬT của clip trên timeline. */
  frames: number
}

/**
 * Đối số ffmpeg — hàm THUẦN để test được mà không cần chạy ffmpeg.
 *
 * `-vsync cfr` cộng `fps=` là điểm cốt yếu: không có nó thì ffmpeg giữ nguyên nhịp gốc của
 * video (variable frame rate của điện thoại chẳng hạn) và số khung ra sẽ KHÔNG khớp số frame
 * timeline — clip dài ra hoặc ngắn lại mà không có gì báo.
 */
export function sequenceArgs(input: string, outDir: string, fps: number): string[] {
  return [
    '-v',
    'error',
    '-i',
    input,
    '-vf',
    `fps=${fps}`,
    '-vsync',
    'cfr',
    '-start_number',
    '1',
    path.join(outDir, `${SEQUENCE_PREFIX}%04d.png`),
  ]
}

/** Đếm khung ĐÃ GHI ra đĩa, không tin con số tính từ thời lượng. */
export function countSequence(absoluteDir: string): number {
  if (!existsSync(absoluteDir)) return 0
  return readdirSync(absoluteDir).filter(
    (name) => name.startsWith(SEQUENCE_PREFIX) && name.endsWith('.png'),
  ).length
}

/**
 * Trích dải cho một asset video ở một fps. Kết quả được CACHE theo (asset, fps): dải là hàm
 * thuần của hai thứ đó, và trích lại mỗi lần vào chế độ video là bắt người dùng chờ vô ích.
 */
export async function extractScreenSequence(options: {
  root: string
  /** Đường dẫn asset tương đối so với gốc repo, ví dụ `cache/uploads/ab12.mp4`. */
  asset: string
  fps: number
  /** Khoá cache; phía gọi truyền một chuỗi ổn định suy từ (asset, fps). */
  key: string
}): Promise<ScreenSequence> {
  const relative = `cache/screen-seq/${options.key}`
  const absolute = path.join(options.root, relative)

  const cached = countSequence(absolute)
  if (cached > 0) return { dir: relative, frames: cached }

  const input = path.join(options.root, options.asset)
  if (!existsSync(input)) throw new Error(`không có video: ${options.asset}`)

  mkdirSync(absolute, { recursive: true })
  await run('ffmpeg', sequenceArgs(input, absolute, options.fps))

  const frames = countSequence(absolute)
  // Rào chắn: ffmpeg thoát mã 0 kể cả khi không ghi ra khung nào (ví dụ video không có
  // luồng hình). Dải rỗng mà báo thành công thì Blender sẽ dán màu magenta "thiếu texture"
  // cho cả clip — không lỗi, không cảnh báo. Đúng loại bẫy im lặng dự án này đã gặp nhiều.
  if (frames === 0) {
    throw new Error(`ffmpeg không trích được khung nào từ ${options.asset}`)
  }
  return { dir: relative, frames }
}
