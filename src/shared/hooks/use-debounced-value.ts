import { useEffect, useRef, useState } from 'react'

/**
 * Giá trị chỉ "chốt" sau khi đứng yên `delayMs`.
 *
 * Kéo slider sinh ra hàng chục lần đổi state; không debounce thì mỗi lần là một yêu cầu
 * render. Hàng đợi phía server đã bỏ hết trừ cái mới nhất, nhưng debounce ở đây rẻ hơn
 * nhiều: yêu cầu không bao giờ được gửi thì không tốn gì cả.
 *
 * Timer được reset ở mỗi lần đổi nên `delayMs` là "đứng yên bao lâu", không phải
 * "gửi mỗi bao lâu".
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  const first = useRef(true)

  useEffect(() => {
    // Lần đầu không chờ: preview phải hiện ngay khi mở app.
    if (first.current) {
      first.current = false
      setSettled(value)
      return
    }
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
