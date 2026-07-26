import {
  CHANNELS,
  type ChannelKey,
  type Easing,
  type Interpolation,
} from '@/entities/scene-config'
import type { ChannelSpec, Keyframe } from '@/entities/scene-config'

/**
 * Thao tác keyframe THUẦN — lõi của timeline, không biết gì về React hay immer.
 *
 * Các hàm ở đây SỬA TẠI CHỖ đối tượng truyền vào. Cố ý: store gọi chúng trên `draft` của
 * immer để lịch sử ghi được patch nhỏ ("keyframe thứ 3 đổi frame") thay vì một patch
 * thay cả `channels`. Patch thô thì undo vẫn đúng nhưng Pha 7 (curve editor, hàng trăm
 * thao tác nhỏ) sẽ phình bộ nhớ. Test gọi thẳng trên object thường nên vẫn thuần về
 * mặt kiểm chứng: cùng đầu vào cho cùng kết quả.
 *
 * Bất biến phải giữ ở MỌI đường ra (schema `channelSchema` bắt buộc, xem scene-config.ts):
 *   - keyframes sắp xếp tăng dần theo frame
 *   - không hai keyframe cùng frame
 *   - channel tồn tại thì có ít nhất một keyframe
 * Vi phạm bất kỳ điều nào là config bị Blender từ chối SAU khi người dùng đã dựng xong
 * cả timeline — nên chặn ngay tại đây.
 */
export type Channels = Partial<Record<ChannelKey, ChannelSpec>>

/** Frame đầu tiên của Blender là 1, không phải 0. Lệch chỗ này là lệch cả timeline. */
export const FIRST_FRAME = 1

export interface KeyframeInit {
  interpolation?: Interpolation
  easing?: Easing
}

const DEFAULT_INTERPOLATION: Interpolation = 'BEZIER'
const DEFAULT_EASING: Easing = 'AUTO'

export function clampFrame(frame: number, lastFrame: number): number {
  const rounded = Math.round(frame)
  if (!Number.isFinite(rounded)) return FIRST_FRAME
  return Math.min(Math.max(rounded, FIRST_FRAME), Math.max(lastFrame, FIRST_FRAME))
}

/**
 * Đặt một keyframe tại `frame`.
 *
 * Đã có keyframe ở đúng frame đó thì GHI ĐÈ giá trị, giữ nguyên kiểu nội suy — giống
 * Blender: bấm I hai lần ở cùng frame không tạo ra hai key chồng nhau.
 */
export function setKeyframe(
  channels: Channels,
  key: ChannelKey,
  frame: number,
  value: number,
  init: KeyframeInit = {},
): void {
  if (!Number.isFinite(value)) throw new Error(`giá trị keyframe không hữu hạn: ${value}`)
  const at = Math.round(frame)
  const channel = channels[key]

  if (!channel) {
    channels[key] = {
      keyframes: [makeKeyframe(at, value, init)],
      extrapolation: 'CONSTANT',
      modifiers: [],
    }
    return
  }

  const existing = channel.keyframes.findIndex((k) => k.frame === at)
  if (existing >= 0) {
    const kf = channel.keyframes[existing]
    if (kf) {
      kf.value = value
      if (init.interpolation) kf.interpolation = init.interpolation
      if (init.easing) kf.easing = init.easing
    }
    return
  }

  channel.keyframes.push(makeKeyframe(at, value, init))
  sortKeyframes(channel)
}

/**
 * Dời một keyframe sang frame khác (và tuỳ chọn đổi giá trị).
 *
 * Kéo đè lên một keyframe khác thì keyframe bị đè BIẾN MẤT — đúng như Blender. Cách còn
 * lại (từ chối di chuyển) khiến kéo chuột bị "dính" mà không giải thích được vì sao.
 *
 * Trả về frame thật sự sau khi kẹp, để UI biết con trỏ đang ở đâu.
 */
