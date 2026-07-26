import { forwardRef } from 'react'

import { cn } from '@/shared/lib/cn'

/**
 * Nền ô vuông cho vùng alpha. Màu lấy từ token tầng 2 nên đổi theme là đổi theo.
 *
 * Nhận `ref` vì khung preview cần đo kích thước thật của nó để tính thu phóng quanh con trỏ.
 */
export const CheckerCanvas = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { size?: number }
>(function CheckerCanvas({ className, children, size = 16, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      style={{
        backgroundColor: 'var(--color-canvas-checker-a)',
        backgroundImage: `
          linear-gradient(45deg, var(--color-canvas-checker-b) 25%, transparent 25%),
          linear-gradient(-45deg, var(--color-canvas-checker-b) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, var(--color-canvas-checker-b) 75%),
          linear-gradient(-45deg, transparent 75%, var(--color-canvas-checker-b) 75%)`,
        backgroundSize: `${size * 2}px ${size * 2}px`,
        backgroundPosition: `0 0, 0 ${size}px, ${size}px -${size}px, -${size}px 0`,
      }}
      {...props}
    >
      {children}
    </div>
  )
})
