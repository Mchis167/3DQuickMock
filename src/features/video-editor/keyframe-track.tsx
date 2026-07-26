import { useRef, useState } from 'react'

import { keyedFrames, type Channels } from '@/entities/animation'
import type { ChannelKey } from '@/entities/scene-config'
import { cn } from '@/shared/lib/cn'

import { frameToX, xToFrame } from './scale'

/**
 * Một dòng track: các viên kim cương ở frame có keyframe, kéo được.
 *
 * Dùng `<button>` cho từng keyframe chứ không vẽ canvas: bàn phím tới được, test đọc
 * được bằng tên, và mỗi viên tự có vùng bấm 12px mà không phải tự tính vùng va chạm.
 *
 * Shift+kéo trên nền track mở một Ô CHỌN (marquee) thay vì tua playhead — đó là cách
 * lấy nhiều key một lúc để dời/xoá/đổi nội suy hàng loạt (xem `TimelinePanel`). Giữ
 * Shift làm điều kiện vì kéo thường (không giữ phím) đã có nghĩa "tua tới đây".
 */
export function KeyframeTrack({
  channels,
  keys,
  width,
  lastFrame,
  selectedFrame,
  groupFrames,
  label,
  onSelect,
  onMove,
  onScrub,
  onCommit,
  onMarquee,
}: {
  channels: Channels
  /** Các kênh gộp vào dòng này. Dòng layer gộp nhiều kênh; dòng kênh chỉ có một. */
  keys: readonly ChannelKey[]
  width: number
  lastFrame: number
  selectedFrame: number | null
  /** Frame (trong `keys`) đang thuộc nhóm đã chọn — tô cùng kiểu với `selectedFrame`. */
  groupFrames: readonly number[]
  label: string
  onSelect: (frame: number) => void
  onMove: (from: number, to: number) => void
  /** Bấm vào chỗ trống của track = tua playhead tới đó. */
  onScrub: (frame: number) => void
  /** Thả chuột: kết thúc cụm coalesce để lần kéo sau là một bước undo mới. */
  onCommit: () => void
  /** Thả marquee: `keys` của dòng này cùng khoảng frame [a, b] vừa quét qua. */
  onMarquee: (a: number, b: number) => void
}) {
  const frames = keyedFrames(channels, keys)
  // Frame đang kéo được giữ trong ref: mỗi lần `pointermove` phải biết key hiện ĐANG ở
  // đâu, mà state React thì cập nhật sau một nhịp render.
  const dragging = useRef<number | null>(null)
  const marqueeStart = useRef<number | null>(null)
  const [marqueeEnd, setMarqueeEnd] = useState<number | null>(null)

  return (
    <div
      role="group"
      aria-label={label}
      className="relative h-full"
      onPointerDown={(event) => {
        // Bấm vào một viên kim cương đã `stopPropagation`, nên chạm tới đây là nền track.
        if (event.target !== event.currentTarget) return
        const x = event.clientX - event.currentTarget.getBoundingClientRect().left
        const at = xToFrame(x, width, lastFrame)
        if (event.shiftKey) {
          event.currentTarget.setPointerCapture(event.pointerId)
          marqueeStart.current = at
          setMarqueeEnd(at)
          return
        }
        // Tạo key bằng cú bấm nhầm là cách nhanh nhất để timeline đầy những key không ai
        // định đặt, nên nền track không giữ phím chỉ tua, không tạo gì cả.
        onScrub(at)
      }}
      onPointerMove={(event) => {
        if (marqueeStart.current === null) return
        const x = event.clientX - event.currentTarget.getBoundingClientRect().left
        setMarqueeEnd(xToFrame(x, width, lastFrame))
      }}
      onPointerUp={(event) => {
        const start = marqueeStart.current
        if (start === null) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        onMarquee(start, marqueeEnd ?? start)
        marqueeStart.current = null
        setMarqueeEnd(null)
      }}
    >
      {marqueeStart.current !== null && marqueeEnd !== null ? (
        <div
          className="bg-primary/15 border-primary/60 pointer-events-none absolute inset-y-0 border"
          style={{
            left: `${Math.min(frameToX(marqueeStart.current, width, lastFrame), frameToX(marqueeEnd, width, lastFrame))}px`,
            width: `${Math.abs(frameToX(marqueeEnd, width, lastFrame) - frameToX(marqueeStart.current, width, lastFrame))}px`,
          }}
        />
      ) : null}

      {frames.map((frame) => {
        const selected = frame === selectedFrame || groupFrames.includes(frame)
        return (
          <button
            key={frame}
            type="button"
            aria-label={`Keyframe ${frame}`}
            aria-pressed={selected}
            style={{ left: `${frameToX(frame, width, lastFrame)}px` }}
            className={cn(
              'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border transition-colors',
              selected
                ? 'border-keyframe-selected bg-keyframe-selected'
                : 'border-keyframe bg-keyframe/70 hover:bg-keyframe',
            )}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              dragging.current = frame
              onSelect(frame)
            }}
            onPointerMove={(event) => {
              const from = dragging.current
              if (from === null) return
              const track = event.currentTarget.parentElement
              if (!track) return
              const x = event.clientX - track.getBoundingClientRect().left
              const to = xToFrame(x, width, lastFrame)
              if (to === from) return
              onMove(from, to)
              dragging.current = to
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId)
              dragging.current = null
              onCommit()
            }}
            onKeyDown={(event) => {
              // Mũi tên dời từng frame — chỉnh chính xác mà không cần chuột.
              const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
              if (step === 0) return
              event.preventDefault()
              onMove(frame, frame + step)
              onCommit()
            }}
          />
        )
      })}
    </div>
  )
}
