import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { playbackFramesFor } from '@/entities/session/playback-frames'
import { apiUrl } from '@/shared/api/trpc'
import { cn } from '@/shared/lib/cn'
import {
  centerView,
  clampScale,
  fitScale,
  panBy,
  wheelFactor,
  zoomAt,
  type ViewTransform,
} from '@/shared/lib/zoom'
import { CheckerCanvas } from '@/shared/ui/checker-canvas'
import { Segmented } from '@/shared/ui/segmented'

import { PlaybackFrame } from './playback-frame'
import { usePlateInvalidation, useBuildPlate } from './use-plate'
import { PREVIEW_QUALITIES } from './use-preview'
import { VideoComposite } from './video-composite'
import { VideoTransport } from './video-transport'

const MODES = [
  { value: 'fit' as const, label: 'Fit' },
  { value: 'zoom' as const, label: 'Zoom' },
]

const QUALITIES = [
  { value: 'low' as const, label: 'Low' },
  { value: 'med' as const, label: 'Med' },
  { value: 'high' as const, label: 'High' },
  { value: 'max' as const, label: 'Max' },
]

/**
 * Khung preview + thanh công cụ riêng của canvas.
 *
 * Hai chế độ: `Fit` cho ảnh vừa khít khung nhìn — kích thước hiện lên chỉ phụ thuộc KHUNG
 * NHÌN, không phụ thuộc số pixel của ảnh, nên đổi mức độ nét thì mockup y nguyên, chỉ nét
 * hơn. `Zoom` cho phóng bằng con lăn, kéo để di, và phím tắt.
 *
 * Ảnh cũ được GIỮ trong lúc render ảnh mới, chỉ mờ đi. Xoá ảnh rồi hiện spinner làm khung
 * nhấp nháy mỗi lần kéo slider, và mất luôn cái để so sánh trước/sau.
 */
