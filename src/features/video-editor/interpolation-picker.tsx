import { INTERPOLATIONS, type Easing, type Interpolation } from '@/entities/scene-config'
import { cn } from '@/shared/lib/cn'

import { CurveIcon } from './curve-icon'

/**
 * Lưới 13 nội suy, MỖI Ô CÓ HÌNH — thay cho dropdown chữ.
 *
 * Vì sao: "BOUNCE" hay "ELASTIC" là những cái tên không tự nói lên hình dạng, và trước đây
 * người dùng phải chọn mù rồi nhìn preview để đoán. Hình ở đây minh hoạ hình dạng (xem
 * `curve-icon.ts` — KHÔNG phải giá trị thật), nên chọn được bằng mắt chứ không phải bằng
 * thử-sai.
 *
 * `easing` truyền vào chỉ để hình minh hoạ đúng chiều đang chọn, không phải để đổi nó.
 */
export function InterpolationPicker({
  value,
  easing,
  onChange,
}: {
  value: Interpolation
  easing: Easing
  onChange: (interpolation: Interpolation) => void
}) {
  return (
    <div role="radiogroup" aria-label="Interpolation" className="grid grid-cols-4 gap-px p-1">
      {INTERPOLATIONS.map((interpolation) => {
        const active = interpolation === value
        return (
          <button
            key={interpolation}
            type="button"
            role="radio"
            aria-checked={active}
            title={interpolation}
            onClick={() => onChange(interpolation)}
            className={cn(
              'flex flex-col items-center gap-0.5 border py-1 transition-colors',
              active
                ? 'border-foreground bg-secondary'
                : 'hover:bg-secondary/50 border-transparent',
            )}
          >
            <CurveIcon interpolation={interpolation} easing={easing} className="h-4 w-6" />
            <span className="text-helper text-muted-foreground truncate text-[9px] leading-none">
              {interpolation}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Bốn hướng easing, cũng có hình. Khoá khi nội suy không có gia tốc (CONSTANT/LINEAR) —
 * hiện ra mà không tác dụng thì người dùng sẽ đổi rồi tự hỏi vì sao đường cong không đổi.
 */
const EASINGS_ORDER: readonly Easing[] = ['EASE_IN', 'EASE_OUT', 'EASE_IN_OUT', 'AUTO']

export function EasingPicker({
  value,
  interpolation,
  disabled,
  onChange,
}: {
  value: Easing
  interpolation: Interpolation
  disabled?: boolean
  onChange: (easing: Easing) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Easing"
      aria-disabled={disabled || undefined}
      className={cn('grid grid-cols-4 gap-px p-1', disabled && 'opacity-40')}
    >
      {EASINGS_ORDER.map((easing) => {
        const active = easing === value
        return (
          <button
            key={easing}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={easing}
            onClick={() => onChange(easing)}
            className={cn(
              'flex flex-col items-center gap-0.5 border py-1 transition-colors',
              disabled ? 'cursor-not-allowed' : '',
              active
                ? 'border-foreground bg-secondary'
                : 'hover:bg-secondary/50 border-transparent',
            )}
          >
            <CurveIcon interpolation={interpolation} easing={easing} className="h-4 w-6" />
            <span className="text-helper text-muted-foreground truncate text-[9px] leading-none">
              {easing.replace('EASE_', '')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
