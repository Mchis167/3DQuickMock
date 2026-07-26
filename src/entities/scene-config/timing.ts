import type { RenderSettings } from '@schema/scene-config'

/**
 * Số frame sẽ render. Phải khớp CHÍNH XÁC phép tính trong render_config.py:
 *
 *     n_frames = r.get("frames") or round(sc.render.fps * r.get("duration", 5.0))
 *
 * Lệch một frame là timeline của UI dài khác clip xuất ra, và người dùng chỉ phát
 * hiện sau khi render xong.
 *
 * Cẩn thận với `round`: Python làm tròn ngân hàng (0.5 về số chẵn), JS `Math.round`
 * làm tròn lên. Chỉ lệch khi fps*duration rơi đúng .5 — hiếm nhưng có thật, ví dụ
 * 25fps × 4.02s. Ở đây dùng đúng quy tắc của Python.
 */
export function frameCount(
  render: Pick<RenderSettings, 'fps' | 'duration' | 'frames'>,
): number {
  if (render.frames !== undefined) return render.frames
  return roundHalfToEven(render.fps * (render.duration ?? 5))
}

function roundHalfToEven(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}
