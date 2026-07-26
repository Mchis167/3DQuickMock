import { useRef } from 'react'

import { clipEnd, type ScreenClip } from '@/entities/animation'
import { cn } from '@/shared/lib/cn'

import { frameToX, xToFrame } from './scale'

/**
 * Clip màn hình dạng THANH, không phải keyframe.
 *
 * Vì sao là thanh: video có ĐỘ DÀI. Một viên kim cương chỉ nói "có gì xảy ra ở frame này",
 * còn thứ cần nói ở đây là "video chiếm từ frame này đến frame kia" — và người dùng cần
 * thấy nó có phủ hết timeline hay không, có bị hụt đuôi hay không, chỉ bằng cách nhìn.
 *
 * Kéo thanh dời `start`. Không cho resize: độ dài clip do SỐ KHUNG trích được quyết định
 * (video 3 giây ở 30fps là đúng 90 khung), nên một tay cầm resize sẽ hoặc nói dối về độ dài
 * hoặc âm thầm đổi tốc độ phát — cả hai đều tệ hơn việc không có nó.
 */
export function ScreenClipBar({
  clip,
  videoFrames,
  width,
  lastFrame,
  onMove,
  onCommit,
}: {
  clip: ScreenClip
  videoFrames: number
  width: number
  lastFrame: number
  onMove: (start: number) => void
  /** Thả chuột: đóng cụm coalesce để cú kéo sau là một bước undo mới. */
  onCommit: () => void
}) {
  /** Frame lúc bắt đầu kéo, cộng frame chuột đang ở — để dời theo ĐỘ LỆCH, không nhảy. */
  const drag = useRef<{ grabbed: number; start: number } | null>(null)

  const end = clipEnd(clip, videoFrames)
  const left = frameToX(clip.start, width, lastFrame)
  const right = frameToX(end, width, lastFrame)

  return (
    <div className="relative h-full">
      <button
        type="button"
        aria-label="Screen clip"
        // Thanh có thể tràn ra ngoài hai đầu timeline một cách hợp lệ (video dài hơn cảnh,
        // hoặc bắt đầu trước frame 1) — `overflow-hidden` của cha cắt phần tràn, đúng ý.
        style={{ left: `${left}px`, width: `${Math.max(2, right - left)}px` }}
        className={cn(
          'bg-keyframe/30 border-keyframe absolute inset-y-1 cursor-ew-resize border',
          'hover:bg-keyframe/50 transition-colors',
        )}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          const track = event.currentTarget.parentElement
          if (!track) return
          const x = event.clientX - track.getBoundingClientRect().left
          drag.current = { grabbed: xToFrame(x, width, lastFrame), start: clip.start }
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state) return
          const track = event.currentTarget.parentElement
          if (!track) return
          const x = event.clientX - track.getBoundingClientRect().left
          // Dời theo độ lệch so với chỗ bấm, không đặt `start` bằng frame dưới con trỏ —
          // nếu không thì bấm vào giữa thanh sẽ làm nó nhảy sao cho đầu thanh về đó.
          const delta = xToFrame(x, width, lastFrame) - state.grabbed
          if (delta === 0) return
          onMove(state.start + delta)
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          drag.current = null
          onCommit()
        }}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
          if (step === 0) return
          event.preventDefault()
          onMove(clip.start + step)
          onCommit()
        }}
      >
        <span className="text-helper text-foreground pointer-events-none pl-1 font-mono">
          {videoFrames}f
        </span>
      </button>
    </div>
  )
}
