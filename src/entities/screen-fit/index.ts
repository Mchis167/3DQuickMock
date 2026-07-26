/**
 * Ba chế độ khớp tỉ lệ nội dung màn hình — hàm THUẦN, không chạm file nào.
 *
 * Vì sao phải khớp trước khi đưa cho Blender: UV màn hình trải đúng `[0,1]²`, nên Blender
 * luôn **kéo giãn** ảnh phủ kín màn hình. Muốn "fill + crop" hay "fit + dải đen" thì phải
 * biến ảnh vào thành ảnh có ĐÚNG tỉ lệ màn hình trước, rồi Blender kéo giãn mới là phép
 * đồng nhất.
 *
 * Màn hình 73 × 158 mm ≈ 19.5:9, còn video thường 16:9 — nên `stretch` méo rất nặng và
 * đó là lý do UI phải hỏi, không tự chọn (App_Feature_Spec §2).
 */
export const FIT_MODES = ['fill', 'fit', 'stretch'] as const
export type FitMode = (typeof FIT_MODES)[number]

export interface Size {
  width: number
  height: number
}

export interface FitPlan {
  mode: FitMode
  /** Vùng cắt từ ảnh gốc (pixel, gốc toạ độ ở góc trên-trái). */
  crop: { left: number; top: number; width: number; height: number }
  /** Kích thước ảnh gốc sau khi thu/phóng, trước khi đặt vào khung. */
  resize: Size
  /** Vị trí đặt ảnh đã thu/phóng vào khung ra (dải đen là phần còn lại). */
  offset: { left: number; top: number }
  /** Kích thước ảnh ra — LUÔN đúng tỉ lệ màn hình. */
  output: Size
  /** Có phần nào bị cắt mất không — UI cần biết để nói trước. */
  cropped: boolean
  /** Có dải đen không. */
  letterboxed: boolean
  /** Có méo tỉ lệ không. */
  distorted: boolean
}

/**
 * Tính kế hoạch biến đổi. `output` luôn là `target`, chỉ đường đi tới đó là khác nhau.
 *
 * Làm tròn: mọi số là pixel nguyên. Cắt/đặt lệch nửa pixel thì ảnh bị dịch nhẹ, và với
 * ảnh có chữ (mockup app) mắt thấy được ngay.
 */
export function planScreenFit(source: Size, target: Size, mode: FitMode): FitPlan {
  assertPositive(source, 'source')
  assertPositive(target, 'target')

  const sourceAspect = source.width / source.height
  const targetAspect = target.width / target.height
  const base = {
    mode,
    output: { ...target },
    offset: { left: 0, top: 0 },
    cropped: false,
    letterboxed: false,
    distorted: false,
  }

  if (mode === 'stretch') {
    // Kéo thẳng: không cắt, không dải đen, méo nếu tỉ lệ khác nhau.
    return {
      ...base,
      crop: { left: 0, top: 0, width: source.width, height: source.height },
      resize: { ...target },
      distorted: Math.abs(sourceAspect - targetAspect) > 1e-9,
    }
  }

  if (mode === 'fill') {
    // Cắt ảnh gốc về đúng tỉ lệ đích rồi phóng phủ kín. Cắt ở GIỮA: mockup app thường
    // có nội dung chính ở giữa, và cắt lệch làm status bar biến mất.
    const cropWidth = Math.min(source.width, Math.round(source.height * targetAspect))
    const cropHeight = Math.min(source.height, Math.round(source.width / targetAspect))
    return {
      ...base,
      crop: {
        left: Math.round((source.width - cropWidth) / 2),
        top: Math.round((source.height - cropHeight) / 2),
        width: cropWidth,
        height: cropHeight,
      },
      resize: { ...target },
      cropped: cropWidth < source.width || cropHeight < source.height,
    }
  }

  // fit: giữ trọn nội dung, phần thiếu là dải đen.
  const scale = Math.min(target.width / source.width, target.height / source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  return {
    ...base,
    crop: { left: 0, top: 0, width: source.width, height: source.height },
    resize: { width, height },
    offset: {
      left: Math.round((target.width - width) / 2),
      top: Math.round((target.height - height) / 2),
    },
    letterboxed: width < target.width || height < target.height,
  }
}

/** Kích thước ảnh màn hình nên dùng cho một chiều rộng cho trước, theo tỉ lệ mesh. */
export function screenTargetSize(screenMm: Size, width: number): Size {
  return {
    width,
    height: Math.round((width * screenMm.height) / screenMm.width),
  }
}

function assertPositive(size: Size, name: string): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new Error(`${name} phải có width/height dương, nhận ${size.width}×${size.height}`)
  }
}

/**
 * Phép biến đổi TOẠ ĐỘ tương đương ba chế độ khớp tỉ lệ — dùng cho đường video.
 *
 * Ảnh tĩnh được khớp ở server bằng cách cắt/đệm PIXEL trước khi đưa vào Blender. Video thì
 * không thể làm vậy: nó được lấy mẫu trực tiếp trong shader, nên phép khớp phải là một phép
 * biến đổi toạ độ áp lên `(u, v)` ngay lúc tra cứu.
 *
 * Kết quả áp như sau, quanh tâm màn hình:
 *
 *     st = (uv - 0.5) * scale + 0.5
 *
 * `scale > 1` nghĩa là lấy mẫu RỘNG hơn khung màn hình, tức thu nhỏ nội dung lại (fit, có dải
 * đen). `scale < 1` là phóng to và cắt bớt (fill).
 *
 * Vì sao xoay quanh tâm: cắt lệch làm status bar của mockup app biến mất — cùng lý do với
 * `planScreenFit`.
 */
export interface FitTransform {
  /** Nhân vào `(uv - 0.5)`. */
  scale: { x: number; y: number }
  /** `true` khi phải tô đen phần nằm ngoài [0,1] — chỉ chế độ `fit`. */
  letterbox: boolean
}

export function screenFitTransform(source: Size, screen: Size, mode: FitMode): FitTransform {
  assertPositive(source, 'source')
  assertPositive(screen, 'screen')
  const sourceAspect = source.width / source.height
  const screenAspect = screen.width / screen.height
  const ratio = sourceAspect / screenAspect

  if (mode === 'stretch') {
    return { scale: { x: 1, y: 1 }, letterbox: false }
  }
  if (mode === 'fill') {
    // Nội dung rộng hơn màn hình -> cắt hai bên; hẹp hơn -> cắt trên dưới.
    return ratio > 1
      ? { scale: { x: 1 / ratio, y: 1 }, letterbox: false }
      : { scale: { x: 1, y: ratio }, letterbox: false }
  }
  // fit: giữ trọn nội dung, phần thiếu là dải đen.
  return ratio > 1
    ? { scale: { x: 1, y: ratio }, letterbox: true }
    : { scale: { x: 1 / ratio, y: 1 }, letterbox: true }
}
