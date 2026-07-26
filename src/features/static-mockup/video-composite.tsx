import { useEffect, useRef, useState } from 'react'

import {
  agxLut,
  Compositor,
  loadPlate,
  meanLinearColour,
  type PlateManifest,
} from '@/entities/composite'
import { IPHONE_17_PRO_MAX } from '@/entities/device'
import { screenFitTransform, type FitMode } from '@/entities/screen-fit'
import { cn } from '@/shared/lib/cn'

/**
 * Ghép video lên màn hình mockup bằng WebGL, thời gian thực.
 *
 * Component này KHÔNG render 3D. Blender đã tính xong toàn bộ ánh sáng, phản chiếu và bóng
 * đổ, nướng sẵn vào plate; ở đây mỗi pixel chỉ còn: tra toạ độ (u,v), lấy màu video ở đó,
 * nhân với toán tử truyền, cộng nền, tra bảng AgX. Phép ghép nằm trọn trong
 * `entities/composite/composite.frag.glsl` và ĐƯỜNG EXPORT CHẠY ĐÚNG FILE ĐÓ.
 *
 * ## Vòng lặp vẽ — chỗ đã sập một lần
 *
 * Bản đầu chỉ vẽ được ĐÚNG MỘT khung rồi đứng im. Ba nguyên nhân chồng lên nhau, và cả ba đều
 * im lặng:
 *
 *  1. Hàm vẽ thoát sớm khi `readyState < 2` mà **không hẹn lượt tiếp theo** — vòng lặp chết
 *     hẳn, không có gì khởi động lại.
 *  2. `<video>` để `display: none` thì Chrome bóp nghẹt việc trình khung, và
 *     `requestVideoFrameCallback` gần như không bắn. Phải giữ nó được layout, chỉ ẩn bằng
 *     kích thước 1px và `opacity: 0`.
 *  3. Không ai gọi `play()`, và `autoplay` có thể bị chặn — mà `rVFC` chỉ bắn khi có khung
 *     MỚI được trình. Video đứng yên thì canvas đứng yên theo, không lỗi, không cảnh báo.
 *
 * Nên bây giờ: luôn hẹn lượt kế tiếp, gọi `play()` tường minh và báo lỗi ra UI nếu bị chặn.
 */

interface Props {
  manifest: PlateManifest
  /**
   * Phần tử video do canvas cha sở hữu.
   *
   * Nó nằm ở ngoài vì thanh điều khiển (phát/dừng/tua) phải điều khiển được nó KỂ CẢ khi
   * component này chưa gắn — tức khi chưa có plate và canvas đang hiện preview tĩnh.
   */
  video: HTMLVideoElement | null
  /** Kích thước thật của video — cần để tính phép khớp tỉ lệ. */
  source: { width: number; height: number }
  fitMode: FitMode
  className?: string
}

/** Khung nhỏ để lấy màu trung bình của frame — số hạng hắt sáng của shader. */
const MEAN_SIZE = 32

export function VideoComposite({ manifest, video, source, fitMode, className }: Props) {
  // Tách ra số nguyên thuỷ: `source` là object dựng mới mỗi lần cha render, nên để nguyên nó
  // trong danh sách phụ thuộc sẽ dựng lại toàn bộ context WebGL ở MỌI lượt render.
  const { width: sourceWidth, height: sourceHeight } = source
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !video) return

    let compositor: Compositor | null = null
    let cancelled = false
    let handle = 0
    let usingVideoCallback = false
    // Canvas phụ chỉ để rút gọn frame xuống 32×32 rồi lấy trung bình. Đọc thẳng texture đầy
    // đủ về CPU mỗi frame là đủ chậm để rơi khung hình.
    const scratch = document.createElement('canvas')
    scratch.width = MEAN_SIZE
    scratch.height = MEAN_SIZE
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })

    function paint() {
      if (!compositor || video!.readyState < 2) return
      let mean: [number, number, number] = [0, 0, 0]
      if (scratchCtx) {
        scratchCtx.drawImage(video!, 0, 0, MEAN_SIZE, MEAN_SIZE)
        mean = meanLinearColour(scratchCtx.getImageData(0, 0, MEAN_SIZE, MEAN_SIZE).data)
      }
      compositor.setFrame(video!, mean)
      compositor.draw()
    }

    /** Vẽ rồi LUÔN hẹn lượt kế tiếp — kể cả khi lượt này chưa vẽ được gì. */
    function tick() {
      if (cancelled) return
      paint()
      schedule()
    }

    function schedule() {
      if (cancelled) return
      // `rVFC` bắn đúng một lần mỗi khung hình bộ giải mã trình ra, nên video 30fps trên màn
      // 60Hz không bị vẽ lại hai lần cùng một khung. Nhưng nó KHÔNG bắn khi video dừng —
      // lúc đó phải rơi về rAF, nếu không canvas đứng im sau khi bấm tạm dừng.
      if ('requestVideoFrameCallback' in video! && !video!.paused) {
        usingVideoCallback = true
        handle = video!.requestVideoFrameCallback(tick)
      } else {
        usingVideoCallback = false
        handle = requestAnimationFrame(tick)
      }
    }

    async function start() {
      try {
        const [plate, lut] = await Promise.all([loadPlate(manifest), agxLut()])
        if (cancelled) return
        compositor = new Compositor(canvas!)
        compositor.setAgxLut(lut)
        compositor.setPlate(plate)
        const fit = screenFitTransform(
          { width: sourceWidth, height: sourceHeight },
          IPHONE_17_PRO_MAX.screenMm,
          fitMode,
        )
        compositor.setContentFit(fit.scale, fit.letterbox)
        setReady(true)
        tick()
        try {
          await video!.play()
        } catch (cause) {
          // Trình duyệt chặn tự phát: nói ra thay vì để người dùng nhìn một canvas đứng im và
          // tự đoán là hỏng.
          setError(
            `trình duyệt chặn tự phát (${cause instanceof Error ? cause.name : 'lỗi'}) — bấm nút phát`,
          )
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    // Nạp xong / tua xong đều phải vẽ lại: người dùng có thể tua khi đang tạm dừng.
    const onData = () => tick()
    const onVideoError = () =>
      setError(`không nạp được video (mã ${video.error?.code ?? '?'}) — kiểm tra CORS/Range`)

    video.addEventListener('loadeddata', onData)
    video.addEventListener('seeked', onData)
    video.addEventListener('error', onVideoError)
    void start()

    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', onData)
      video.removeEventListener('seeked', onData)
      video.removeEventListener('error', onVideoError)
      if (usingVideoCallback && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(handle)
      } else {
        cancelAnimationFrame(handle)
      }
      compositor?.dispose()
    }
  }, [manifest, video, sourceWidth, sourceHeight, fitMode])

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="video-composite"
        aria-label="Preview mockup có video"
        className={cn('absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)]', className)}
        // `object-contain` để khung ảnh bám KHUNG NHÌN chứ không bám số pixel của plate —
        // cùng lý do với ảnh tĩnh, xem AGENTS.md.
        style={{ objectFit: 'contain', opacity: ready ? 1 : 0 }}
      />

      {error ? (
        <p role="alert" className="text-ui text-destructive absolute inset-x-2 bottom-2">
          {error}
        </p>
      ) : null}
    </>
  )
}
