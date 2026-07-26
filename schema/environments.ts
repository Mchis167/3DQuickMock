import { z } from 'zod'

/**
 * Thư viện môi trường HDRI, nguồn là `assets/hdri/presets.json`.
 *
 * `strength` trong file đó ĐÃ hiệu chuẩn để mọi preset cho độ phơi sáng tương đương
 * (mốc: studio_small_03 @ 0.6). UI phải dùng đúng số này khi đổi preset, nếu tự đặt
 * 1.0 thì đổi môi trường sẽ nhảy sáng — một trong các tiêu chí "xong" của Pha 3.
 */
export const environmentPresetSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().default(''),
    hdri: z.string().min(1),
    strength: z.number().min(0).max(50),
    rotation: z.number().default(0),
    thumbnail: z.string().min(1),
    builtin: z.boolean().default(true),
  })
  .strict()

export const environmentLibrarySchema = z
  .object({
    _comment: z.string().optional(),
    /** Mốc hiệu chuẩn — giữ lại để biết số `strength` sinh ra từ đâu. */
    reference: z
      .object({
        id: z.string(),
        strength: z.number(),
        luminance: z.number(),
      })
      .strict(),
    presets: z.array(environmentPresetSchema).min(1),
  })
  .strict()

export type EnvironmentPreset = z.infer<typeof environmentPresetSchema>
export type EnvironmentLibrary = z.infer<typeof environmentLibrarySchema>
