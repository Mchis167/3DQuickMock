import { cn } from '@/shared/lib/cn'

/**
 * Công tắc nhiều lựa chọn, cao 24px, góc vuông.
 *
 * Dùng `role="radiogroup"` để bàn phím và test đọc trạng thái thật qua `aria-checked`,
 * không phải suy ra từ class CSS.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'fill',
  disabled = false,
  disabledHint,
  className,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  variant?: 'fill' | 'fit'
  /** Khoá cả nhóm. Dùng khi lựa chọn không còn tác dụng, không phải khi thiếu quyền. */
  disabled?: boolean
  /** Câu giải thích vì sao đang khoá — hiện trong tooltip. Bắt buộc có khi `disabled`. */
  disabledHint?: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledHint : undefined}
      className={cn(
        'h-control divide-border flex divide-x border',
        variant === 'fit' ? 'w-fit' : '',
        disabled ? 'opacity-40' : '',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'text-label shrink-0 px-2 transition-colors',
              disabled ? 'cursor-not-allowed' : '',
              variant === 'fill' ? 'flex-1 truncate' : '',
              active
                ? 'bg-secondary text-foreground font-medium'
                : 'bg-input text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
