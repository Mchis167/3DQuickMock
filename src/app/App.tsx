import { Film, Image as ImageIcon, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore, type InspectorTab } from '@/entities/session'
import { EnvironmentPanel } from '@/features/environment'
import { ExportPanel } from '@/features/export'
import {
  AnglePanel,
  FramingPanel,
  GroundPanel,
  PreviewCanvas,
  ImportTab,
  usePreview,
} from '@/features/static-mockup'
import {
  KeyframeInspector,
  LayerSwitch,
  NewVideoDialog,
  TimelinePanel,
  useAutoKey,
  useCurveSample,
  useScreenSequence,
  VideoSettingsPanel,
} from '@/features/video-editor'
import { Button } from '@/shared/ui/button'
import { Tabs } from '@/shared/ui/tabs'
import { cn } from '@/shared/lib/cn'

import { AppStatusBar } from './app-status-bar'

/**
 * Tab theo đúng thứ tự workflow: import ảnh → chỉnh → (video) → export.
 *
 * Mỗi lúc chỉ một tab hiện. Trước Pha 4.5 cả sáu section mở cùng lúc, ~990px trong cột
 * 320px — luôn phải cuộn và không có gì nói cho mắt biết đâu là thứ đang cần.
 *
 * `video` (fps/thời lượng/tỉ lệ) TÁCH RIÊNG khỏi `control` (Device/Camera/Lighting): hai
 * thứ không cùng mental model — đổi layer trong Control không đổi cấu hình video, và
 * nhét chung khiến người dùng tưởng chúng đi cùng nhau.
 */
const STATIC_TABS: readonly { value: InspectorTab; label: string }[] = [
  { value: 'import', label: 'Import' },
  { value: 'control', label: 'Control' },
  { value: 'export', label: 'Export' },
]

const VIDEO_TABS: readonly { value: InspectorTab; label: string }[] = [
  { value: 'import', label: 'Import' },
  { value: 'control', label: 'Control' },
  { value: 'video', label: 'Video' },
  { value: 'export', label: 'Export' },
]

interface HeaderTabProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  title: string
  ariaLabel: string
}

function HeaderTab({ active, onClick, icon, label, title, ariaLabel }: HeaderTabProps) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      className={cn(
        'relative h-full gap-1.5 rounded-none px-4 text-ui font-medium transition-colors border-r',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {active && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />}
    </Button>
  )
}

/** Shell: ráp các panel lại và chạy vòng lặp preview. Không chứa logic nghiệp vụ. */
export function App() {
  usePreview()
  useCurveSample()
  // Auto-key cần biết đang đứng ở frame nào; đây là chỗ chuyển tay duy nhất từ uiStore
  // sang documentStore, xem `use-auto-key.ts`.
  useAutoKey()
  // Trích video thành dải PNG khi vào chế độ video: đây là cách màn hình phát video TRONG
  // LÚC device animate, thay cho plate (plate khoá cứng một góc camera).
  useScreenSequence()

  const undo = useDocumentStore((state) => state.undo)
  const redo = useDocumentStore((state) => state.redo)
  const canUndo = useDocumentStore((state) => state.canUndo)
  const canRedo = useDocumentStore((state) => state.canRedo)
  const tab = useSessionStore((state) => state.tab)
  const setTab = useSessionStore((state) => state.setTab)
  const mode = useDocumentStore((state) => state.document.mode)
  const setMode = useDocumentStore((state) => state.setMode)
  const [newVideoOpen, setNewVideoOpen] = useState(false)
  const video = mode === 'video'
  const videoLayer = useSessionStore((state) => state.videoLayer)
  const selectedKeyframe = useSessionStore((state) => state.selectedKeyframe)

  // Rời chế độ video mà đang đứng ở tab Video (nó không tồn tại ở chế độ tĩnh) thì về
  // Control — không để tab trỏ vào một thứ vừa biến mất.
  useEffect(() => {
    if (!video && tab === 'video') setTab('control')
  }, [video, tab, setTab])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      // Ctrl+Z hoàn tác THAO TÁC, không đóng panel — vì thế uiStore nằm ngoài lịch sử
      // (Architecture.md §6).
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[auto_1fr_auto]">
      <header className="h-header bg-card flex shrink-0 items-center border-b pr-2">
        <div className="flex h-full items-center">
          <HeaderTab
            active={!video}
            onClick={() => setMode('static')}
            icon={<ImageIcon className="size-3.5" />}
            label="Static"
            title="Mockup tĩnh — xuất ảnh, hoặc video phát trên màn hình máy"
            ariaLabel="Static mockup"
          />
          <HeaderTab
            active={video}
            onClick={() => (video ? undefined : setNewVideoOpen(true))}
            icon={<Film className="size-3.5" />}
            label="Video"
            title="Mockup động — camera và máy chuyển động theo keyframe"
            ariaLabel="Video mockup"
          />
        </div>

        <div className="ml-auto flex items-center gap-px">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            title="⌘Z"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo"
            title="⌘⇧Z"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 className="size-3" />
          </Button>
        </div>
      </header>

      {/* `minmax(0,1fr)` thay `1fr`: cột grid mặc định không co được dưới nội dung, và khi
          đó `overflow-hidden` cắt ảnh thay vì thu nhỏ nó. */}
      <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--spacing-inspector)] overflow-hidden">
        {/* Timeline nằm dưới canvas, trong cùng cột: nó nói về trục thời gian của cảnh,
            không phải thuộc tính của thứ đang chọn. */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
          <PreviewCanvas />
          {video ? <TimelinePanel /> : null}
        </div>

        {/* Hàng thứ ba (`auto`) là panel Keyframe — nó KHÔNG thuộc tab nào. Chọn một
            keyframe trên timeline thì panel này hiện ra BẤT KỂ đang mở tab gì; tap ra khỏi
            keyframe (nền track, thước thời gian) thì tự deselect và panel biến mất. Nhét nó
            vào bên trong tab Control từng khiến người dùng tưởng đổi layer/tab sẽ đổi luôn
            trạng thái chọn keyframe — hai mental model khác nhau, tách hẳn cho rõ. */}
        <aside className="bg-card grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l">
          <Tabs
            tabs={video ? VIDEO_TABS : STATIC_TABS}
            value={tab}
            onChange={setTab}
            label="Control Panel"
          />
          <div className="grid content-start gap-2 overflow-y-auto">
            {tab === 'import' ? <ImportTab /> : null}
            {tab === 'control' ? (
              video ? (
                // Control chỉ hiện panel của LAYER đang chọn — Device/Camera/Lighting.
                <>
                  <LayerSwitch />
                  {videoLayer === 'device' ? (
                    <>
                      <AnglePanel lockedSet="device" />
                      <GroundPanel />
                    </>
                  ) : null}
                  {videoLayer === 'camera' ? (
                    <>
                      <AnglePanel lockedSet="camera" />
                      <FramingPanel />
                    </>
                  ) : null}
                  {videoLayer === 'lighting' ? <EnvironmentPanel /> : null}
                </>
              ) : (
                <>
                  <AnglePanel />
                  <FramingPanel />
                  <GroundPanel />
                  <EnvironmentPanel />
                </>
              )
            ) : null}
            {tab === 'video' ? <VideoSettingsPanel /> : null}
            {tab === 'export' ? <ExportPanel /> : null}
          </div>
          {video && selectedKeyframe ? <KeyframeInspector /> : null}
        </aside>
      </main>

      <NewVideoDialog open={newVideoOpen} onClose={() => setNewVideoOpen(false)} />

      <AppStatusBar />
    </div>
  )
}
