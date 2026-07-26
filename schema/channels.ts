/**
 * Danh sách kênh animation — phải khớp CHÍNH XÁC với `CHANNELS` trong
 * scripts/blender/anim.py. Lệch một tên là render ra thứ sai mà không ai báo.
 *
 * `scale` và `unit` ở đây chỉ để UI hiển thị và kiểm tra chéo; phép đổi đơn vị thật
 * do phía Python làm. Test `channels.test.ts` đối chiếu file này với anim.py.
 */

export const CHANNEL_KEYS = [
  'camera.azimuth',
  'camera.elevation',
  'camera.distance',
  'camera.focal',
  'device.spin_x',
  'device.spin_y',
  'device.spin_z',
  'world.hdri_rotation',
  'world.strength',
] as const

export type ChannelKey = (typeof CHANNEL_KEYS)[number]

export interface ChannelMeta {
  /** Nhóm để xếp layer timeline: hai layer cố định Device và Camera, cộng Lighting. */
  readonly group: 'camera' | 'device' | 'world'
  readonly unit: 'deg' | 'm' | 'mm' | ''
  /** Bước nhảy hợp lý khi kéo slider/spinner. */
  readonly step: number
  /** Giới hạn mềm cho UI. Không phải ràng buộc schema — animation được vượt ra ngoài. */
  readonly softMin: number
  readonly softMax: number
}

export const CHANNELS: Readonly<Record<ChannelKey, ChannelMeta>> = {
  'camera.azimuth': { group: 'camera', unit: 'deg', step: 1, softMin: -360, softMax: 360 },
  'camera.elevation': { group: 'camera', unit: 'deg', step: 1, softMin: -89, softMax: 89 },
  'camera.distance': { group: 'camera', unit: 'm', step: 0.01, softMin: 0.2, softMax: 5 },
  'camera.focal': { group: 'camera', unit: 'mm', step: 1, softMin: 14, softMax: 200 },
  'device.spin_x': { group: 'device', unit: 'deg', step: 1, softMin: -360, softMax: 360 },
  'device.spin_y': { group: 'device', unit: 'deg', step: 1, softMin: -360, softMax: 360 },
  'device.spin_z': { group: 'device', unit: 'deg', step: 1, softMin: -360, softMax: 360 },
  'world.hdri_rotation': { group: 'world', unit: 'deg', step: 1, softMin: -360, softMax: 360 },
  'world.strength': { group: 'world', unit: '', step: 0.05, softMin: 0, softMax: 10 },
}

/** 13 kiểu nội suy của Blender. Thứ tự khớp anim.py để so sánh dễ. */
export const INTERPOLATIONS = [
  'CONSTANT',
  'LINEAR',
  'BEZIER',
  'SINE',
  'QUAD',
  'CUBIC',
  'QUART',
  'QUINT',
  'EXPO',
  'CIRC',
  'BACK',
  'BOUNCE',
  'ELASTIC',
] as const

export const EASINGS = ['AUTO', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'] as const

export const HANDLE_TYPES = ['FREE', 'ALIGNED', 'VECTOR', 'AUTO', 'AUTO_CLAMPED'] as const

/** F-Modifier dùng được. CYCLES để lặp vô hạn, NOISE/STEPPED/LIMITS ít dùng hơn. */
export const MODIFIER_TYPES = ['CYCLES', 'NOISE', 'STEPPED', 'LIMITS'] as const

export type Interpolation = (typeof INTERPOLATIONS)[number]
export type Easing = (typeof EASINGS)[number]
export type HandleType = (typeof HANDLE_TYPES)[number]
export type ModifierType = (typeof MODIFIER_TYPES)[number]
