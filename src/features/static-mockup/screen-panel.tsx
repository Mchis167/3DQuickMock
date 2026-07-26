import { Image as ImageIcon, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { PLACEHOLDER_SCREEN } from '@/entities/scene-config/document'
import { useDocumentStore } from '@/entities/scene-config/store'
import { FIT_MODES, type FitMode } from '@/entities/screen-fit'
import { API_BASE, trpc } from '@/shared/api/trpc'
import { cn } from '@/shared/lib/cn'
import { PanelSection } from '@/shared/ui/panel-section'
import { Segmented } from '@/shared/ui/segmented'

const MODE_LABELS: Record<FitMode, string> = {
  fill: 'Fill',
  fit: 'Fit',
  stretch: 'Stretch',
}

/** Giải thích dài để trong tooltip, không chiếm chỗ trên nhãn. */
const MODE_HINTS: Record<FitMode, string> = {
  fill: 'Zoom to fill screen, crop excess. No distortion.',
  fit: 'Show entire image, add black bars.',
  stretch: 'Stretch to fit. 16:9 content will be heavily distorted.',
}

const MODE_OPTIONS = FIT_MODES.map((value) => ({ value, label: MODE_LABELS[value] }))

interface FitInfo {
  source: { width: number; height: number }
  cropped: boolean
  letterboxed: boolean
  distorted: boolean
}

/**
 * Import ảnh vào màn hình + chọn chế độ khớp tỉ lệ.
 *
 * Chế độ được hỏi ngay tại đây, không mặc định im lặng: màn hình 19.5:9 còn ảnh chụp/video
 * thường 16:9, nên `stretch` méo rất rõ (App_Feature_Spec §2). Cảnh báo hiện ngay sau khi
 * import, trước khi người dùng đi render.
 */
export function ScreenPanel() {
  const document = useDocumentStore((state) => state.document)
  const setScreen = useDocumentStore((state) => state.setScreen)
  const [info, setInfo] = useState<FitInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function applyMode(asset: string, mode: FitMode) {
    const result = await trpc.prepareScreen.mutate({ asset, mode })
    setScreen({ screen: result.screen, source: asset, mode })
    setInfo({
      source: result.source,
      cropped: result.cropped,
      letterboxed: result.letterboxed,
      distorted: result.distorted,
    })
  }

  async function importFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'png'
      const response = await fetch(
        `${API_BASE}/upload?ext=${encodeURIComponent(extension ?? 'png')}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        },
      )
      if (!response.ok) throw new Error(`upload failed: ${response.status}`)
      const { asset } = (await response.json()) as { asset: string }
      await applyMode(asset, document.fitMode)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function changeMode(mode: FitMode) {
    if (!document.screenSource) {
      // Chưa import gì thì chỉ ghi nhớ lựa chọn, không gọi server.
      setScreen({ screen: document.screen, mode })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await applyMode(document.screenSource, mode)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /** Xoá ảnh đã import: màn hình quay về ảnh mặc định, khung kéo-thả hiện lại. */
  function clear() {
    setScreen({ screen: PLACEHOLDER_SCREEN, source: null, mode: document.fitMode })
    setInfo(null)
    setError(null)
  }

  return (
    <PanelSection title="Screen">
      {info ? null : (
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
          <ImageIcon className="text-muted-foreground size-3.5" />
          <p className="text-helper text-muted-foreground">
            Drag image here or{' '}
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
            accept="image/*"
            aria-label="Choose screen image"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
            }}
          />
        </div>
      )}

      <Segmented
        label="Scale mode"
        options={MODE_OPTIONS}
        value={document.fitMode}
        onChange={(mode) => void changeMode(mode)}
      />
      <p className="text-helper text-muted-foreground px-2">{MODE_HINTS[document.fitMode]}</p>

      {busy ? (
        <p className="text-helper text-muted-foreground px-2">processing image…</p>
      ) : null}

      {info ? (
        <p
          className="h-row text-value tabular flex items-center gap-1 px-2"
          data-testid="fit-info"
        >
          <span className="text-muted-foreground">
            {info.source.width}×{info.source.height}
          </span>
          {info.cropped ? <span className="text-muted-foreground">· cropped</span> : null}
          {info.letterboxed ? (
            <span className="text-muted-foreground">· letterboxed</span>
          ) : null}
          {info.distorted ? <span className="text-draft-badge">· distorted</span> : null}
          <button
            type="button"
            aria-label="Remove image"
            className="text-muted-foreground hover:text-foreground ml-auto"
            onClick={clear}
          >
            <X className="size-3" />
          </button>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-helper text-destructive px-2">
          {error}
        </p>
      ) : null}
    </PanelSection>
  )
}
