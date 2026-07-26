import { Download, Film } from 'lucide-react'
import { useState } from 'react'

import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { apiUrl, trpc } from '@/shared/api/trpc'
import { Button } from '@/shared/ui/button'
import { Segmented } from '@/shared/ui/segmented'

/**
 * Export video — chỉ hiện khi đang ở đường video.
 *
 * Đường này KHÔNG render lại 3D theo từng khung: thiết bị đứng yên nên plate đã render sẵn,
 * Chrome headless chạy ĐÚNG shader của preview để ghép từng khung, ffmpeg chỉ mã hoá. Nhờ vậy
 * file xuất ra trùng với thứ đang xem — theo cấu trúc, không phải theo một phép đo.
 *
 * Phải có plate trước: không có nó thì chưa có gì để ghép lên, và bản thân việc dựng plate là
 * lúc người dùng chốt góc.
 */

const SCALES = [
  { value: '1' as const, label: '1×' },
  { value: '2' as const, label: '2×' },
  { value: '4' as const, label: '4×' },
]

const CONTAINERS = [
  { value: 'mov' as const, label: 'MOV' },
  { value: 'webm' as const, label: 'WebM' },
  { value: 'mp4' as const, label: 'MP4' },
]

/** Chỉ `mp4` làm mất alpha. Người dùng phải biết TRƯỚC khi ngồi đợi export xong. */
const ALPHA_NOTE: Record<string, string> = {
  mov: 'ProRes 4444 · keeps alpha',
  webm: 'VP9 · keeps alpha',
  mp4: 'H.264 · NO alpha, transparent background becomes black',
}

export function VideoExport({
  video,
}: {
  video: { url: string; width: number; height: number }
}) {
  const plate = useSessionStore((state) => state.plate)
  const doc = useDocumentStore((state) => state.document)
  const [container, setContainer] = useState<'mov' | 'mp4' | 'webm'>('mov')
  const [scale, setScale] = useState<'1' | '2' | '4'>('1')
  const [fps, setFps] = useState(30)
  const [seconds, setSeconds] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<{
    url: string
    ms: number
    bytes: number
    res: [number, number]
  } | null>(null)

  const frames = Math.max(1, Math.round(fps * seconds))

  async function render() {
    if (!plate) return
    setBusy(true)
    setError(null)
    setOutput(null)
    try {
      const result = await trpc.exportVideo.mutate({
        // Gửi CẤU HÌNH, không gửi plate của preview: plate preview là bản nháp độ phân giải
        // thấp. Cấu hình này chắc chắn khớp thứ đang xem — plate tự bị vứt ngay khi bất cứ
        // trường nào trong đó đổi, nên còn nút để bấm nghĩa là còn khớp.
        camera: doc.camera,
        pose: doc.pose,
        world: doc.world,
        screen: doc.screen,
        scale: Number(scale) as 1 | 2 | 4,
        video: video.url,
        // Kích thước và chế độ khớp đi kèm: server tính phép khớp bằng đúng hàm thuần mà
        // preview dùng, nên bản xuất ra không thể khung khác bản đang xem.
        source: { width: video.width, height: video.height },
        fitMode: doc.fitMode,
        fps,
        frames,
        name: 'mockup',
        container,
      })
      setOutput({
        url: `/${result.output}`,
        ms: result.ms + result.plateMs,
        bytes: result.bytes,
        res: result.res,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function download(url: string) {
    // Không dùng `<a download>`: file nằm ở origin của API server, trình duyệt bỏ qua thuộc
    // tính `download` cross-origin và điều hướng thẳng sang file.
    const response = await fetch(apiUrl(url))
    if (!response.ok) {
      setError(`HTTP ${response.status}`)
      return
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = objectUrl
    anchor.download = url.split('/').at(-1) ?? 'mockup.mov'
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }

  if (!plate) {
    return (
      <p className="text-helper text-muted-foreground px-2">
        Build the plate first — the button is below the canvas.
      </p>
    )
  }

  return (
    <>
      {/* Độ nét của bản xuất do PLATE quyết định, không phải do video: thân máy, kính và bóng
          đổ đều nằm trong plate. Nên ×2/×4 nghĩa là render lại plate ở độ phân giải đó. */}
      <Segmented label="Scale" options={SCALES} value={scale} onChange={setScale} />

      <Segmented
        label="Container"
        options={CONTAINERS}
        value={container}
        onChange={setContainer}
      />
      <p className="text-helper text-muted-foreground px-2">{ALPHA_NOTE[container]}</p>

      <div className="bg-input grid gap-1 p-1">
        <label className="h-row text-label flex items-center gap-2 px-1">
          <span className="text-muted-foreground w-16">Frame rate</span>
          <input
            type="number"
            aria-label="Frame rate"
            min={1}
            max={120}
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
            className="text-value tabular bg-card w-16 border px-1"
          />
        </label>
        <label className="h-row text-label flex items-center gap-2 px-1">
          <span className="text-muted-foreground w-16">Duration</span>
          <input
            type="number"
            aria-label="Duration in seconds"
            min={0.1}
            step={0.1}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
            className="text-value tabular bg-card w-16 border px-1"
          />
          <span className="text-helper text-muted-foreground">s</span>
        </label>
      </div>

      <p className="text-helper text-muted-foreground px-2">
        {1080 * Number(scale)}×{1440 * Number(scale)} · {frames} frames · device rendered once
        at export resolution, then only the screen changes per frame
        {scale === '4' ? ' · 4× is a heavy Cycles render' : ''}
      </p>

      <Button className="w-full" onClick={() => void render()} disabled={busy}>
        <Film className="size-3" />
        {busy ? 'rendering…' : 'Render video'}
      </Button>

      {output ? (
        <div className="grid gap-1 px-2 pt-1" data-testid="video-output">
          <p className="text-value tabular text-muted-foreground">
            {output.res[0]}×{output.res[1]} · done in {(output.ms / 1000).toFixed(1)}s ·{' '}
            {(output.bytes / 1e6).toFixed(1)} MB
          </p>
          <Button variant="outline" onClick={() => void download(output.url)}>
            <Download className="size-3" />
            Download
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-helper text-destructive px-2">
          {error}
        </p>
      ) : null}
    </>
  )
}
