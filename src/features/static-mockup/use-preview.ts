import { useEffect, useMemo, useRef } from 'react'

import { TRPCClientError } from '@trpc/client'

import { screenFramePath, videoFrameAt } from '@/entities/animation'
import { evaluateAt } from '@/entities/scene-config/evaluate'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { trpc } from '@/shared/api/trpc'
import { PREVIEW_QUALITIES } from '@/entities/session/preview-quality'
import { useDebouncedValue } from '@/shared/hooks'

/** Debounce đủ để một lần kéo slider chỉ còn một yêu cầu, chưa đủ để cảm thấy trễ. */
export const PREVIEW_DEBOUNCE_MS = 120

export {
  PREVIEW_QUALITIES,
  DRAFT_QUALITY,
  type PreviewQuality,
  type PreviewQualityLevel,
} from '@/entities/session/preview-quality'

/**
 * Vòng lặp preview: tài liệu đổi → chờ yên 120ms → gọi server → cất URL vào uiStore.
 *
 * Ba điều dễ sai đã xử lý ở đây:
 *  - Kết quả về SAI THỨ TỰ. Yêu cầu chồng nhau có thể về không theo thứ tự gửi; chỉ
 *    nhận kết quả của yêu cầu mới nhất, nếu không preview sẽ nhảy về ảnh cũ.
 *  - Yêu cầu bị hàng đợi server thay thế (`SupersededError`) là chuyện BÌNH THƯỜNG,
 *    không phải lỗi để hiện lên mặt người dùng.
 *  - Lỗi thật phải hiện ra. Im lặng ở đây nghĩa là preview đứng mà không ai biết vì sao.
 */
export function usePreview() {
  const document = useDocumentStore((state) => state.document)
  const quality = PREVIEW_QUALITIES[useSessionStore((state) => state.previewQuality)]
  const playhead = useSessionStore((state) => state.playhead)
  const playing = useSessionStore((state) => state.playing)
  const screenSequence = useSessionStore((state) => state.screenSequence)
  const curveSamples = useSessionStore((state) => state.curveSamples)

  // Preview render TÀI LIỆU TẠI FRAME ĐANG ĐỨNG, không phải giá trị nền. Không đánh giá ở
  // đây thì tua timeline sẽ không đổi hình gì cả, và timeline trở thành một cái điều khiển
  // không có phản hồi.
  //
  // `useMemo` không phải để tối ưu: `evaluateAt` tạo object mới mỗi lần render, mà
  // debounce so sánh bằng THAM CHIẾU. Không memo thì mỗi lần render (kể cả do chính
  // preview trả về) lại sinh một giá trị "mới", hẹn giờ lại chạy, và vòng render–gọi
  // server tự nuôi nhau mãi không dừng.
  const evaluated = useMemo(
    () => evaluateAt(document, curveSamples, playhead),
    [document, curveSamples, playhead],
  )
  /**
   * Ảnh màn hình cho frame đang đứng.
   *
   * Ở chế độ video có dải PNG thì màn hình phải chạy theo playhead — tua timeline mà màn
   * hình đứng ở khung đầu thì không đánh giá được video có khớp nhịp xoay hay không. Dùng
   * `videoFrameAt` (hàm thuần, dùng chung với dải phát lại và export) để ba đường không bao
   * giờ hiện ba khung khác nhau cho cùng một frame.
   */
  const screen =
    screenSequence && document.mode === 'video'
      ? screenFramePath(
          screenSequence.dir,
          videoFrameAt(document.screenClip, screenSequence.frames, playhead),
        )
      : evaluated.screen

  const settled = useDebouncedValue(
    useMemo(() => ({ ...evaluated, screen }), [evaluated, screen]),
    PREVIEW_DEBOUNCE_MS,
  )

  const setPreview = useSessionStore((state) => state.setPreview)
  const setRendering = useSessionStore((state) => state.setRendering)
  const setError = useSessionStore((state) => state.setError)

  const latest = useRef(0)

  useEffect(() => {
    // Đang phát lại thì canvas hiện dải ảnh đã render sẵn. Vẫn gọi preview ở đây là bắn
    // ~30 yêu cầu render mỗi giây vào worker cho những ảnh không ai xem.
    if (playing) return

    const ticket = ++latest.current
    setRendering(true)

    trpc.preview
      .mutate({
        camera: settled.camera,
        pose: settled.pose,
        world: settled.world,
        screen: settled.screen,
        quality,
      })
      .then((result) => {
        if (ticket !== latest.current) return
        setPreview(result)
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return
        // Server gắn mã CONFLICT cho yêu cầu bị hàng đợi thay thế. Dò theo MÃ, không
        // theo chuỗi thông báo — chuỗi đổi lúc nào cũng được mà không ai nhận ra.
        if (isSuperseded(error)) return
        setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (ticket === latest.current) setRendering(false)
      })
  }, [settled, quality, playing, setPreview, setRendering, setError])
}

function isSuperseded(error: unknown): boolean {
  if (error instanceof TRPCClientError) {
    return (error.data as { code?: string } | undefined)?.code === 'CONFLICT'
  }
  return false
}
