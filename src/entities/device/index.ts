/**
 * Metadata thiết bị. Số đo lấy từ bound_box THẬT của model, không phải thông số
 * marketing của Apple — vì `frame_fill` phía Blender tính theo bound_box đó.
 *
 * Đo bằng `scripts/blender/scene_lib.build_once()` ngày 2026-07-25. Đổi model thì phải
 * đo lại: `fitFrameFill()` sẽ lệch âm thầm chứ không báo lỗi.
 */
export interface DeviceSpec {
  readonly id: string
  readonly label: string
  /** Bao ngoài toàn máy, mm. `depth` gồm cả cụm camera lồi. */
  readonly dimsMm: { readonly width: number; readonly depth: number; readonly height: number }
  /** Mesh màn hình, mm — phần dán ảnh app vào. */
  readonly screenMm: { readonly width: number; readonly height: number }
}

export const IPHONE_17_PRO_MAX: DeviceSpec = {
  id: 'iphone-17-pro-max',
  label: 'iPhone 17 Pro Max',
  dimsMm: { width: 79.115, depth: 13.487, height: 163.081 },
  screenMm: { width: 73.0, height: 158.0 },
}

export const DEVICES: readonly DeviceSpec[] = [IPHONE_17_PRO_MAX]

export function deviceById(id: string): DeviceSpec | undefined {
  return DEVICES.find((device) => device.id === id)
}

export { cameraUpVector, projectedHeightRatio, fitFrameFill } from './framing'
export type { FramingCamera, FramingPose } from './framing'
