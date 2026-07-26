import { CHANNELS, CHANNEL_KEYS, type ChannelKey } from '@/entities/scene-config'

/**
 * Ba layer CỐ ĐỊNH của timeline — không thêm, không xoá, không đổi thứ tự.
 *
 * Vì sao cố định: mockup luôn chỉ có ba thứ động được (cái máy, cái camera, ánh sáng).
 * Cho phép tạo layer tuỳ ý là mượn mô hình của phần mềm dựng phim cho một bài toán
 * không có nó — người dùng phải tự nghĩ ra cấu trúc trước khi làm được việc.
 *
 * Nhãn ngắn tiếng Anh theo quy ước UI; giải thích để trong tooltip.
 */
export interface TimelineLayer {
  readonly id: 'device' | 'camera' | 'lighting'
  readonly label: string
  readonly hint: string
  readonly channels: readonly ChannelKey[]
}

const byGroup = (group: 'device' | 'camera' | 'world'): ChannelKey[] =>
  CHANNEL_KEYS.filter((key) => CHANNELS[key].group === group)

export const TIMELINE_LAYERS: readonly TimelineLayer[] = [
  {
    id: 'device',
    label: 'Device',
    hint: 'Xoay chính cái máy quanh ba trục',
    channels: byGroup('device'),
  },
  {
    id: 'camera',
    label: 'Camera',
    hint: 'Camera bay quanh máy: phương vị, độ cao, khoảng cách, tiêu cự',
    channels: byGroup('camera'),
  },
  {
    id: 'lighting',
    label: 'Lighting',
    hint: 'Xoay HDRI và cường độ sáng của môi trường',
    channels: byGroup('world'),
  },
]

export function layerOf(key: ChannelKey): TimelineLayer {
  const layer = TIMELINE_LAYERS.find((l) => l.channels.includes(key))
  // Không thể xảy ra nếu CHANNELS.group chỉ nhận ba giá trị — nhưng thêm kênh mới với
  // group mới mà quên thêm layer thì kênh đó sẽ biến mất khỏi timeline mà không báo.
  if (!layer) throw new Error(`kênh ${key} không thuộc layer nào`)
  return layer
}
