import { useEffect, useRef } from 'react'

import { hasAnimation, lastFrame } from '@/entities/animation'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { trpc } from '@/shared/api/trpc'
import { useDebouncedValue } from '@/shared/hooks'

/** Đủ để một cú kéo keyframe chỉ tốn một lần lấy mẫu. */
const SAMPLE_DEBOUNCE_MS = 100

/**
 * Lấy mẫu TOÀN BỘ đường cong một lần, mỗi khi keyframe hoặc trục thời gian đổi.
 *
 * Vì sao lấy hết cả dải chứ không lấy từng frame khi tua: lấy mẫu là phép tính fcurve
 * thuần, không render gì, nên 150 frame × 9 kênh cũng chỉ là một lần gọi. Đổi lại, tua
 * timeline thành phép tra bảng — tức thì, không phụ thuộc mạng. Đây chính là "dải
 * precompute" của kế hoạch, nhưng cho GIÁ TRỊ chứ không cho ảnh.
 *
 * Giá trị vào uiStore chứ không vào tài liệu: nó là state dẫn xuất từ `channels`.
 */
export function useCurveSample() {
  const channels = useDocumentStore((state) => state.document.channels)
  const timeline = useDocumentStore((state) => state.document.timeline)
  const setCurveSamples = useSessionStore((state) => state.setCurveSamples)
  const setError = useSessionStore((state) => state.setError)

  // Debounce trên một khoá chuỗi: object `channels` đổi tham chiếu mỗi lần patch, nhưng
  // nội dung có thể y nguyên (ví dụ kéo keyframe rồi kéo về đúng chỗ cũ).
  const key = useDebouncedValue(
    JSON.stringify({ channels, fps: timeline.fps, duration: timeline.duration }),
    SAMPLE_DEBOUNCE_MS,
  )
  const latest = useRef(0)

  useEffect(() => {
    const { channels: current, timeline: time } = useDocumentStore.getState().document
    if (!hasAnimation(current)) {
      setCurveSamples(null)
      return
    }

    const end = lastFrame(time)
    const frames = Array.from({ length: end }, (_, i) => i + 1)
    const ticket = ++latest.current

    trpc.sampleCurves
      .mutate({ channels: current, frames })
      .then((reply) => {
        // Kết quả cũ về sau kết quả mới thì bỏ — nếu không, tua timeline sẽ nhảy về
        // đường cong của lần chỉnh trước.
        if (ticket !== latest.current) return
        setCurveSamples(reply.values)
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return
        // Không có mẫu thì preview lặng lẽ hiện giá trị nền — đúng loại lỗi im lặng dự án
        // này đã gặp nhiều lần, nên phải nói ra.
        setCurveSamples(null)
        setError(
          `Không lấy được đường cong từ Blender: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }, [key, setCurveSamples, setError])
}
