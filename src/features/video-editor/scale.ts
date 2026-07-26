import { FIRST_FRAME } from '@/entities/animation'

/**
 * Quy đổi frame ↔ pixel trên thước timeline. Thuần, để test được mà không cần DOM.
 *
 * Quy ước: frame ĐẦU nằm ở mép trái (x = 0), frame CUỐI nằm ở mép phải (x = width). Nhờ
 * vậy kéo keyframe ra sát mép phải là chạm đúng frame cuối, không phải "gần cuối" —
 * timeline mà không chạm được frame cuối thì không dựng được vòng lặp khép kín.
 */
export function frameToX(frame: number, width: number, lastFrame: number): number {
  const span = Math.max(1, lastFrame - FIRST_FRAME)
  return ((frame - FIRST_FRAME) / span) * width
}

export function xToFrame(x: number, width: number, lastFrame: number): number {
  if (width <= 0) return FIRST_FRAME
  const span = Math.max(1, lastFrame - FIRST_FRAME)
  const frame = Math.round((x / width) * span) + FIRST_FRAME
  return Math.min(Math.max(frame, FIRST_FRAME), Math.max(lastFrame, FIRST_FRAME))
}

/**
 * Các frame nên vẽ vạch chia, sao cho vạch không dày quá mức đọc được.
 *
 * Bước nhảy lấy từ tập "đẹp" theo giây (1, 2, 5, 10, 30, 60 giây) chứ không phải bội số
 * của pixel: người dùng nghĩ theo thời gian, và một vạch mỗi 37 frame thì không nói lên
 * điều gì.
 */
const NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300]
const MIN_TICK_PX = 56

export function tickFrames(width: number, lastFrame: number, fps: number): number[] {
  if (width <= 0 || lastFrame <= FIRST_FRAME) return [FIRST_FRAME]
  const perFrame = width / Math.max(1, lastFrame - FIRST_FRAME)
  const seconds =
    NICE_SECONDS.find((s) => s * fps * perFrame >= MIN_TICK_PX) ??
    NICE_SECONDS[NICE_SECONDS.length - 1]!
  const step = Math.max(1, Math.round(seconds * fps))

  const frames: number[] = []
  for (let f = FIRST_FRAME; f <= lastFrame; f += step) frames.push(f)
  // Frame cuối luôn có vạch, nhưng không đè lên vạch trước nó.
  const last = frames[frames.length - 1]
  if (last !== lastFrame) {
    if (
      last !== undefined &&
      frameToX(lastFrame, width, lastFrame) - frameToX(last, width, lastFrame) <
        MIN_TICK_PX * 0.6
    ) {
      frames.pop()
    }
    frames.push(lastFrame)
  }
  return frames
}

/** `mm:ss.cc` — đủ chính xác để đọc frame, đủ ngắn để nhét vào thước. */
export function formatTimecode(frame: number, fps: number, isLast = false): string {
  const total = isLast ? frame / fps : (frame - FIRST_FRAME) / fps
  const minutes = Math.floor(total / 60)
  const seconds = Math.floor(total % 60)
  const centis = Math.round((total % 1) * 100) % 100
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}
