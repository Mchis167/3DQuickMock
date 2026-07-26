import { cn } from '@/shared/lib/cn'

/**
 * Dải tab kiểu Carbon "contained": tab đang chọn sáng hơn nền, gạch 2px phía trên.
 *
 * Dùng `role="tablist"` thật để bàn phím và test đọc được trạng thái qua `aria-selected`,
 * không phải suy ra từ class.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('h-header bg-background flex shrink-0 border-b', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={cn(
              'text-ui relative flex-1 px-2 font-medium tracking-wide transition-colors',
              // Gạch trên 2px là cách Carbon đánh dấu tab đang mở; không dùng màu chữ đơn
              // thuần vì ở mật độ này chênh lệch màu chữ khó thấy.
              selected
                ? 'bg-card text-foreground before:bg-primary before:absolute before:inset-x-0 before:top-0 before:h-0.5'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
