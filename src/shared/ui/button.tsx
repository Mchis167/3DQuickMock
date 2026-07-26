import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/shared/lib/cn'

/**
 * Nút kiểu Carbon: góc vuông, chữ 12px, không bóng đổ.
 *
 * Chỉ có Blue 60 làm màu tương tác — không thêm màu nhấn thứ hai, nếu không thì không còn
 * chỗ nào là "hành động chính".
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-110',
        secondary: 'bg-secondary text-secondary-foreground hover:brightness-125',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        outline: 'border bg-input text-foreground hover:bg-secondary',
        danger: 'bg-destructive text-destructive-foreground hover:brightness-110',
      },
      size: {
        sm: 'h-control px-2 text-label',
        md: 'h-8 px-3 text-ui',
        icon: 'h-control w-control',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