export function PreviewCanvas() {
  const preview = useSessionStore((state) => state.preview)
  const rendering = useSessionStore((state) => state.rendering)
  const error = useSessionStore((state) => state.error)
  const mode = useSessionStore((state) => state.zoom)
  const setMode = useSessionStore((state) => state.setZoom)
  const plate = useSessionStore((state) => state.plate)
  const video = useSessionStore((state) => state.video)
  const fitMode = useDocumentStore((state) => state.document.fitMode)
  const docMode = useDocumentStore((state) => state.document.mode)
  // Plate giả định camera/pose CỐ ĐỊNH — đó chính là lý do nó render nhanh (WebGL dán video
  // lên MỘT ảnh Blender, không phải render lại mỗi khung). Ở chế độ video (Chức năng B),
  // camera/device/lighting đổi theo từng frame animation, nên plate không còn đúng nghĩa gì
  // — dùng nó ở đây là khoá cứng vào MỘT góc trong khi timeline đang đòi xoay chuyển liên
  // tục. Do đó plate CHỈ áp dụng ở chế độ tĩnh; ở chế độ video, màn hình luôn đi qua đường
  // render-mỗi-frame như ảnh tĩnh (video trên màn hình đóng băng ở khung đầu trong lúc
  // animation chạy — xem `VideoPanel`).
  const plateUsable = docMode !== 'video'
  const quality = useSessionStore((state) => state.previewQuality)
  const setQuality = useSessionStore((state) => state.setPreviewQuality)
  const playing = useSessionStore((state) => state.playing)
  const playbackCache = useSessionStore((state) => state.playbackCache)
  const playhead = useSessionStore((state) => state.playhead)

  // Đang phát lại thì vẽ từ dải ảnh ĐÃ GIỮ SẴN, không đổi `src` của `<img>`: đổi `src` 30
  // lần mỗi giây là 30 lần tải + giải mã, và khi không kịp thì `<img>` giữ nguyên ảnh cũ —
  // trông y như bị đứng ở một khung hình. Xem `playback-frames.ts`.
  const playbackImages =
    playing && playbackCache ? playbackFramesFor(playbackCache.signature) : null

  const [renderWidth, renderHeight] = PREVIEW_QUALITIES[quality].res

  // Plate gắn chặt vào MỘT bộ camera/pose/HDRI/màn hình; đổi bất cứ thứ gì trong đó là plate
  // tự bị vứt và canvas quay về preview tĩnh, nơi xoay/chỉnh chạy như bình thường.
  usePlateInvalidation()
  const { build, building } = useBuildPlate()

  const viewportRef = useRef<HTMLDivElement>(null)
  // Phần tử video do canvas SỞ HỮU, không phải bộ ghép: thanh điều khiển phải điều khiển được
  // nó cả lúc chưa có plate (đang chỉnh góc, canvas đang hiện ảnh tĩnh).
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [view, setView] = useState<ViewTransform>({ scale: 1, offset: { x: 0, y: 0 } })
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const lastSize = useRef<string | null>(null)

  /** Kích thước khung nhìn và ảnh, đọc từ DOM tại thời điểm dùng. */
  const measure = useCallback(() => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    const image = imageRef.current
    return {
      viewport: { width: viewport?.width ?? 0, height: viewport?.height ?? 0 },
      content: { width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 },
    }
  }, [])

  const resetTo = useCallback(
    (scale?: number) => {
      const { viewport, content } = measure()
      setView(centerView(viewport, content, scale ?? fitScale(viewport, content)))
    },
    [measure],
  )

  /**
   * Vào chế độ zoom thì bắt đầu từ đúng khung hình đang thấy, không nhảy hình.
   *
   * Làm trong handler của người dùng chứ không trong `useEffect`: đặt state đồng bộ trong
   * effect gây render dây chuyền (và lint chặn đúng chỗ này).
   */
  const changeMode = (next: 'fit' | 'zoom') => {
    if (next === 'zoom') resetTo()
    setMode(next)
  }

  // Con lăn phải là listener KHÔNG passive, nếu không `preventDefault()` bị bỏ qua và trang
  // cuộn theo thay vì canvas phóng to.
  useEffect(() => {
    const node = viewportRef.current
    if (!node || mode !== 'zoom') return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = node.getBoundingClientRect()
      const cursor = { x: event.clientX - box.left, y: event.clientY - box.top }
      setView((current) => zoomAt(current, wheelFactor(event.deltaY), cursor))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [mode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Không giành phím khi đang gõ số vào panel.
      if (event.target instanceof HTMLInputElement) return
      if (event.metaKey || event.ctrlKey) return

      if (event.key === 'f') return setMode('fit')
      if (mode !== 'zoom') return

      const { viewport } = measure()
      const centre = { x: viewport.width / 2, y: viewport.height / 2 }
      if (event.key === '+' || event.key === '=') {
        setView((current) => zoomAt(current, 1.25, centre))
      } else if (event.key === '-' || event.key === '_') {
        setView((current) => zoomAt(current, 0.8, centre))
      } else if (event.key === '0') {
        resetTo(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, setMode, measure, resetTo])

  const zooming = mode === 'zoom'

  return (
    // `min-h-0` + `minmax(0,1fr)` là bắt buộc: hàng grid mặc định `min-height: auto` nên KHÔNG
    // co được dưới chiều cao thật của ảnh, và `overflow-hidden` của cha sẽ CẮT ảnh thay vì thu
    // nhỏ nó. Đã sập đúng lỗi này ở Pha 4.5.
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="h-header bg-card flex shrink-0 items-center gap-2 border-b px-2">
        <Segmented
          label="View mode"
          options={MODES}
          value={mode}
          onChange={changeMode}
          variant="fit"
        />

        {zooming ? (
          <span className="text-value tabular text-muted-foreground" data-testid="zoom-level">
            {Math.round(view.scale * 100)}%
          </span>
        ) : null}

        <Segmented
          label="Preview quality"
          options={QUALITIES}
          value={quality}
          onChange={setQuality}
          variant="fit"
          // Đang xem plate thì mức nét của preview KHÔNG còn tác dụng: ảnh trên canvas do
          // plate quyết định, và plate đã render xong ở độ phân giải của chính nó. Để nút
          // bấm được mà không đổi gì là mời người dùng đi tìm một khác biệt không tồn tại.
          disabled={plate !== null && plateUsable}
          disabledHint="Preview quality applies to the still preview only. Rebuild the plate to change its resolution."
        />
        <span
          className="text-value tabular text-muted-foreground"
          // Chi phí đo thật, để chọn mức là quyết định có thông tin chứ không phải đoán.
          title="Actual rendering time (EEVEE, warm worker): low 134ms · med 239ms · high 485ms · max 1287ms"
        >
          {renderWidth}×{renderHeight} · {PREVIEW_QUALITIES[quality].samples} spp
        </span>

        <span className="bg-draft-badge text-helper text-background px-1 font-semibold tracking-wide uppercase">
          draft · no shadows
        </span>

        <span className="ml-auto flex items-center gap-2">
          {zooming ? (
            <span className="text-helper text-muted-foreground">
              scroll to zoom · drag to pan · +/− /0 · F to fit
            </span>
          ) : null}
          {rendering ? (
            <span
              data-testid="rendering-indicator"
              className="text-value tabular text-muted-foreground flex items-center gap-1"
            >
              <Loader2 className="size-3 animate-spin" />
              rendering
            </span>
          ) : null}
        </span>
      </div>

      <CheckerCanvas
        ref={viewportRef}
        className={cn(
          'grid h-full min-h-0 place-items-center',
          zooming && 'cursor-grab active:cursor-grabbing',
        )}
        {...(zooming
          ? {
              onPointerDown: (event: React.PointerEvent) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                }
              },
              onPointerMove: (event: React.PointerEvent) => {
                const state = drag.current
                if (!state || state.pointerId !== event.pointerId) return
                setView((current) =>
                  panBy(current, event.clientX - state.x, event.clientY - state.y),
                )
                drag.current = { ...state, x: event.clientX, y: event.clientY }
              },
              onPointerUp: () => {
                drag.current = null
              },
              onDoubleClick: () => resetTo(),
            }
          : {})}
      >
        {video && plateUsable ? (
          // Phần tử video do CANVAS sở hữu, không phải bộ ghép: thanh điều khiển phải điều
          // khiển được nó cả lúc chưa có plate.
          //
          // KHÔNG dùng `display: none`: Chrome bóp nghẹt việc trình khung của video bị ẩn hẳn
          // và `requestVideoFrameCallback` gần như không bắn — canvas sẽ đứng im ở khung đầu.
          //
          // Chỉ mount ở chế độ TĨNH: ở chế độ video, plate không dùng được (xem `plateUsable`)
          // nên không có gì để phần tử này phục vụ — mount nó chỉ để tự phát nhạc nền vô ích.
          <video
            ref={setVideoElement}
            src={apiUrl(video.url)}
            className="pointer-events-none absolute top-0 left-0 size-px opacity-0"
            muted
            loop
            playsInline
            crossOrigin="anonymous"
            aria-hidden
          />
        ) : null}

        {plate && video && plateUsable ? (
          // Đường video: Blender render plate một lần, WebGL dán từng khung hình lên. Ảnh
          // tĩnh phía dưới vẫn giữ nguyên đường cũ — hai đường này khác nhau ở tận gốc.
          <VideoComposite
            manifest={plate}
            video={videoElement}
            source={{ width: video.width, height: video.height }}
            fitMode={fitMode}
          />
        ) : playbackImages ? (
          <PlaybackFrame
            images={playbackImages}
            frame={playhead}
            onSizeChange={() => {
              if (mode === 'zoom') resetTo()
            }}
            className={cn(
              'select-none',
              // Dùng ĐÚNG bộ class của thẻ ảnh preview tĩnh — xem ghi chú dài ở dưới về
              // vì sao phải `absolute`.
              !zooming &&
                'absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] object-contain',
            )}
            style={
              zooming
                ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transformOrigin: '0 0',
                    transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${clampScale(view.scale)})`,
                    imageRendering: view.scale >= 2 ? 'pixelated' : 'auto',
                  }
                : undefined
            }
          />
        ) : preview ? (
          <img
            ref={imageRef}
            src={apiUrl(preview.url)}
            alt="Preview mockup"
            onLoad={(event) => {
              // Ảnh mới về sau mỗi lần kéo slider. Recentre ở đây thì zoom của người dùng bị
              // reset liên tục — chỉ recentre khi KÍCH THƯỚC đổi (tức là đổi mức độ nét).
              const { naturalWidth, naturalHeight } = event.currentTarget
              const key = `${naturalWidth}×${naturalHeight}`
              if (lastSize.current === key) return
              lastSize.current = key
              if (mode === 'zoom') resetTo()
            }}
            className={cn(
              'transition-opacity select-none',
              // Fit: khung của ảnh phải bằng ĐÚNG khung nhìn, kích thước hiện lên do
              // `object-contain` quyết định — nhờ vậy nó chỉ phụ thuộc khung nhìn, KHÔNG
              // phụ thuộc số pixel của ảnh, nên đổi mức độ nét không làm mockup to nhỏ.
              //
              // Phải `absolute` mới chắc: `h-full` thường (phần trăm) cần chiều cao cha là
              // XÁC ĐỊNH, mà chuỗi cha ở đây toàn phần trăm/`1fr` nên Chrome thả nó về
              // `auto` và ảnh quay ra lấy chiều theo pixel gốc. Đo trong Chrome 150, khung
              // nhìn 800×568, cùng tỉ lệ 3:4:
              //   h-full w-auto  : ảnh 360×480 -> 414×552 ✓ | ảnh 1080×1440 -> 784×1045 ✗
              //   absolute inset : cả hai      -> 784×552 ✓
              // Với `absolute` thì cả hai chiều lấy từ containing block nên luôn xác định.
              // `inset-2` thay cho `p-2` của khung: phần trăm của con absolute tính theo
              // padding box nên đặt padding ở cha sẽ KHÔNG có tác dụng.
              !zooming &&
                'absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] object-contain',
              rendering && 'opacity-60',
            )}
            style={
              zooming
                ? {
                    // Zoom: ảnh ở kích thước pixel gốc, đặt bằng transform để phóng/kéo không
                    // gây reflow — `transform` chạy trên GPU, đổi width/height thì không.
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    transformOrigin: '0 0',
                    transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${clampScale(view.scale)})`,
                    imageRendering: view.scale >= 2 ? 'pixelated' : 'auto',
                  }
                : undefined
            }
            draggable={false}
          />
        ) : (
          <p className="text-ui text-muted-foreground">
            {error ? 'Không render được' : 'Đang dựng preview đầu tiên…'}
          </p>
        )}
        {video && plateUsable ? (
          <VideoTransport
            video={videoElement}
            onBuildPlate={() => void build()}
            building={building}
          />
        ) : null}
      </CheckerCanvas>
    </div>
  )
}
