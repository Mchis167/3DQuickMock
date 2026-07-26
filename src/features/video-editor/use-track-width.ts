import { useEffect, useRef, useState } from 'react'

/**
 * Bề rộng thật của vùng track, tính bằng pixel.
 *
 * Phải ĐO chứ không suy từ CSS: quy đổi frame ↔ pixel cần con số thật, và cột inspector
 * hay cửa sổ đổi kích thước thì con số đó đổi theo. Lấy nhầm bề rộng là click vào thước
 * nhảy sai frame — sai nhỏ, khó thấy, và chỉ lộ ra khi người dùng đặt key trượt một hai
 * frame rồi không hiểu vì sao.
 */
export function useTrackWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const getActualWidth = () => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const paddingLeft = parseFloat(style.paddingLeft) || 0
      const paddingRight = parseFloat(style.paddingRight) || 0
      return rect.width - paddingLeft - paddingRight
    }
    // jsdom không có ResizeObserver; test component không cần đo, chỉ cần không nổ.
    if (typeof ResizeObserver === 'undefined') {
      setWidth(getActualWidth())
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0)
    })
    observer.observe(element)
    setWidth(getActualWidth())
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
