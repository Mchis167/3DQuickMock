import { useEffect } from 'react'

import { lastFrame } from '@/entities/animation'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

/**
 * Đổ playhead từ uiStore sang `documentStore.autoKeyFrame`.
 *
 * Vì sao phải chuyển tay thay vì để store đọc trực tiếp: `documentStore` là lõi tài liệu,
 * nó không được biết tới state của UI — đó chính là ranh giới giữ cho Ctrl+Z không đóng
 * panel. Nhưng auto-key thì CẦN biết đang đứng ở frame nào. Một chỗ chuyển tường minh là
 * cách trả giá cho việc đó mà không phá ranh giới.
 *
 * Ở chế độ tĩnh thì `null`: mọi slider ghi vào giá trị nền như trước Pha 6.
 */
export function useAutoKey() {
  const mode = useDocumentStore((state) => state.document.mode)
  const timeline = useDocumentStore((state) => state.document.timeline)
  const setAutoKeyFrame = useDocumentStore((state) => state.setAutoKeyFrame)
  const playhead = useSessionStore((state) => state.playhead)

  useEffect(() => {
    if (mode !== 'video') {
      setAutoKeyFrame(null)
      return
    }
    // Kẹp: rút ngắn thời lượng có thể để playhead nằm ngoài clip, và auto-key ra ngoài
    // clip là tạo keyframe không bao giờ được render.
    setAutoKeyFrame(Math.min(playhead, lastFrame(timeline)))
  }, [mode, playhead, timeline, setAutoKeyFrame])
}
