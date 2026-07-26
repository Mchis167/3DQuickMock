import type { Easing, Interpolation } from '@/entities/scene-config'

/**
 * Hình dạng MINH HOẠ cho một cặp (nội suy, easing) — 24 điểm, x và y đều trong [0,1].
 *
 * ĐÂY LÀ ĐỒ HOẠ TRANG TRÍ, KHÔNG PHẢI GIÁ TRỊ RENDER. Chỉ dùng để người chọn nội suy biết
 * "SINE trông cong mềm, BOUNCE thì nảy" trước khi bấm — tức là giúp CHỌN, không phải để
 * đọc số. Giá trị dùng để render/preview luôn lấy từ `curveSamples` (worker Blender), theo
 * đúng nguyên tắc Architecture.md §9. Nếu icon và Blender lệch nhau vài phần trăm hình dạng
 * thì không sao — nhưng icon không bao giờ được dùng để TÍNH bất cứ thứ gì.
 *
 * Công thức xấp xỉ các họ easing chuẩn (giống thư viện easing phổ biến, không phải công
 * thức nội bộ của Blender).
 */
const STEPS = 24

function raw(interpolation: Interpolation, t: number): number {
  switch (interpolation) {
    case 'CONSTANT':
      return t < 1 ? 0 : 1
    case 'LINEAR':
      return t
    case 'SINE':
      return 1 - Math.cos((t * Math.PI) / 2)
    case 'QUAD':
      return t * t
    case 'CUBIC':
      return t * t * t
    case 'QUART':
      return t ** 4
    case 'QUINT':
      return t ** 5
    case 'EXPO':
      return t === 0 ? 0 : 2 ** (10 * (t - 1))
    case 'CIRC':
      return 1 - Math.sqrt(1 - t * t)
    case 'BACK': {
      const c = 1.70158
      return t * t * ((c + 1) * t - c)
    }
    case 'BOUNCE':
      return bounce(t)
    case 'ELASTIC': {
      if (t === 0 || t === 1) return t
      const p = 0.3
      return -(2 ** (10 * (t - 1))) * Math.sin(((t - 1 - p / 4) * (2 * Math.PI)) / p)
    }
    case 'BEZIER':
      // Xấp xỉ ease-in-out mềm, gần với cảm giác bezier tay cầm AUTO_CLAMPED mặc định.
      return t * t * (3 - 2 * t)
  }
}

function bounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) {
    const x = t - 1.5 / d1
    return n1 * x * x + 0.75
  }
  if (t < 2.5 / d1) {
    const x = t - 2.25 / d1
    return n1 * x * x + 0.9375
  }
  const x = t - 2.625 / d1
  return n1 * x * x + 0.984375
}

/** Áp hướng easing lên hình dạng thô — AUTO coi như EASE_IN_OUT cho mục đích minh hoạ. */
function withEasing(interpolation: Interpolation, easing: Easing, t: number): number {
  if (interpolation === 'CONSTANT' || interpolation === 'LINEAR') return raw(interpolation, t)

  if (easing === 'EASE_IN') return raw(interpolation, t)
  if (easing === 'EASE_OUT') return 1 - raw(interpolation, 1 - t)
  // EASE_IN_OUT và AUTO: ghép nửa đầu ease-in, nửa sau ease-out.
  return t < 0.5 ? raw(interpolation, 2 * t) / 2 : 1 - raw(interpolation, 2 * (1 - t)) / 2
}

/** 24 điểm (t, y) với t và y đều trong [0,1] — vẽ thẳng bằng polyline, không cần chuẩn hoá. */
export function curveIconPoints(
  interpolation: Interpolation,
  easing: Easing,
): readonly [number, number][] {
  return Array.from({ length: STEPS }, (_, i) => {
    const t = i / (STEPS - 1)
    const y = clamp01(withEasing(interpolation, easing, t))
    return [t, y] as const
  })
}

function clamp01(v: number): number {
  // BACK/ELASTIC/BOUNCE vượt ra ngoài [0,1] một cách hợp lệ (overshoot) — kẹp lại chỉ để
  // vẽ vừa khung icon nhỏ, không phải vì giá trị đó sai.
  return Math.min(1.15, Math.max(-0.15, v))
}
