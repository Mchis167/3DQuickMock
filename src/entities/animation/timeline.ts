import { z } from 'zod'

// Import THẲNG file `timing` chứ không qua index của scene-config: index cũng tái xuất
// `document`, mà `document` lại dùng schema ở đây — đi qua index là tạo vòng import.
import { frameCount } from '@/entities/scene-config/timing'

/**
 * Thông số thời gian và khung hình của một mockup động.
 *
 * Nằm trong TÀI LIỆU (được undo, được lưu vào project) chứ không phải trong uiStore: đổi
 * từ 30 sang 60 fps là đổi chính cái sản phẩm — mọi keyframe giữ nguyên số frame sẽ rơi
 * vào thời điểm khác. Người dùng phải Ctrl+Z lại được.
 */
export const ASPECT_IDS = ['3:4', '9:16', '1:1', '16:9'] as const
export type AspectId = (typeof ASPECT_IDS)[number]

/**
 * Độ phân giải gốc của từng tỉ lệ, ở mức ×1. Export nhân lên ×2/×4 (Pha 5).
 *
 * Cả hai chiều đều CHẴN: encoder H.264/H.265 dùng chroma 4:2:0 nên chiều lẻ hoặc bị
 * ffmpeg từ chối, hoặc bị làm tròn im lặng rồi lệch một pixel so với preview.
 */
export const ASPECT_RES: Readonly<Record<AspectId, readonly [number, number]>> = {
  '3:4': [1080, 1440],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
}

export const timelineSchema = z
  .object({
    fps: z.int().min(1).max(240).default(30),
    /** Giây. Số frame suy ra từ đây — xem `frameCount` trong scene-config/timing.ts. */
    duration: z.number().positive().max(600).default(5),
    aspect: z.enum(ASPECT_IDS).default('3:4'),
  })
  .strict()

export type Timeline = z.infer<typeof timelineSchema>

/**
 * Số frame của timeline.
 *
 * Dùng lại `frameCount` chứ không tự tính: nó khớp CHÍNH XÁC phép tính trong
 * render_config.py, kể cả quy tắc làm tròn ngân hàng của Python. Chép lại công thức ở
 * đây là tạo ra hai nguồn sự thật cho cùng một con số.
 */
export function timelineFrames(timeline: Pick<Timeline, 'fps' | 'duration'>): number {
  return frameCount({ fps: timeline.fps, duration: timeline.duration })
}

/** Frame cuối cùng, 1-based. Timeline 150 frame thì frame cuối là 150. */
export function lastFrame(timeline: Pick<Timeline, 'fps' | 'duration'>): number {
  return Math.max(1, timelineFrames(timeline))
}

/**
 * Độ nét cho DẢI PHÁT LẠI — khác hẳn preview tĩnh, và đây là số đo, không phải đoán.
 *
 * `scripts/blender/bench_playback.py`, EEVEE, worker ấm, 24 frame, trung vị:
 *
 *   480×640 · 16 spp → 245 ms/frame   ← độ nét của preview tĩnh: 150 frame = 37 giây
 *   480×640 ·  4 spp →  81 ms/frame   ← rẻ đi 3.0×
 *   320×426 ·  4 spp →  76 ms/frame   ← hạ độ phân giải chỉ thêm 6%
 *   240×320 ·  2 spp →  52 ms/frame
 *
 * Kết luận: **SAMPLES là chi phí chính, không phải độ phân giải.** Nên dải phát lại giữ
 * độ phân giải đủ nhìn (cạnh dài 480) và hạ samples xuống 4. Đổi lại: ảnh có nhiễu hơn
 * preview tĩnh — chấp nhận được, vì việc phát lại dùng để đánh giá NHỊP chuyển động chứ
 * không phải chất lượng bề mặt.
 *
 * (`bpy.ops.render.opengl` — render viewport, đáng lẽ rẻ nhất — KHÔNG dùng được: chế độ
 * `-b` không có ngữ cảnh OpenGL. Đã thử và nhận đúng lỗi đó.)
 */
export const PLAYBACK_SAMPLES = 4
export const PLAYBACK_LONG_EDGE = 480
/** Đo được ở bench: dùng để ước lượng thời gian chờ TRƯỚC khi bắt đầu. */
export const PLAYBACK_MS_PER_FRAME = 81

export function playbackResolution(timeline: Pick<Timeline, 'aspect'>): [number, number] {
  const [w, h] = ASPECT_RES[timeline.aspect]
  const scale = PLAYBACK_LONG_EDGE / Math.max(w, h)
  return [even(w * scale), even(h * scale)]
}

export function resolutionOf(timeline: Pick<Timeline, 'aspect'>, scale = 1): [number, number] {
  const [w, h] = ASPECT_RES[timeline.aspect]
  return [even(w * scale), even(h * scale)]
}

/** Frame → giây, để hiện đồng hồ. Frame 1 là mốc 0s. */
export function frameToSeconds(frame: number, fps: number): number {
  return (frame - 1) / fps
}

function even(x: number): number {
  const r = Math.round(x)
  return r % 2 === 0 ? r : r + 1
}