export function moveKeyframe(
  channels: Channels,
  key: ChannelKey,
  from: number,
  to: number,
  lastFrame: number,
  value?: number,
): number {
  const channel = channels[key]
  if (!channel) return from
  const index = channel.keyframes.findIndex((k) => k.frame === Math.round(from))
  const moving = channel.keyframes[index]
  if (!moving) return from

  const target = clampFrame(to, lastFrame)
  if (target !== moving.frame) {
    const occupied = channel.keyframes.findIndex((k) => k.frame === target)
    if (occupied >= 0) channel.keyframes.splice(occupied, 1)
  }

  moving.frame = target
  if (value !== undefined) {
    if (!Number.isFinite(value)) throw new Error(`giá trị keyframe không hữu hạn: ${value}`)
    moving.value = value
  }
  sortKeyframes(channel)
  return target
}

/**
 * Xoá keyframe. Xoá cái CUỐI CÙNG của một kênh thì xoá luôn cả kênh: `channelSchema` đòi
 * tối thiểu một keyframe, nên để lại kênh rỗng là để lại một config Blender từ chối.
 */
export function removeKeyframe(channels: Channels, key: ChannelKey, frame: number): void {
  const channel = channels[key]
  if (!channel) return
  const index = channel.keyframes.findIndex((k) => k.frame === Math.round(frame))
  if (index < 0) return
  channel.keyframes.splice(index, 1)
  if (channel.keyframes.length === 0) delete channels[key]
}

export function setKeyframeInterpolation(
  channels: Channels,
  key: ChannelKey,
  frame: number,
  interpolation: Interpolation,
  easing: Easing,
): void {
  const kf = channels[key]?.keyframes.find((k) => k.frame === Math.round(frame))
  if (!kf) return
  kf.interpolation = interpolation
  kf.easing = easing
}

/** Keyframe tại đúng frame này, nếu có. Dùng để UI biết nút "thêm key" đang bật hay tắt. */
export function keyframeAt(
  channels: Channels,
  key: ChannelKey,
  frame: number,
): Keyframe | undefined {
  return channels[key]?.keyframes.find((k) => k.frame === Math.round(frame))
}

/** Một keyframe cụ thể, nhận diện bằng (kênh, frame) — đơn vị của một vùng chọn nhiều key. */
export interface ChannelFrame {
  readonly channel: ChannelKey
  readonly frame: number
}

/**
 * Mọi keyframe của `keys` rơi vào [a, b] (bao gồm hai đầu, thứ tự a/b không quan trọng).
 *
 * Dùng cho marquee: kéo một ô chọn trên track thì mọi viên kim cương nằm trong đó phải
 * vào một nhóm, kể cả khi chúng thuộc nhiều kênh khác nhau trên cùng dòng layer.
 */
export function keyframesInRange(
  channels: Channels,
  keys: readonly ChannelKey[],
  a: number,
  b: number,
): ChannelFrame[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const refs: ChannelFrame[] = []
  for (const key of keys) {
    for (const kf of channels[key]?.keyframes ?? []) {
      if (kf.frame >= lo && kf.frame <= hi) refs.push({ channel: key, frame: kf.frame })
    }
  }
  return refs
}

/**
 * Dời NHIỀU keyframe (có thể khác kênh, khác frame gốc) cùng một ĐỘ LỆCH, trong một bước.
 *
 * Vì sao cần riêng khỏi `moveKeyframe`: kéo một nhóm đã chọn phải giữ nguyên khoảng cách
 * tương đối giữa các key — kẹp từng cái ở hai đầu timeline theo `to` tuyệt đối như cũ sẽ
 * làm cả cụm biến dạng ngay khi một key chạm biên.
 *
 * Sắp theo hướng dời trước khi áp: dời sang phải thì xử lý từ frame lớn nhất trước, dời
 * sang trái thì xử lý từ frame nhỏ nhất trước — để một key vừa dời đến không bị đọc nhầm
 * làm nguồn của một cặp khác trong CÙNG kênh ở lượt sau.
 */
export function moveKeyframeGroup(
  channels: Channels,
  refs: readonly ChannelFrame[],
  delta: number,
  lastFrame: number,
): ChannelFrame[] {
  if (delta === 0) return refs.map((ref) => ({ ...ref }))
  const ordered = [...refs].sort((a, b) => (delta > 0 ? b.frame - a.frame : a.frame - b.frame))
  const moved = new Map<ChannelFrame, ChannelFrame>()
  for (const ref of ordered) {
    const to = moveKeyframe(channels, ref.channel, ref.frame, ref.frame + delta, lastFrame)
    moved.set(ref, { channel: ref.channel, frame: to })
  }
  return refs.map((ref) => moved.get(ref) ?? { ...ref })
}

