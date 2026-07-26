import { keyframeAt } from '@/entities/animation/keyframes'
import { CHANNEL_KEYS, type ChannelKey } from '@schema/channels'

import { CHANNEL_BINDING } from './channel-binding'
import type { MockupDocument } from './document'

/**
 * Tài liệu tại MỘT frame: giá trị nền, ghi đè bởi đường cong ở những kênh có animation.
 *
 * Thuần và không biết mạng — mẫu (`samples`) do worker Blender tính rồi truyền vào. Đây
 * là chỗ duy nhất trộn "giá trị người dùng đặt" với "giá trị đường cong", nên chỉ có một
 * chỗ để sai.
 *
 * Thứ tự ưu tiên, và lý do:
 *
 *  1. **Keyframe nằm ĐÚNG frame này.** Giá trị của đường cong tại một keyframe chính là
 *     giá trị của keyframe đó — đúng với cả 13 kiểu nội suy, không phải phép xấp xỉ. Nhờ
 *     vậy vừa đặt/sửa keyframe là preview đổi NGAY, không phải chờ worker lấy mẫu lại.
 *     Không có nhánh này thì người dùng xoay máy, thấy hình đứng im, và tưởng nó hỏng.
 *  2. Mẫu từ worker, cho các frame nằm GIỮA hai keyframe.
 *  3. Giá trị nền, cho kênh không có animation.
 */
export type CurveSamples = Partial<Record<ChannelKey, readonly number[]>>

export function evaluateAt(
  document: MockupDocument,
  samples: CurveSamples | null,
  frame: number,
): MockupDocument {
  const { channels } = document
  if (!samples && Object.keys(channels).length === 0) return document

  // Chép nông từng bộ: `writeChannel` sửa tại chỗ, mà tài liệu trong store là bất biến.
  const evaluated: MockupDocument = {
    ...document,
    camera: { ...document.camera },
    pose: { ...document.pose },
    world: { ...document.world },
  }

  let touched = false
  for (const key of CHANNEL_KEYS) {
    if (!channels[key]) continue

    const exact = keyframeAt(channels, key, frame)
    // Mẫu đánh chỉ số theo frame 1-based, đúng như Blender đếm.
    const sampled = samples?.[key]?.[frame - 1]
    const value = exact ? exact.value : sampled

    // Thiếu cả hai (đang lấy mẫu lại, hoặc timeline vừa dài ra) thì giữ giá trị nền chứ
    // KHÔNG dùng mẫu gần nhất: hiện một con số sai còn tệ hơn hiện con số cũ.
    if (value === undefined || !Number.isFinite(value)) continue
    CHANNEL_BINDING[key].write(evaluated, value)
    touched = true
  }

  return touched ? evaluated : document
}
