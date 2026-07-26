/**
 * Toán thu phóng canvas — hàm THUẦN, không biết gì về React hay DOM.
 *
 * Tách ra khỏi component vì phép "zoom quanh con trỏ" là chỗ dễ sai thầm lặng: sai một dấu
 * là ảnh trôi đi thay vì đứng yên dưới con trỏ, và cảm giác đó rất khó mô tả thành bug.
 */
export interface ViewTransform {
  /** 1 = pixel gốc của ảnh. */
  scale: number
  /** Vị trí góc trên-trái của ảnh trong khung nhìn, pixel CSS. */
  offset: { x: number; y: number }
}

export interface Size {
  width: number
  height: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Thu phóng quanh một điểm trong khung nhìn, giữ đúng điểm đó bất động.
 *
 * Điểm dưới con trỏ trong toạ độ ảnh là `(cursor - offset) / scale`. Muốn nó vẫn nằm dưới
 * con trỏ sau khi đổi tỉ lệ thì `offset' = cursor - (cursor - offset) × scale'/scale`.
 */
export function zoomAt(
  view: ViewTransform,
  factor: number,
  cursor: { x: number; y: number },
): ViewTransform {
  const scale = clampScale(view.scale * factor)
  // Đã chạm biên thì đừng dịch ảnh: nếu không, cuộn tiếp ở mức tối đa sẽ làm ảnh trôi đi
  // trong khi tỉ lệ không đổi.
  if (scale === view.scale) return view
  const ratio = scale / view.scale
  return {
    scale,
    offset: {
      x: cursor.x - (cursor.x - view.offset.x) * ratio,
      y: cursor.y - (cursor.y - view.offset.y) * ratio,
    },
  }
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { scale: view.scale, offset: { x: view.offset.x + dx, y: view.offset.y + dy } }
}

/** Đặt ảnh vào giữa khung nhìn ở một tỉ lệ cho trước. */
export function centerView(viewport: Size, content: Size, scale: number): ViewTransform {
  return {
    scale,
    offset: {
      x: (viewport.width - content.width * scale) / 2,
      y: (viewport.height - content.height * scale) / 2,
    },
  }
}

/** Tỉ lệ để ảnh vừa khít khung nhìn — dùng khi vào chế độ zoom để không bị nhảy hình. */
export function fitScale(viewport: Size, content: Size): number {
  if (!content.width || !content.height) return 1
  return clampScale(Math.min(viewport.width / content.width, viewport.height / content.height))
}

/** Bước thu phóng từ một lần cuộn chuột. Chuẩn hoá theo `deltaY` nên trackpad mượt. */
export function wheelFactor(deltaY: number): number {
  return Math.pow(1.0015, -deltaY)
}
