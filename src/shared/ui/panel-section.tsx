import { cn } from '@/shared/lib/cn'

/**
 * Một mục trong inspector: tiêu đề 26px kèm chỗ cho hành động, rồi phần thân.
 *
 * Tiêu đề nằm trên dải nền tối hơn thân, đúng cách Carbon phân tầng bằng `layer` chứ không
 * bằng bóng đổ. Khoảng cách thân là 1px (`gap-px`) vì các `SliderRow` tự có nền — xếp sát
 * nhau thành một khối liền, kiểu inspector của công cụ 3D.
 */
export function PanelSection({
  title,
  actions,
  children,
  className,
}: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('grid gap-px', className)}>
      <header className="h-row bg-background flex items-center justify-between gap-2 pl-2">
        <h2 className="text-section font-semibold tracking-wide">{title}</h2>
        {actions}
      </header>
      <div className="grid gap-px">{children}</div>
    </section>
  )
}
