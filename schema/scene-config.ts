import { z } from 'zod'

import { CHANNEL_KEYS, EASINGS, HANDLE_TYPES, INTERPOLATIONS, MODIFIER_TYPES } from './channels'

/**
 * NGUỒN SỰ THẬT DUY NHẤT của config scene. (Architecture.md §5)
 *
 * Từ đây sinh ra:
 *   - kiểu TypeScript cho UI và server (z.infer)
 *   - JSON Schema (`pnpm schema:gen`) cho scripts/blender/validate_config.py
 *
 * Vì sao đặt nặng: dự án đã gặp bốn lỗi im lặng, tất cả đều render "thành công" rồi
 * mới lộ ra khi nhìn ảnh. Schema lệch giữa TS và Python sẽ tạo đúng loại lỗi đó.
 *
 * Mọi object đều `.strict()` — gõ sai tên field phải BÁO LỖI, không được im lặng
 * dùng giá trị mặc định.
 */

export const SCHEMA_VERSION = 1

/** Field ghi chú cho người đọc file JSON; hai config mẫu đang dùng. */
const comment = z.string().optional()

// --------------------------------------------------------------------- keyframe

const handleSchema = z
  .object({
    /** Cùng không gian (frame, value) với Blender — xem đầu anim.py. */
    frame: z.number(),
    value: z.number(),
    type: z.enum(HANDLE_TYPES).default('ALIGNED'),
  })
  .strict()

export const keyframeSchema = z
  .object({
    frame: z.number().finite(),
    value: z.number().finite(),
    interpolation: z.enum(INTERPOLATIONS).default('BEZIER'),
    easing: z.enum(EASINGS).default('AUTO'),
    handle_left: handleSchema.optional(),
    handle_right: handleSchema.optional(),
  })
  .strict()

export const channelSchema = z
  .object({
    keyframes: z
      .array(keyframeSchema)
      .min(1)
      .refine(
        (kfs) => kfs.every((k, i) => i === 0 || k.frame > (kfs[i - 1]?.frame ?? -Infinity)),
        {
          // Python sort lại được, nhưng nếu UI gửi thứ tự sai thì tay cầm bezier đã
          // gắn nhầm keyframe từ trước — sort không cứu được, phải chặn ở đây.
          message: 'keyframes phải sắp xếp tăng dần theo frame và không trùng frame',
        },
      ),
    extrapolation: z.enum(['CONSTANT', 'LINEAR']).default('CONSTANT'),
    modifiers: z.array(z.object({ type: z.enum(MODIFIER_TYPES) }).strict()).default([]),
  })
  .strict()

export const channelsSchema = z.partialRecord(z.enum(CHANNEL_KEYS), channelSchema)

// ----------------------------------------------------------------------- render

export const renderSchema = z
  .object({
    engine: z.enum(['cycles', 'eevee']).default('cycles'),
    /** 48 là con số đã đo: dưới mức đó nhiễu nhấp nháy giữa các frame. PRD §4. */
    samples: z.int().min(1).max(4096).default(48),
    res: z.tuple([z.int().min(2).max(8192), z.int().min(2).max(8192)]).default([1080, 1440]),
    fps: z.int().min(1).max(240).default(30),
    duration: z.number().positive().max(600).optional(),
    /** Ghi đè duration nếu có — số frame tuyệt đối. */
    frames: z.int().min(1).max(36000).optional(),
    view_transform: z.enum(['AgX', 'Filmic', 'Standard', 'Khronos PBR Neutral']).optional(),
  })
  .strict()

// ------------------------------------------------------------------------ world

export const worldSchema = z
  .object({
    hdri: z.string().min(1),
    /** Đã hiệu chuẩn theo assets/hdri/presets.json để đổi preset không nhảy sáng. */
    strength: z.number().min(0).max(50).default(1),
    rotation: z.number().default(0),
    /** Card phản chiếu phụ; 0 = tắt. */
    reflector_strength: z.number().min(0).max(50).default(0),
  })
  .strict()

