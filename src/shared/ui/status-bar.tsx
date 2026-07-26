import { cn } from '@/shared/lib/cn'

/**
 * Thanh trạng thái đáy màn hình.
 *
 * Tồn tại để lấy số liệu RA KHỎI panel điều khiển. Trước Pha 4.5 những số này nằm rải rác
 * thành các dòng chữ nhỏ trong từng section (`nâng 6.4mm · hở đáy 0.00mm`,
 * `chiếm thật ≈ 65%`, `241 ms`), làm panel vừa cao vừa lẫn giữa "thứ điều khiển được" và
 * "thứ chỉ để đọc".
 */
export function StatusBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <footer
      className={cn(
        'h-status bg-card flex shrink-0 items-center gap-3 overflow-hidden border-t px-2',
        className,
      )}
    >
      {children}
    </footer>
  )
}

/**
 * Một ô số liệu: nhãn mờ, giá trị mono.
 *
 * `tone` chỉ để báo bất thường — mặc định mọi thứ đều là chữ mờ, vì status bar sáng đèn
 * khắp nơi thì không còn chỗ nào đáng chú ý.
 */
export function StatusItem({
  label,
  value,
  tone = 'normal',
  title,
}: {
  label?: string
  value: React.ReactNode
  tone?: 'normal' | 'warn' | 'error'
  title?: string
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap" title={title}>
      {label ? <span className="text-helper text-muted-foreground">{label}</span> : null}
      <span
        className={cn(
          'text-value tabular',
          tone === 'normal' && 'text-foreground/80',
          tone === 'warn' && 'text-draft-badge',
          tone === 'error' && 'text-destructive',
        )}
      >
        {value}
      </span>
    </span>
  )
}

export function StatusDivider() {
  return <span aria-hidden className="bg-border h-3 w-px shrink-0" />
}
