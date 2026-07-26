import type { Easing, Interpolation } from '@/entities/scene-config'

import { curveIconPoints } from './curve-shape'

/** SVG nhỏ vẽ hình dạng minh hoạ của một cặp (nội suy, easing). Xem `curve-shape.ts`. */
export function CurveIcon({
  interpolation,
  easing,
  className,
}: {
  interpolation: Interpolation
  easing: Easing
  className?: string
}) {
  const points = curveIconPoints(interpolation, easing)
  const path = points
    .map(([t, y]) => `${(t * 100).toFixed(1)},${((1 - y) * 100).toFixed(1)}`)
    .join(' ')

  return (
    <svg viewBox="-15 -15 130 130" aria-hidden className={className}>
      <polyline points={path} fill="none" stroke="var(--color-curve-line)" strokeWidth={8} />
    </svg>
  )
}
