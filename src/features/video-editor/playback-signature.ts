import type { MockupDocument } from '@/entities/scene-config/document'
import type { PreviewQualityLevel } from '@/entities/session'

/**
 * Vân tay của mọi thứ ảnh hưởng tới dải ảnh phát lại.
 *
 * Đổi bất cứ thứ gì trong đây là dải cũ hết hiệu lực. Không kiểm thì người dùng xoay máy,
 * bấm phát, và thấy một đoạn phim **mượt, đúng nhịp, và sai cấu hình** — không có gì báo.
 * Plate của Pha 5 đã sập đúng bẫy này một lần, nên đây là bản sao có ý thức của cách chữa.
 *
 * `channels` phải vào: nó chính là chuyển động. `screen` phải vào: ảnh trên màn hình nằm
 * trong từng frame đã render. `mode` và `playhead` KHÔNG vào — chúng không đổi nội dung
 * một frame nào.
 */
export function playbackSignature(
  document: MockupDocument,
  quality: PreviewQualityLevel,
  screenSequence?: { dir: string; frames: number } | null,
): string {
  return JSON.stringify({
    camera: document.camera,
    pose: document.pose,
    world: document.world,
    screen: document.screen,
    channels: document.channels,
    timeline: document.timeline,
    // Vị trí clip và dải PNG đang dùng: dời clip là mọi frame đổi ảnh màn hình. Không đưa
    // vào vân tay thì kéo thanh clip xong bấm phát sẽ chiếu lại dải CŨ, mượt và sai.
    screenClip: document.screenClip,
    screenSequence: screenSequence ?? null,
    quality,
  })
}
