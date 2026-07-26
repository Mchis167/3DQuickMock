import { Clapperboard, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { PLACEHOLDER_SCREEN } from '@/entities/scene-config/document'
import { FIT_MODES, type FitMode } from '@/entities/screen-fit'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

import { extractFirstFrame } from './first-frame'
import { API_BASE, trpc } from '@/shared/api/trpc'
import { cn } from '@/shared/lib/cn'
import { PanelSection } from '@/shared/ui/panel-section'
import { Segmented } from '@/shared/ui/segmented'

/**
 * Import video vào màn hình.
 *
 * Video KHÔNG đi qua Blender như ảnh tĩnh. Blender render một **plate** cho đúng góc đang
 * chọn, rồi WebGL dán từng khung hình lên plate đó ở client. Vì thế panel này có hai bước
 * tách bạch, và người dùng phải thấy rõ cả hai:
 *
 *   1. chọn video  — rẻ, tức thì
 *   2. dựng plate  — đắt (Cycles, hàng chục giây), và **hết hiệu lực khi đổi góc**
 *
 * Gộp hai bước làm một sẽ khiến mỗi lần nhích slider góc lại kích hoạt một render Cycles.
 */

const MODE_LABELS: Record<FitMode, string> = {
  fill: 'Fill',
  fit: 'Fit',
  stretch: 'Stretch',
}

/**
 * Giải thích riêng cho video, không dùng lại của ảnh: video thường 16:9 nằm ngang còn màn hình
 * 19.5:9 dựng đứng, nên `stretch` méo nặng hơn hẳn so với ảnh chụp màn hình.
 */
const MODE_HINTS: Record<FitMode, string> = {
  fill: 'Zoom to fill screen, crop excess. No distortion.',
  fit: 'Show the whole frame, add black bars.',
  stretch: 'Stretch to fit. 16:9 footage will be heavily distorted.',
}

const MODE_OPTIONS = FIT_MODES.map((value) => ({ value, label: MODE_LABELS[value] }))

export function VideoPanel() {
  const doc = useDocumentStore((state) => state.document)
  const setScreen = useDocumentStore((state) => state.setScreen)
  const video = useSessionStore((state) => state.video)
  const setVideo = useSessionStore((state) => state.setVideo)
  const [busy, setBusy] = useState<null | 'upload'>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function send(body: BodyInit, extension: string): Promise<string> {
    const response = await fetch(`${API_BASE}/upload?ext=${encodeURIComponent(extension)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    })
    if (!response.ok) throw new Error(`upload thất bại: ${response.status}`)
    return ((await response.json()) as { asset: string }).asset
  }

  /**
   * Import video, và dán ngay KHUNG ĐẦU TIÊN lên màn hình như một ảnh tĩnh.
   *
   * Đây là điểm mấu chốt của luồng: plate mất hàng chục giây và nó đóng băng mockup vào một
   * góc. Nếu không có khung đầu thì người dùng phải dựng plate TRƯỚC khi biết mình muốn góc
   * nào — trả giá đắt cho một quyết định chưa hình thành. Có nó rồi thì mọi thứ chạy đúng
   * đường cũ: xoay máy, kéo slider, preview Blender cập nhật trong ~250ms; dựng plate chỉ là
   * bước cuối khi góc đã chốt.
   */
  /**
   * Đổi chế độ khớp tỉ lệ. Phải áp lại cho KHUNG ĐẦU nữa, không chỉ cho video: khung đầu là
   * một ảnh tĩnh đã khớp sẵn ở server, giữ nguyên nó thì preview tĩnh và preview video sẽ
   * hiện hai khung hình khác nhau cho cùng một lựa chọn.
   */
  async function changeMode(mode: FitMode) {
    if (!doc.screenSource) {
      setScreen({ screen: doc.screen, mode })
      return
    }
    setBusy('upload')
    setError(null)
    try {
      const prepared = await trpc.prepareScreen.mutate({ asset: doc.screenSource, mode })
      setScreen({ screen: prepared.screen, source: doc.screenSource, mode })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function importFile(file: File) {
    setBusy('upload')
    setError(null)
    try {
      const frame = await extractFirstFrame(file)
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
      const [videoAsset, frameAsset] = await Promise.all([
        send(file, extension ?? 'mp4'),
        send(frame.blob, 'png'),
      ])
      // Khung đầu đi qua đúng đường của ảnh tĩnh, nên ba chế độ khớp tỉ lệ vẫn áp bình thường.
      const prepared = await trpc.prepareScreen.mutate({
        asset: frameAsset,
        mode: doc.fitMode,
      })
      setScreen({ screen: prepared.screen, source: frameAsset, mode: doc.fitMode })
      // Đặt video là VỨT plate cũ: plate gắn chặt vào một bộ góc và một ảnh màn hình.
      setVideo({ url: `/${videoAsset}`, width: frame.width, height: frame.height })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PanelSection title="Video">
      {video ? null : (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) void importFile(file)
          }}
          className={cn(
            'flex h-16 flex-col items-center justify-center gap-1 transition-colors',
            dragging ? 'border-primary bg-primary/10' : 'border-border bg-input',
          )}
        >
          <Clapperboard className="text-muted-foreground size-3.5" />
          <p className="text-helper text-muted-foreground">
            Drag video here or{' '}
            <button
              type="button"
              className="text-foreground underline"
              onClick={() => inputRef.current?.click()}
            >
              choose file
            </button>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            aria-label="Choose video"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
            }}
          />
        </div>
      )}

      {video ? (
        <>
          <p className="h-row text-value tabular flex items-center gap-1 px-2">
            <span className="text-muted-foreground">
              {video.width}×{video.height}
            </span>
            <button
              type="button"
              aria-label="Remove video"
              className="text-muted-foreground hover:text-foreground ml-auto"
              onClick={() => {
                // Xoá video là trả màn hình về ảnh mặc định: khung đầu của video đang nằm
                // trên đó, giữ lại thì người dùng không biết mình đã xoá được hay chưa.
                setVideo(null)
                setScreen({ screen: PLACEHOLDER_SCREEN, source: null, mode: doc.fitMode })
              }}
            >
              <X className="size-3" />
            </button>
          </p>

          {doc.mode === 'video' ? (
            // Ở chế độ video KHÔNG dùng plate: plate khoá cứng vào một góc camera nên nó vô
            // dụng khi device đang xoay. Thay vào đó video được trích thành dải PNG và Blender
            // dán từng khung theo frame — nên nút "build plate" bị ẩn khỏi canvas, và người
            // dùng cần biết thay vào đó phải kéo thanh Screen trên timeline.
            <p className="text-helper text-muted-foreground px-2">
              video plays on the screen while the device animates · drag the Screen bar on the
              timeline to set where it starts
            </p>
          ) : (
            <p className="text-helper text-muted-foreground px-2">
              {/* Nút dựng plate nằm ở đáy canvas, cạnh mockup — đó là lúc người dùng vừa
                  chỉnh xong góc và đang nhìn thẳng vào kết quả. */}
              first frame is on the screen now · adjust the angle, then build the plate below
              the canvas to play video
            </p>
          )}
        </>
      ) : null}

      {video ? (
        <>
          {/* Áp cho CẢ khung đầu (ảnh tĩnh, khớp ở server) lẫn video (khớp trong shader).
              Hai đường khác nhau về cách làm nhưng cùng một hàm thuần quyết định khung hình. */}
          <Segmented
            label="Scale mode"
            options={MODE_OPTIONS}
            value={doc.fitMode}
            onChange={(mode) => void changeMode(mode)}
          />
          <p className="text-helper text-muted-foreground px-2">{MODE_HINTS[doc.fitMode]}</p>
        </>
      ) : null}

      {busy === 'upload' ? (
        <p className="text-helper text-muted-foreground px-2">uploading…</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-helper text-destructive px-2">
          {error}
        </p>
      ) : null}
    </PanelSection>
  )
}
