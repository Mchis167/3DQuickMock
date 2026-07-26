import { z } from 'zod'

import { screenClipSchema } from '@/entities/animation/screen-clip'
import { timelineSchema } from '@/entities/animation/timeline'
import { FIT_MODES } from '@/entities/screen-fit'
import { cameraSchema, channelsSchema, poseSchema, worldSchema } from '@schema/scene-config'

/**
 * Tài liệu đang mở — phần state ĐƯỢC undo (Architecture.md §6).
 *
 * Cố ý KHÔNG chứa URL preview, trạng thái đang render hay panel nào đang mở: những thứ
 * đó vào `uiStore`. Trộn chung thì Ctrl+Z sẽ đóng panel thay vì hoàn tác thao tác.
 *
 * Dùng lại schema của Pha 1 nên tài liệu luôn hợp lệ theo đúng nghĩa mà Blender hiểu.
 */
/**
 * Ảnh màn hình mặc định — cũng là thứ hiện lại khi người dùng XOÁ ảnh/video đã import.
 *
 * Có một chỗ nhìn thấy được để quay về là quan trọng: nếu xoá xong màn hình vẫn giữ ảnh cũ
 * thì người dùng không biết mình đã xoá được hay chưa.
 */
export const PLACEHOLDER_SCREEN = 'assets/test/uv_test.png'

export const mockupDocumentSchema = z
  .object({
    device: z.string().min(1).default('iphone-17-pro-max'),
    /** Ảnh ĐÃ khớp tỉ lệ, dán lên màn hình — đây là thứ Blender nhận. */
    screen: z.string().min(1).default(PLACEHOLDER_SCREEN),
    /** File người dùng import, trước khi khớp tỉ lệ. Giữ lại để đổi chế độ không cần import lại. */
    screenSource: z.string().min(1).nullable().default(null),
    fitMode: z.enum(FIT_MODES).default('fill'),
    camera: cameraSchema.prefault({}),
    pose: poseSchema.prefault({}),
    world: worldSchema.prefault({ hdri: 'assets/hdri/studio_small_03.hdr', strength: 0.6 }),
    /** Preset môi trường đang chọn, để UI đánh dấu thumbnail. */
    environmentId: z.string().default('studio_small_03'),
    /**
     * Chức năng đang làm: mockup tĩnh, hay video có animation.
     *
     * Thuộc TÀI LIỆU chứ không phải uiStore: mở lại project phải ra đúng thứ đã làm dở,
     * và chuyển chế độ phải Ctrl+Z lại được.
     */
    mode: z.enum(['static', 'video']).default('static'),
    timeline: timelineSchema.prefault({}),
    /**
     * Keyframe theo kênh. Rỗng ở chế độ tĩnh.
     *
     * Giữ lại khi quay về chế độ tĩnh — người dùng bấm nhầm nút rồi quay lại mà mất sạch
     * timeline thì Ctrl+Z là thứ duy nhất cứu được, và không ai tin vào điều đó.
     */
    channels: channelsSchema.prefault({}),
    /**
     * Video nằm ở ĐÂU trên timeline. Thuộc tài liệu vì nó là một quyết định dựng phim —
     * phải undo được và phải lưu cùng project.
     *
     * Chỉ có nghĩa ở chế độ video và khi đã import video; ở chế độ tĩnh video đi qua plate
     * (Pha 5) nên không có khái niệm vị trí trên trục thời gian.
     */
    screenClip: screenClipSchema.prefault({}),
  })
  .strict()

export type MockupDocument = z.infer<typeof mockupDocumentSchema>

export function createDocument(overrides: Partial<MockupDocument> = {}): MockupDocument {
  return mockupDocumentSchema.parse({ ...overrides })
}

/** Giá trị mặc định của TỪNG bộ, để nút reset riêng từng bộ có thứ để quay về. */
export const DEFAULT_CAMERA = cameraSchema.parse({})
export const DEFAULT_POSE = poseSchema.parse({})
