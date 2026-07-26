import type { ChannelKey } from '@schema/channels'

import type { MockupDocument } from './document'

/**
 * Cầu nối giữa TÊN KÊNH animation và Ô GIÁ TRỊ trong tài liệu.
 *
 * Cần hai chiều:
 *   - đọc: bấm "thêm keyframe" là chốt lại giá trị đang hiển thị
 *   - ghi: tua timeline là đổ giá trị đã lấy mẫu ngược vào tài liệu, để camera và slider
 *     cùng nói một chuyện
 *
 * Vì sao là một bảng tra tường minh chứ không phải tách chuỗi `'camera.azimuth'.split('.')`:
 * tên kênh do Blender quy định (`anim.py`), tên field do schema quy định. Hai bên đang
 * trùng nhau, nhưng chúng KHÔNG buộc phải trùng — `camera.distance` chẳng hạn không có
 * field tương ứng, nó quy về `frame_fill`. Tách chuỗi sẽ im lặng trả về undefined ở đúng
 * những kênh lệch tên.
 */
type Accessor = {
  readonly read: (doc: MockupDocument) => number
  readonly write: (draft: MockupDocument, value: number) => void
}

export const CHANNEL_BINDING: Readonly<Record<ChannelKey, Accessor>> = {
  'camera.azimuth': {
    read: (d) => d.camera.azimuth,
    write: (d, v) => {
      d.camera.azimuth = v
    },
  },
  'camera.elevation': {
    read: (d) => d.camera.elevation,
    write: (d, v) => {
      // Trên 89° rig TRACK_TO mất trục tham chiếu và camera lật. Kẹp ở đây thay vì để
      // schema ném lỗi: giá trị này đến từ đường cong, người dùng không gõ trực tiếp.
      d.camera.elevation = Math.min(89, Math.max(-89, v))
    },
  },
  'camera.distance': {
    // Tài liệu không lưu khoảng cách mà lưu `frame_fill` (tỉ lệ chiều cao khung hình mà
    // máy chiếm); phía Blender quy đổi. Kênh này animate được nhưng KHÔNG có ô nào trong
    // tài liệu phản chiếu nó, nên đọc/ghi qua frame_fill là sai đơn vị. Xem ghi chú dưới.
    read: (d) => d.camera.frame_fill,
    write: (d, v) => {
      d.camera.frame_fill = Math.min(1, Math.max(0.01, v))
    },
  },
  'camera.focal': {
    read: (d) => d.camera.focal,
    write: (d, v) => {
      d.camera.focal = Math.min(500, Math.max(5, v))
    },
  },
  'device.spin_x': {
    read: (d) => d.pose.spin_x,
    write: (d, v) => {
      d.pose.spin_x = v
    },
  },
  'device.spin_y': {
    read: (d) => d.pose.spin_y,
    write: (d, v) => {
      d.pose.spin_y = v
    },
  },
  'device.spin_z': {
    read: (d) => d.pose.spin_z,
    write: (d, v) => {
      d.pose.spin_z = v
    },
  },
  'world.hdri_rotation': {
    read: (d) => d.world.rotation,
    write: (d, v) => {
      d.world.rotation = v
    },
  },
  'world.strength': {
    read: (d) => d.world.strength,
    write: (d, v) => {
      d.world.strength = Math.min(50, Math.max(0, v))
    },
  },
}

/**
 * Kênh KHÔNG animate được từ UI ở Pha 6.
 *
 * `camera.distance` là mét trong Blender, còn tài liệu chỉ có `frame_fill` (tỉ lệ khung
 * hình). Cho bấm keyframe lên nó thì UI sẽ chốt một con số sai đơn vị, và sai đó chỉ lộ
 * ra sau khi render. Ẩn hẳn khỏi timeline cho tới khi có phép quy đổi thật.
 */
export const UNBOUND_CHANNELS: readonly ChannelKey[] = ['camera.distance']

export function isAnimatable(key: ChannelKey): boolean {
  return !UNBOUND_CHANNELS.includes(key)
}

/**
 * Field trong tài liệu → tên kênh animation, tra theo từng bộ.
 *
 * Dùng cho auto-key: `setPose({ spin_z: 30 })` phải biết rằng nó đang chạm vào kênh
 * `device.spin_z`. Field không có trong bảng (`ground`, `target_z_offset`) là field
 * KHÔNG animate được — chúng đi thẳng vào giá trị nền như cũ.
 */
export const GROUP_CHANNELS = {
  camera: {
    azimuth: 'camera.azimuth',
    elevation: 'camera.elevation',
    focal: 'camera.focal',
  },
  pose: {
    spin_x: 'device.spin_x',
    spin_y: 'device.spin_y',
    spin_z: 'device.spin_z',
  },
  world: {
    rotation: 'world.hdri_rotation',
    strength: 'world.strength',
  },
} as const satisfies Record<string, Record<string, ChannelKey>>

export type ChannelGroup = keyof typeof GROUP_CHANNELS

/**
 * `frame_fill` CỐ Ý không có trong bảng trên dù `camera.distance` là kênh animate được:
 * hai thứ khác đơn vị (tỉ lệ khung hình vs mét), xem `UNBOUND_CHANNELS`.
 */
export function channelOf(group: ChannelGroup, field: string): ChannelKey | undefined {
  return (GROUP_CHANNELS[group] as Record<string, ChannelKey | undefined>)[field]
}

export function readChannel(document: MockupDocument, key: ChannelKey): number {
  return CHANNEL_BINDING[key].read(document)
}

export function writeChannel(draft: MockupDocument, key: ChannelKey, value: number): void {
  CHANNEL_BINDING[key].write(draft, value)
}
