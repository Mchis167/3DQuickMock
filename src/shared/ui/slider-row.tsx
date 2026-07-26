import { useId, useState } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * Một control số trên MỘT dòng 26px — thay cho `SliderField` hai dòng của Pha 3.
 *
 * Ba cách tương tác, cố ý tách nhau để không giành pointer:
 *
 *  - **kéo trên nhãn** → scrub tương đối. `Shift` bước ×10, `Alt` bước ÷10. Đây là thứ
 *    tạo cảm giác công cụ nhiều hơn cả màu sắc; con trỏ `ew-resize` là chỉ dấu.
 *  - **double-click nhãn** → về giá trị mặc định. Đặt trên nhãn chứ không trên ô số, vì
 *    double-click trong ô số vốn đã có nghĩa là "chọn chữ".
 *  - **click/kéo trên dòng** → đặt giá trị tuyệt đối theo vị trí (`<input type="range">`
 *    thật, trải kín dòng và trong suốt).
 *
 * Dùng range gốc của HTML thay vì tự vẽ: bàn phím, ARIA và `fireEvent.change` chạy sẵn,
 * không phải giả lập kéo chuột trong test.
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  defaultValue,
  precision,
  onChange,
  onCommit,
  disabled,
  className,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  /** Giá trị double-click trên nhãn sẽ quay về. Không truyền thì tắt tính năng đó. */
  defaultValue?: number
  /** Số chữ số thập phân khi hiển thị. Suy ra từ `step` nếu không truyền. */
  precision?: number
  onChange: (value: number) => void
  /**
   * Kết thúc một cụm thao tác: thả chuột, rời ô số, hay nhả phím mũi tên.
   *
   * Chỗ gọi dùng nó để đóng bước undo. Không có nó thì hai cú kéo cách nhau bao lâu cũng
   * gộp chung một bước — `coalesce` chỉ nhận diện cụm bằng nhãn, không biết thời gian.
   */
  onCommit?: () => void
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  const digits = precision ?? decimalsOf(step)
  const [activePointerId, setActivePointerId] = useState<number | null>(null)
  const [typing, setTyping] = useState<string | null>(null)

  const percent = max === min ? 0 : ((clamp(value, min, max) - min) / (max - min)) * 100

  const commit = (next: number) => {
    if (!Number.isFinite(next)) return
    onChange(roundTo(clamp(next, min, max), digits))
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.button !== 0) return // Chỉ xử lý chuột trái

    const target = event.target as HTMLElement
    if (target.closest('input[type="number"]') || target.closest('.text-helper')) {
      return
    }

    event.preventDefault()
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setActivePointerId(event.pointerId)

    const rangeInput = event.currentTarget.querySelector('input[type="range"]') as HTMLInputElement | null
    rangeInput?.focus()

    const rect = event.currentTarget.getBoundingClientRect()
    const percentage = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    commit(min + percentage * (max - min))
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const percentage = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    commit(min + percentage * (max - min))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId !== event.pointerId) return
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setActivePointerId(null)
    onCommit?.()
  }

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || defaultValue === undefined) return
    const target = event.target as HTMLElement
    if (target.closest('input[type="number"]') || target.closest('.text-helper')) {
      return
    }
    commit(defaultValue)
  }

  /** Bước nhảy theo phím bổ trợ đang giữ. */
  const stepFor = (event: { shiftKey: boolean; altKey: boolean }) =>
    event.shiftKey ? step * 10 : event.altKey ? step / 10 : step

  return (
    <div
      className={cn(
        'group h-row bg-input relative flex items-center overflow-hidden select-none cursor-ew-resize',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      title={defaultValue !== undefined ? 'Kéo để đổi · double-click để reset' : 'Kéo để đổi'}
    >
      {/* Vạch nền chỉ vị trí trong khoảng — không phải thanh tiến trình, nên rất mờ. */}
      <div
        aria-hidden
        className="bg-secondary pointer-events-none absolute inset-y-0 left-0"
        style={{ width: `${percent}%` }}
      />

      {/* Range thật, trong suốt, trải kín dòng: nguồn sự thật cho bàn phím và ARIA. */}
      <input
        id={id}
        type="range"
        aria-label={label}
        className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
        value={clamp(value, min, max)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => commit(Number(event.target.value))}
        onKeyUp={() => onCommit?.()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          if (!event.shiftKey && !event.altKey) return
          event.preventDefault()
          const direction = event.key === 'ArrowUp' ? 1 : -1
          commit(value + direction * stepFor(event))
        }}
      />

      <span
        className="text-label text-muted-foreground group-hover:text-foreground pointer-events-none relative z-10 flex-1 truncate px-2"
      >
        {label}
      </span>

      <input
        type="number"
        aria-label={`${label} value`}
        className="text-value tabular focus-visible:bg-background pointer-events-auto relative z-10 w-16 [appearance:textfield] bg-transparent px-2 text-right [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none cursor-text"
        value={typing ?? value.toFixed(digits)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          setTyping(event.target.value)
          const next = Number(event.target.value)
          if (event.target.value !== '' && Number.isFinite(next)) commit(next)
        }}
        onBlur={() => {
          setTyping(null)
          onCommit?.()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setTyping(null)
        }}
      />

      {unit ? (
        <span className="text-helper text-muted-foreground relative z-10 w-5 pr-2 pointer-events-none">{unit}</span>
      ) : null}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
