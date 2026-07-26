import { useEffect, useRef } from 'react'

/**
 * Vẽ MỘT frame của dải phát lại lên canvas.
 *
 * Vì sao là canvas chứ không phải `<img src=...>`: đổi `src` 30 lần mỗi giây là 30 lần tải
 * và giải mã, và khi không kịp thì `<img>` **giữ nguyên ảnh cũ** — nó không xoá ảnh đang
 * hiện để chờ ảnh mới. Kết quả là một khung hình đứng im trong khi mọi con số đều nói là
 * đang phát. Vẽ từ `HTMLImageElement` đã giữ sẵn thì mỗi khung chỉ là một phép copy pixel:
 * đồng bộ, không mạng, không phụ thuộc bộ đệm HTTP.
 *
 * Nhận cùng `className`/`style` với thẻ `<img>` của preview tĩnh nên fit/zoom không phải
 * viết lần thứ hai.
 */
export function PlaybackFrame({
  images,
  frame,
  className,
  style,
  onSizeChange,
}: {
  images: readonly HTMLImageElement[]
  /** 1-based, đúng như Blender đếm. */
  frame: number
  className?: string
  style?: React.CSSProperties
  /** Gọi khi kích thước dải khác lần trước — để khung nhìn recentre đúng một lần. */
  onSizeChange?: (width: number, height: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lastSize = useRef<string | null>(null)

  const image = images[Math.min(Math.max(frame, 1), images.length) - 1]

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !image) return

    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    // Ảnh lỗi (0×0) thì bỏ qua: đặt canvas về 0 sẽ làm khung nhìn nhảy về giữa.
    if (width === 0 || height === 0) return

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const context = canvas.getContext('2d')
    // jsdom không có ngữ cảnh 2D; không vẽ được thì thôi, đừng nổ.
    if (!context) return
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0)

    const key = `${width}×${height}`
    if (lastSize.current !== key) {
      lastSize.current = key
      onSizeChange?.(width, height)
    }
  }, [image, onSizeChange])

  return (
    <canvas
      ref={ref}
      aria-label="Playback frame"
      data-frame={frame}
      className={className}
      style={style}
    />
  )
}
