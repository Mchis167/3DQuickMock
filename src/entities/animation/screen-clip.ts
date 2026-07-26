import { z } from 'zod'

/**
 * Clip màn hình trên timeline: video nằm ở ĐÂU trong trục thời gian.
 *
 * Vì sao cần: ở chế độ video, device xoay theo keyframe còn màn hình phát video. Hai thứ
 * không nhất thiết bắt đầu cùng lúc — thường muốn máy xoay vào khung trước, rồi video mới
 * chạy. `start` là frame timeline mà KHUNG ĐẦU của video xuất hiện.
 *
 * Trước `start` giữ khung đầu, sau khi hết video giữ khung cuối. Không lặp: lặp thì người
 * dùng không biết clip dài bao nhiêu chỉ bằng cách nhìn, và một vòng lặp không khớp nhịp
 * xoay trông như lỗi.
 *
 * `start` ĐƯỢC PHÉP nhỏ hơn 1 hoặc lớn hơn số frame timeline — kéo clip ra ngoài là cách
 * hợp lệ để nói "video bắt đầu trước khi cảnh bắt đầu" (bỏ mấy giây đầu) hoặc "không kịp
 * chạy". Kẹp ở đây sẽ làm cú kéo bị dính không giải thích được.
 */
export const screenClipSchema = z
  .object({
    start: z.int().default(1),
  })
  .strict()

export type ScreenClip = z.infer<typeof screenClipSchema>

/**
 * Khung video (1-based) cần dán lên màn hình tại một frame timeline.
 *
 * Kẹp hai đầu: trước clip giữ khung đầu, sau clip giữ khung cuối. Đây là hàm THUẦN và là
 * nguồn sự thật duy nhất cho phép ánh xạ đó — cả preview tĩnh, dải phát lại và export đều
 * phải dùng nó, nếu không ba đường sẽ hiện ba khung khác nhau cho cùng một frame.
 */
export function videoFrameAt(
  clip: ScreenClip,
  videoFrames: number,
  timelineFrame: number,
): number {
  if (videoFrames < 1) return 1
  const index = timelineFrame - clip.start + 1
  return Math.min(Math.max(index, 1), videoFrames)
}

/**
 * Tên file khung thứ `index` (1-based) của dải — phải khớp CHÍNH XÁC quy ước ffmpeg dùng
 * lúc trích (`SEQUENCE_PREFIX` + `%04d` trong `server/screen-sequence.ts`) và quy ước
 * Blender dùng lúc suy khung tiếp theo. Ba nơi, một định dạng.
 */
export function screenFramePath(dir: string, index: number): string {
  return `${dir}/scr_${String(Math.max(1, Math.round(index))).padStart(4, '0')}.png`
}

/** Frame timeline cuối cùng mà clip còn chạy (khung cuối của video rơi vào đây). */
export function clipEnd(clip: ScreenClip, videoFrames: number): number {
  return clip.start + Math.max(1, videoFrames) - 1
}

/**
 * Chia dải render thành các lượt KHÔNG bắc qua mốc `start`.
 *
 * Vì sao phải chia đúng chỗ đó: dải ảnh của Blender chỉ đúng từ `start` trở đi — trước đó
 * nó hiện màu magenta "thiếu texture" (đã đo, xem PRD §7). Nên phần trước `start` phải
 * render bằng MỘT ảnh tĩnh (khung đầu), phần sau mới dùng dải. Một lượt bắc qua mốc thì
 * không chọn được cách nào cho cả lượt.
 *
 * Trả về các lượt liên tiếp phủ kín [1, frames], mỗi lượt kèm cờ `sequence` cho biết lượt
 * đó dùng dải ảnh hay ảnh tĩnh.
 */
export interface RenderChunk {
  readonly from: number
  readonly to: number
  /** `true` = dùng dải ảnh; `false` = dùng một ảnh tĩnh (khung đầu của video). */
  readonly sequence: boolean
}

export function renderChunks(
  frames: number,
  chunkSize: number,
  clip: ScreenClip | null,
): RenderChunk[] {
  if (frames < 1) return []
  const size = Math.max(1, chunkSize)
  // Không có clip (chưa import video) thì mọi lượt dùng ảnh tĩnh như trước.
  const boundary = clip ? Math.min(Math.max(clip.start, 1), frames + 1) : 1
  const chunks: RenderChunk[] = []

  for (let from = 1; from <= frames; from += size) {
    let to = Math.min(from + size - 1, frames)
    const sequence = clip !== null && from >= boundary
    // Cắt sớm nếu lượt này sẽ bắc qua mốc.
    if (!sequence && clip !== null && to >= boundary) to = boundary - 1
    chunks.push({ from, to, sequence })
    // `from` nhảy theo `to` thật, không theo `size`, để lượt bị cắt không bỏ sót frame.
    from = to - size + 1
  }
  return chunks
}
