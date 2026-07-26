import path from 'node:path'

import type { ExportRegistry } from '../export-video'
import type { RenderRegistry } from '../render-queue'
import type { BlenderWorker } from '../worker-bridge/worker-process'

export interface AppContext {
  /** Gốc repo — mọi đường dẫn asset tương đối phân giải theo cái này. */
  root: string
  /** Nơi worker ghi ảnh preview; server phục vụ tĩnh từ đây. */
  previewDir: string
  worker: BlenderWorker
  /** Job render final — mỗi job một tiến trình Blender riêng. */
  renders: RenderRegistry
  /** Job export video — Chrome headless ghép, ffmpeg mã hoá. */
  exports: ExportRegistry
  /**
   * Cổng mà server đang lắng nghe. Cần vì trang export chạy ở origin của Vite, nên URL gửi
   * cho nó phải TUYỆT ĐỐI; đường tương đối sẽ trỏ về 5173 và 404.
   */
  port: number
}

export function previewDirFor(root: string): string {
  // Trong `cache/` vì đây là thứ sinh ra được, xoá bất cứ lúc nào. Mỗi dải góc là 72
  // ảnh nên thư mục này sẽ phình — chính sách dọn nằm ở Pha 10.
  return path.join(root, 'cache/preview')
}
