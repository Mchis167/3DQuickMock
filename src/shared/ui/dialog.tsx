import { useEffect, useRef } from 'react'

/**
 * Hộp thoại dùng `<dialog>` gốc của trình duyệt.
 *
 * Vì sao không tự dựng bằng `div` + backdrop: `showModal()` cho sẵn lớp trên cùng
 * (top layer), khoá tương tác phần dưới, bẫy tiêu điểm bàn phím và Esc để đóng. Tự viết
 * lại bốn thứ đó là tự viết lại bốn chỗ để sai.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string
  /** Gọi khi người dùng đóng bằng Esc hoặc bấm ra ngoài. */
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    // jsdom chưa có showModal trong mọi phiên bản; test chỉ cần nội dung có trong DOM.
    if (!dialog || typeof dialog.showModal !== 'function') return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      open
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Bấm ra ngoài: `<dialog>` nhận click trên chính nó khi trúng phần backdrop.
        if (event.target === ref.current) onClose()
      }}
      className="bg-card text-foreground fixed inset-0 m-auto w-80 border p-0 backdrop:bg-black/60"
    >
      <header className="h-header flex items-center border-b px-2">
        <h2 className="text-section font-semibold tracking-wide">{title}</h2>
      </header>
      {description ? (
        <p className="text-helper text-muted-foreground px-2 pt-2">{description}</p>
      ) : null}
      <div className="grid gap-px p-2">{children}</div>
    </dialog>
  )
}
