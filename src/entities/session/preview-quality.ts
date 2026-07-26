/**
 * Bốn mức độ nét của preview — dùng chung cho preview tĩnh và dải ảnh phát lại.
 *
 * Nằm ở `entities` chứ không trong một feature: cả `static-mockup` (preview tĩnh) và
 * `video-editor` (RAM preview) đều cần đúng bộ số này, mà hai feature thì không được
 * import nhau. Chép sang mỗi bên một bản là để chúng trôi dần khỏi nhau.
 */
export interface PreviewQuality {
  engine: 'eevee' | 'cycles'
  res: [number, number]
  samples: number
}

/**
 * Bốn mức độ nét của preview.
 *
 * Luôn là EEVEE: đây là vòng lặp tương tác, Cycles để cho export. Tăng mức là tăng CẢ độ
 * phân giải và số samples — độ phân giải cho nét hình, samples cho hết nhiễu; thiếu một
 * trong hai thì ảnh vẫn trông rẻ tiền.
 *
 * Các số này là hằng ở tầng module nên tham chiếu object ỔN ĐỊNH — `usePreview` đưa nó vào
 * dependency của effect, tạo object mới mỗi lần render sẽ thành vòng lặp render vô hạn.
 *
 * Chi phí ĐO THẬT (2026-07-25, EEVEE, worker đã ấm, `studio_small_03`, trung vị 3 lần):
 *
 *   low  360×480   8 spp →  134 ms
 *   med  480×640  16 spp →  239 ms   ← mặc định, nằm trong ngưỡng ~250ms của Pha 3
 *   high 720×960  32 spp →  485 ms
 *   max 1080×1440 64 spp → 1287 ms   ← kéo slider sẽ thấy trễ rõ; hàng đợi mới-nhất-thắng
 *                                      giữ cho nó không dồn đống, nhưng phản hồi vẫn chậm
 */
export const PREVIEW_QUALITIES = {
  low: { engine: 'eevee', res: [360, 480], samples: 8 },
  med: { engine: 'eevee', res: [480, 640], samples: 16 },
  high: { engine: 'eevee', res: [720, 960], samples: 32 },
  max: { engine: 'eevee', res: [1080, 1440], samples: 64 },
} as const satisfies Record<string, PreviewQuality>

export type PreviewQualityLevel = keyof typeof PREVIEW_QUALITIES

/** Draft: EEVEE, KHÔNG có contact shadow — UI phải nói rõ điều đó. */
export const DRAFT_QUALITY: PreviewQuality = PREVIEW_QUALITIES.med