// ----------------------------------------------------------------------- camera

export const cameraSchema = z
  .object({
    azimuth: z.number().default(0),
    /** Trên 89 độ thì rig TRACK_TO mất trục tham chiếu và camera lật. */
    elevation: z.number().min(-89).max(89).default(10),
    /** Tỉ lệ chiều cao khung hình mà thiết bị chiếm. Quy về distance ở phía Blender. */
    frame_fill: z.number().gt(0).max(1).default(0.72),
    focal: z.number().min(5).max(500).default(85),
    target_z_offset: z.number().default(0),
  })
  .strict()

// ------------------------------------------------------------------------- pose

/**
 * Hướng đặt của THIẾT BỊ (khác camera: camera bay quanh, pose xoay chính cái máy).
 *
 * `ground = true` hạ máy xuống đúng chạm mặt phẳng sau khi xoay. Không có nó thì
 * nghiêng máy ở chế độ đứng trên sàn sẽ cắm xuyên sàn — và ở draft EEVEE mặt phẳng bị
 * ẩn nên mắt không thấy gì sai cho tới lúc render Cycles.
 */
export const poseSchema = z
  .object({
    spin_x: z.number().default(0),
    spin_y: z.number().default(0),
    spin_z: z.number().default(0),
    ground: z.boolean().default(true),
  })
  .strict()

// ----------------------------------------------------------------------- output

export const outputSchema = z
  .object({
    dir: z.string().min(1),
    name: z.string().min(1).default('still'),
  })
  .strict()

// ------------------------------------------------------------------ scene config

export const sceneConfigSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    device: z.string().min(1).default('iphone-17-pro-max'),
    /** Ảnh dán vào màn hình. Phía design lo tỉ lệ; Blender chỉ stretch full frame. */
    screen: z.string().min(1),
    render: renderSchema.prefault({}),
    world: worldSchema,
    camera: cameraSchema.prefault({}),
    pose: poseSchema.prefault({}),
    output: outputSchema,
    channels: channelsSchema.prefault({}),
    _comment: comment,
  })
  .strict()
  .refine(
    (c) =>
      !(c.render.frames === undefined && c.render.duration === undefined) ||
      !hasChannels(c.channels),
    {
      // Có animation mà không biết dài bao nhiêu thì Blender lặng lẽ render đúng 1 frame.
      message: 'config có channels thì render.duration hoặc render.frames là bắt buộc',
      path: ['render', 'duration'],
    },
  )

function hasChannels(channels: Record<string, unknown>): boolean {
  return Object.keys(channels).length > 0
}

export type SceneConfig = z.infer<typeof sceneConfigSchema>
export type SceneConfigInput = z.input<typeof sceneConfigSchema>
export type Keyframe = z.infer<typeof keyframeSchema>
export type ChannelSpec = z.infer<typeof channelSchema>
export type RenderSettings = z.infer<typeof renderSchema>
export type CameraSettings = z.infer<typeof cameraSchema>
export type PoseSettings = z.infer<typeof poseSchema>
export type WorldSettings = z.infer<typeof worldSchema>

// -------------------------------------------------------------------- migration

/**
 * Nâng cấp config cũ lên SCHEMA_VERSION hiện tại.
 *
 * Hiện chỉ có version 1 nên không có bước nào. Khung này để sẵn vì thêm sau khi đã
 * có project lưu trên đĩa thì phải đoán ngược version — tốn hơn nhiều.
 */
export function migrateConfig(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const cfg = { ...(raw as Record<string, unknown>) }
  // Config viết tay trước khi có schemaVersion được coi là version 1.
  cfg['schemaVersion'] ??= 1
  return cfg
}

/** Đọc + migrate + validate. Đây là cửa duy nhất nên dùng để nạp config. */
export function parseSceneConfig(raw: unknown): SceneConfig {
  return sceneConfigSchema.parse(migrateConfig(raw))
}

export function safeParseSceneConfig(raw: unknown) {
  return sceneConfigSchema.safeParse(migrateConfig(raw))
}
