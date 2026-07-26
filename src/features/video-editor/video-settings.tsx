import {
  ASPECT_IDS,
  resolutionOf,
  timelineFrames,
  type AspectId,
  type Timeline,
} from '@/entities/animation'
import { useDocumentStore } from '@/entities/scene-config/store'
import { PanelSection } from '@/shared/ui/panel-section'
import { SelectRow } from '@/shared/ui/select-row'
import { SliderRow } from '@/shared/ui/slider-row'

/**
 * fps, thời lượng và tỉ lệ canvas.
 *
 * Cả ba đều nằm TRONG tài liệu nên đổi được bất cứ lúc nào và Ctrl+Z lại được — khác với
 * hộp thoại "new video" chỉ hỏi một lần lúc bắt đầu. Đổi fps mà phải tạo lại project là
 * cách bắt người dùng dựng lại toàn bộ timeline vì một con số.
 */
const FPS_OPTIONS = [24, 25, 30, 50, 60].map((fps) => ({
  value: String(fps),
  label: `${fps} fps`,
}))

const ASPECT_OPTIONS = ASPECT_IDS.map((value) => {
  const [w, h] = resolutionOf({ aspect: value })
  return { value, label: `${value} · ${w}×${h}` }
})

export function VideoSettingsPanel() {
  const timeline = useDocumentStore((state) => state.document.timeline)
  const setTimeline = useDocumentStore((state) => state.setTimeline)
  const endGesture = useDocumentStore((state) => state.endGesture)

  return (
    <PanelSection title="Video">
      <TimelineFields timeline={timeline} onChange={setTimeline} onCommit={endGesture} />
      <p className="text-helper text-muted-foreground px-2 py-1 font-mono">
        {timelineFrames(timeline)} frames
      </p>
    </PanelSection>
  )
}

/**
 * Ba ô dùng chung giữa panel và hộp thoại. Nhân đôi chúng là để hai chỗ trôi dần khỏi
 * nhau — chỗ này thêm 50fps, chỗ kia không.
 */
export function TimelineFields({
  timeline,
  onChange,
  onCommit,
}: {
  timeline: Timeline
  onChange: (values: Partial<Timeline>, coalesce?: boolean) => void
  onCommit: () => void
}) {
  return (
    <>
      <SelectRow
        label="FPS"
        hint="Số frame mỗi giây của clip xuất ra"
        value={String(timeline.fps)}
        options={FPS_OPTIONS}
        onChange={(value) => onChange({ fps: Number(value) })}
      />
      <SliderRow
        label="Duration"
        value={timeline.duration}
        min={0.5}
        max={60}
        step={0.5}
        unit="s"
        defaultValue={5}
        onChange={(duration) => onChange({ duration }, true)}
        // Kéo xong mới đóng bước undo, nên cả cú kéo là MỘT lần Ctrl+Z.
        onCommit={onCommit}
      />
      <SelectRow
        label="Aspect"
        hint="Tỉ lệ khung hình; độ phân giải ×1, export nhân thêm ×2/×4"
        value={timeline.aspect}
        options={ASPECT_OPTIONS}
        onChange={(aspect: AspectId) => onChange({ aspect })}
      />
    </>
  )
}
