/**
 * Dựng tham số ffmpeg cho export video. Hàm THUẦN để test được mà không cần chạy ffmpeg.
 *
 * Ràng buộc quan trọng nhất, và là một cổng của Pha 5: ffmpeg **chỉ mã hoá**. Nó không tham
 * gia phép ghép và không giải mã video nguồn. Toàn bộ hình ảnh đã được ghép xong ở Chrome và
 * đi vào đây dưới dạng RGBA thô qua stdin.
 *
 * Kế hoạch gốc định để ffmpeg ghép lại lần nữa ở server. Hai lý do bỏ:
 *  - `remap` của ffmpeg chỉ lấy mẫu nearest và âm thầm ép toạ độ float xuống 16-bit nguyên;
 *  - so bản ffmpeg với bản WebGL là so qua HAI bộ giải mã video khác nhau — cùng một khung
 *    hình mà lệch tb 2.3-9.5/255, chỉ 24-47% pixel trùng. Ngưỡng nào đặt ở đó cũng vô nghĩa.
 *
 * Vì thế: **đúng một `-i`, và nó phải là `pipe:0`**. `tests/single-source.test.ts` cưỡng chế.
 */

export interface EncodeSpec {
  width: number
  height: number
  fps: number
  /** Đường ra tuyệt đối. Đuôi file quyết định codec. */
  output: string
}

export type Container = 'mov' | 'mp4' | 'webm'

export function containerFor(output: string): Container {
  const ext = output.split('.').pop()?.toLowerCase()
  if (ext === 'mov' || ext === 'mp4' || ext === 'webm') return ext
  throw new Error(`đuôi file không hỗ trợ: ${output}`)
}

export function ffmpegArgs(spec: EncodeSpec): string[] {
  const container = containerFor(spec.output)
  const input = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    // Chrome trả premultiplied RGBA (context dựng với `premultipliedAlpha: true`). Nói thẳng
    // cho ffmpeg biết, nếu không mép mockup sẽ có viền tối trên nền sáng.
    '-pix_fmt',
    'rgba',
    '-s',
    `${spec.width}x${spec.height}`,
    '-r',
    String(spec.fps),
    '-i',
    'pipe:0',
  ]

  const codec: Record<Container, string[]> = {
    // ProRes 4444 là định dạng giữ alpha mà PRD đã chốt cho turntable.
    mov: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'],
    // mp4 KHÔNG giữ được alpha — nền trong suốt sẽ thành đen. UI phải nói trước.
    mp4: ['-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p'],
    webm: ['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-pix_fmt', 'yuva420p'],
  }

  return [...input, ...codec[container], spec.output]
}

/** Alpha có sống sót qua container này không — UI cần cảnh báo trước khi người dùng đợi xong. */
export function keepsAlpha(output: string): boolean {
  return containerFor(output) !== 'mp4'
}
