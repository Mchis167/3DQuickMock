/**
 * Kho ảnh đã GIẢI MÃ của dải phát lại.
 *
 * Vì sao cần một kho riêng thay vì chỉ giữ danh sách URL: đổi `src` của một `<img>` 30 lần
 * mỗi giây là 30 lần *tải và giải mã*. Bản đầu tạo `new Image()` để nạp trước rồi **bỏ đi**
 * — không có gì giữ chúng sống, nên bitmap đã giải mã bị thu hồi và trình duyệt phải làm
 * lại từ đầu ở mỗi khung. Khi không kịp, `<img>` giữ nguyên ảnh CŨ (nó không xoá ảnh đang
 * hiện khi `src` mới chưa xong) — và cái người dùng thấy là một khung hình đứng im.
 *
 * Giữ tham chiếu tới `HTMLImageElement` rồi vẽ lên `<canvas>` biến việc phát lại thành phép
 * copy pixel: không mạng, không giải mã, không phụ thuộc bộ đệm HTTP.
 *
 * Là module singleton chứ không nằm trong zustand: đây là hàng chục megabyte bitmap, không
 * phải state để so sánh và render lại theo.
 */
export interface PlaybackFrames {
  readonly signature: string
  readonly images: readonly HTMLImageElement[]
}

let current: PlaybackFrames | null = null

export function setPlaybackFrames(frames: PlaybackFrames | null): void {
  current = frames
}

/**
 * Ảnh của dải, nếu vân tay khớp. Lệch vân tay trả về `null` — thà không vẽ gì còn hơn vẽ
 * dải của cấu hình cũ.
 */
export function playbackFramesFor(signature: string): readonly HTMLImageElement[] | null {
  if (!current || current.signature !== signature) return null
  return current.images
}

/**
 * Nạp và GIỮ ảnh. `decode()` bảo đảm bitmap đã sẵn sàng trước khi phát — nếu chỉ chờ
 * `onload` thì khung đầu vẫn có thể phải giải mã đúng lúc đang phát.
 */
export async function loadPlaybackImages(urls: readonly string[]): Promise<HTMLImageElement[]> {
  return Promise.all(urls.map(loadImage))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const image = new Image()
    const done = () => {
      // `decode()` không có ở mọi nơi (và không có trong jsdom). Thiếu nó thì vẫn dùng
      // được ảnh, chỉ là lần vẽ đầu có thể tốn thêm — nên bỏ qua lỗi ở đây.
      if (typeof image.decode === 'function') {
        image.decode().then(
          () => resolve(image),
          () => resolve(image),
        )
      } else {
        resolve(image)
      }
    }
    image.onload = done
    // Nạp lỗi cũng resolve: một frame thiếu thì thà phát với một chỗ trống còn hơn treo
    // vô hạn chờ một thứ không bao giờ về.
    image.onerror = () => resolve(image)
    image.src = url
  })
}
