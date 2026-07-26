import { lastFrame } from '@/entities/animation'
import type { ChannelKey } from '@/entities/scene-config'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const WIDTH = 100
const HEIGHT = 40

/**
 * Đường cong THẬT của một kênh, vẽ từ `curveSamples` — dữ liệu do worker Blender lấy mẫu.
 *
 * Khác hẳn `CurveIcon`: đây KHÔNG phải minh hoạ, đây là con số sẽ render ra đúng như vậy.
 * Không tự nội suy trong TS — nếu chưa có mẫu thì hiện "đang lấy mẫu…", không đoán.
 */
export function CurvePreview({ channel }: { channel: ChannelKey }) {
  const samples = useSessionStore((state) => state.curveSamples?.[channel])
  const channels = useDocumentStore((state) => state.document.channels)
  const timeline = useDocumentStore((state) => state.document.timeline)
  const playhead = useSessionStore((state) => state.playhead)
  const selected = useSessionStore((state) => state.selectedKeyframe)

  if (!samples || samples.length === 0) {
    return (
      <p className="text-helper text-muted-foreground bg-input flex h-10 items-center px-2">
        Đang lấy mẫu đường cong…
      </p>
    )
  }

  const end = lastFrame(timeline)
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const span = max - min || 1

  const xOf = (frame: number) => ((frame - 1) / Math.max(1, end - 1)) * WIDTH
  const yOf = (value: number) => HEIGHT - ((value - min) / span) * HEIGHT

  const path = samples
    .map((value, i) => `${xOf(i + 1).toFixed(1)},${yOf(value).toFixed(1)}`)
    .join(' ')
  const keyframes = channels[channel]?.keyframes ?? []

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-label={`Curve for ${channel}`}
      className="bg-input h-10 w-full"
    >
      <polyline
        points={path}
        fill="none"
        stroke="var(--color-curve-line)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={xOf(playhead)}
        x2={xOf(playhead)}
        y1={0}
        y2={HEIGHT}
        stroke="var(--color-timeline-playhead)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {keyframes.map((kf) => {
        const isSelected = selected?.channel === channel && selected.frame === kf.frame
        return (
          <circle
            key={kf.frame}
            cx={xOf(kf.frame)}
            cy={yOf(kf.value)}
            r={isSelected ? 2.2 : 1.4}
            fill={isSelected ? 'var(--color-keyframe-selected)' : 'var(--color-keyframe)'}
          />
        )
      })}
    </svg>
  )
}
