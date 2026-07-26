import { Check, Copy, Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { apiUrl, trpc } from '@/shared/api/trpc'
import { connectEvents } from '@/shared/api/ws'
import { Button } from '@/shared/ui/button'
import { PanelSection } from '@/shared/ui/panel-section'
import { Segmented } from '@/shared/ui/segmented'
import { SliderRow } from '@/shared/ui/slider-row'

import { VideoExport } from './video-export'

/** Trạng thái job như server báo về. Giữ nguyên tên field để không phải dịch qua lại. */
interface JobInfo {
  id: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  progress: { sample: number; totalSamples: number; fraction: number }
  output?: string
  error?: string
  ms?: number
}

const BACKGROUNDS = [
  { value: 'alpha' as const, label: 'Alpha' },
  { value: 'solid' as const, label: 'Solid' },
]

const SCALES = [
  { value: '1' as const, label: '1×' },
  { value: '2' as const, label: '2×' },
  { value: '4' as const, label: '4×' },
]

const ENGINES = [
  { value: 'cycles' as const, label: 'Cycles' },
  { value: 'eevee' as const, label: 'EEVEE' },
]

const BASE_RESOLUTION = [1080, 1440] as const

/**
 * Panel export ảnh.
 *
 * Render final đi qua tiến trình RIÊNG nên panel này chỉ theo dõi: nhận `jobId`, nghe
 * WebSocket, và huỷ được. Nếu chờ đồng bộ thì một bản Cycles 28 phút sẽ timeout HTTP và
 * mất kết quả dù Blender vẫn render xong.
 */
export function ExportPanel() {
  const document = useDocumentStore((state) => state.document)
  const video = useSessionStore((state) => state.video)
  const [background, setBackground] = useState<'alpha' | 'solid'>('alpha')
  const [color, setColor] = useState('#111111')
  const [scale, setScale] = useState<'1' | '2' | '4'>('1')
  const [engine, setEngine] = useState<'cycles' | 'eevee'>('cycles')
  const [samples, setSamples] = useState(128)
  const [job, setJob] = useState<JobInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    return connectEvents((event) => {
      if (event.event !== 'render-update') return
      const info = event.payload as JobInfo
      // Chỉ nhận cập nhật của job mình vừa đặt: hai tab mở cùng lúc sẽ thấy cả job của
      // nhau và thanh tiến trình sẽ nhảy qua lại.
      setJob((current) => (current && info.id !== current.id ? current : info))
    })
  }, [])

  const running = job?.state === 'running'
  const width = BASE_RESOLUTION[0] * Number(scale)
  const height = BASE_RESOLUTION[1] * Number(scale)

  async function start() {
    setError(null)
    try {
      const result = await trpc.exportStill.mutate({
        camera: document.camera,
        pose: document.pose,
        world: document.world,
        screen: document.screen,
        engine,
        samples,
        scale: Number(scale) as 1 | 2 | 4,
        background: background === 'solid' ? color : null,
        name: 'mockup',
      })
      setJob({
        id: result.jobId,
        state: 'running',
        progress: { sample: 0, totalSamples: 0, fraction: 0 },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function cancel() {
    if (!job) return
    await trpc.cancelRender.mutate({ jobId: job.id })
  }

  /**
   * Tải file về máy. Không dùng `<a download>` được: ảnh nằm ở origin khác (API server),
   * trình duyệt bỏ qua thuộc tính `download` cross-origin và điều hướng thẳng sang ảnh.
   * Nên phải fetch thành blob rồi tạo object URL cùng origin.
   */
  async function download(output: string) {
    setError(null)
    try {
      const response = await fetch(apiUrl(`/${output}`))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = output.split('/').at(-1) ?? 'mockup.png'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function copy(output: string) {
    setError(null)
    try {
      const response = await fetch(apiUrl(`/${output}`))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      // Clipboard chỉ nhận image/png; blob từ server có thể mang type khác/rỗng nên ép lại.
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob.type === 'image/png' ? blob : blob.slice(0, blob.size, 'image/png'),
        }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // Import ảnh thì export ảnh, import video thì export video. Trộn hai bộ tuỳ chọn vào một
  // màn hình sẽ khiến người dùng chọn phải thứ không áp dụng cho thứ mình đang làm.
  if (video) {
    return (
      <PanelSection title="Export video">
        <VideoExport video={video} />
      </PanelSection>
    )
  }

  return (
    <PanelSection title="Export">
      <div className="bg-input grid gap-1 p-1">
        <Segmented
          label="Background"
          options={BACKGROUNDS}
          value={background}
          onChange={setBackground}
        />
        {background === 'solid' ? (
          <div className="h-control flex items-center gap-2 px-1">
            <input
              type="color"
              aria-label="Background color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-4 w-8 border bg-transparent"
            />
            <span className="text-value tabular text-muted-foreground">{color}</span>
          </div>
        ) : null}
        <Segmented label="Scale" options={SCALES} value={scale} onChange={setScale} />
        <Segmented label="Engine" options={ENGINES} value={engine} onChange={setEngine} />
      </div>

      <SliderRow
        label="Samples"
        value={samples}
        min={1}
        max={512}
        step={1}
        defaultValue={128}
        onChange={setSamples}
      />

      <p className="text-helper text-muted-foreground px-2">
        {width}×{height}
        {engine === 'cycles'
          ? ' · contact shadows enabled'
          : ' · EEVEE Next lacks shadow catcher, NO shadows will be rendered'}
      </p>

      <div className="flex gap-px pt-1">
        <Button className="flex-1" onClick={() => void start()} disabled={running}>
          <Download className="size-3" />
          Render
        </Button>
        {running ? (
          <Button variant="outline" onClick={() => void cancel()}>
            <X className="size-3" />
            Cancel
          </Button>
        ) : null}
      </div>

      {job ? (
        <div className="grid gap-1 px-2 pt-1" data-testid="job-status">
          <div className="bg-secondary h-0.5 overflow-hidden">
            <div
              className="bg-primary h-full transition-[width]"
              style={{ width: `${Math.round(job.progress.fraction * 100)}%` }}
            />
          </div>
          <p className="text-value tabular text-muted-foreground">
            {job.state === 'running'
              ? `rendering ${job.progress.sample}/${job.progress.totalSamples || '?'} samples`
              : job.state === 'done'
                ? `done in ${((job.ms ?? 0) / 1000).toFixed(1)}s`
                : job.state === 'cancelled'
                  ? 'cancelled'
                  : `failed: ${job.error?.split('\n').at(-2) ?? ''}`}
          </p>
          {job.state === 'done' && job.output ? (
            <div className="flex gap-px pt-1">
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => void download(job.output!)}
              >
                <Download className="size-3" />
                Download
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => void copy(job.output!)}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-helper text-destructive px-2">
          {error}
        </p>
      ) : null}
    </PanelSection>
  )
}
