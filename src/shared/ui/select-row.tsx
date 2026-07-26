import { cn } from '@/shared/lib/cn'

/**
 * Một dòng chọn: nhãn bên trái, `<select>` bên phải. Cao 26px như `SliderRow`.
 *
 * Dùng `<select>` gốc chứ không dựng popup tự viết: bàn phím, tìm-theo-chữ và cách hệ
 * điều hành hiển thị danh sách dài đều có sẵn và đúng. Danh sách 13 kiểu nội suy là chỗ
 * mà thứ tự bàn phím quan trọng hơn thẩm mỹ.
 */
export function SelectRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled = false,
  disabledHint,
  className,
}: {
  label: string
  /** Giải thích, hiện trong tooltip — nhãn giữ ngắn. */
  hint?: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  disabledHint?: string
  className?: string
}) {
  return (
    <label
      title={disabled ? disabledHint : hint}
      className={cn(
        'h-row bg-input flex items-center gap-2 pr-1 pl-2',
        disabled ? 'opacity-40' : '',
        className,
      )}
    >
      <span className="text-label text-muted-foreground shrink-0">{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className="text-label bg-secondary h-control ml-auto w-40 min-w-0 truncate px-1"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