/** Xoá cả một nhóm keyframe (marquee + Delete) trong một lượt. */
export function removeKeyframeGroup(channels: Channels, refs: readonly ChannelFrame[]): void {
  for (const ref of refs) removeKeyframe(channels, ref.channel, ref.frame)
}

/** Áp cùng một kiểu nội suy cho cả nhóm — đổi easing hàng loạt thay vì từng viên một. */
export function setInterpolationGroup(
  channels: Channels,
  refs: readonly ChannelFrame[],
  interpolation: Interpolation,
  easing: Easing,
): void {
  for (const ref of refs) setKeyframeInterpolation(channels, ref.channel, ref.frame, interpolation, easing)
}

/** Mọi frame có ít nhất một keyframe, trên toàn bộ các kênh — để vẽ thước và nhảy key. */
export function keyedFrames(channels: Channels, keys?: readonly ChannelKey[]): number[] {
  const wanted = keys ?? (Object.keys(channels) as ChannelKey[])
  const frames = new Set<number>()
  for (const key of wanted) {
    for (const kf of channels[key]?.keyframes ?? []) frames.add(kf.frame)
  }
  return [...frames].sort((a, b) => a - b)
}

export function hasAnimation(channels: Channels): boolean {
  return Object.keys(channels).length > 0
}

function makeKeyframe(frame: number, value: number, init: KeyframeInit): Keyframe {
  return {
    frame,
    value,
    interpolation: init.interpolation ?? DEFAULT_INTERPOLATION,
    easing: init.easing ?? DEFAULT_EASING,
  }
}

function sortKeyframes(channel: ChannelSpec): void {
  channel.keyframes.sort((a, b) => a.frame - b.frame)
}

// ------------------------------------------------------------------ cảnh báo loop

/**
 * Kênh có phải một vòng quay tròn khép kín không: kênh góc, và tổng chênh lệch đầu–cuối
 * là bội số nguyên của 360°.
 */
const LOOP_TOLERANCE_DEG = 0.5

export interface LoopWarning {
  readonly channel: ChannelKey
  readonly turns: number
  readonly message: string
}

/**
 * Cảnh báo khi dùng easing trên một vòng 360°.
 *
 * Vì sao đáng cảnh báo: vòng 360° gần như luôn để phát lặp. Nội suy BEZIER (mặc định)
 * làm vận tốc bằng 0 ở keyframe đầu và cuối, nên chỗ nối giữa lần lặp thứ n và n+1 có
 * một cú KHỰNG. Trên preview 5 giây chạy một lượt thì không ai thấy; nó chỉ lộ ra khi
 * clip đã export và đem đi phát lặp — tức là muộn nhất có thể.
 *
 * Chỉ LINEAR mới nối liền được. Đây là cảnh báo, không phải lỗi: người dùng có thể cố ý
 * muốn một vòng quay có tăng-giảm tốc.
 */
export function loopWarnings(channels: Channels): LoopWarning[] {
  const warnings: LoopWarning[] = []
  for (const [key, channel] of Object.entries(channels) as [ChannelKey, ChannelSpec][]) {
    if (CHANNELS[key].unit !== 'deg') continue
    const first = channel.keyframes[0]
    const last = channel.keyframes[channel.keyframes.length - 1]
    if (!first || !last || channel.keyframes.length < 2) continue

    const delta = Math.abs(last.value - first.value)
    if (delta < 360 - LOOP_TOLERANCE_DEG) continue
    const turns = Math.round(delta / 360)
    if (Math.abs(delta - turns * 360) > LOOP_TOLERANCE_DEG) continue

    const eased = channel.keyframes.filter((k) => k.interpolation !== 'LINEAR')
    if (eased.length === 0) continue

    warnings.push({
      channel: key,
      turns,
      message: `${key} quay ${turns}×360° nhưng dùng nội suy ${eased[0]?.interpolation}. Khi phát lặp sẽ khựng ở chỗ nối — đổi sang LINEAR nếu định loop.`,
    })
  }
  return warnings
}
