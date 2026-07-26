import { useEffect, useRef } from 'react'

import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { trpc } from '@/shared/api/trpc'

/**
 * Bảo đảm có dải PNG của video khi đang ở chế độ video.
 *
 * Vì sao trích ở server thay vì dùng plate: plate khoá cứng vào MỘT góc camera nên nó vô
 * dụng khi device đang animate — làm plate mỗi frame đắt hơn render thẳng 4.8–9.2× (đã đo ở
 * Pha 5). Nhưng lúc device animate thì ta đã trả tiền một lần render mỗi frame rồi, nên đổi
 * ảnh màn hình theo frame gần như miễn phí (97 vs 105 ms/frame). Xem `screen-sequence.ts`.
 *
 * Dải phụ thuộc (video, fps) và server cache theo đúng hai thứ đó, nên gọi lại là rẻ.
 */
export function useScreenSequence() {
  const mode = useDocumentStore((state) => state.document.mode)
  const fps = useDocumentStore((state) => state.document.timeline.fps)
  const video = useSessionStore((state) => state.video)
  const setScreenSequence = useSessionStore((state) => state.setScreenSequence)
  const setError = useSessionStore((state) => state.setError)

  const latest = useRef(0)

  useEffect(() => {
    if (mode !== 'video' || !video) {
      setScreenSequence(null)
      return
    }

    const ticket = ++latest.current
    // `video.url` là `/cache/uploads/...`; server cần đường dẫn asset tương đối gốc repo.
    const asset = video.url.replace(/^\//, '')

    trpc.screenSequence
      .mutate({ asset, fps })
      .then((sequence) => {
        // Kết quả cũ về sau kết quả mới thì bỏ, nếu không màn hình dùng dải của video trước.
        if (ticket !== latest.current) return
        setScreenSequence(sequence)
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return
        setScreenSequence(null)
        // Không có dải thì màn hình lặng lẽ đứng ở khung đầu — phải nói ra.
        setError(
          `Không trích được dải video: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }, [mode, video, fps, setScreenSequence, setError])
}
