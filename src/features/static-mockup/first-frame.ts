/**
 * Trích khung ĐẦU TIÊN của video ra một ảnh PNG.
 *
 * Vì sao cần: plate mất hàng chục giây và nó đóng băng mockup vào một góc. Nếu import video
 * xong mà chưa có gì hiện lên thì người dùng buộc phải dựng plate trước khi biết mình muốn góc
 * nào — tức trả giá đắt cho một quyết định chưa hình thành.
 *
 * Nên khung đầu tiên được dán vào màn hình như một ảnh tĩnh bình thường. Từ đó mọi thứ chạy
 * đúng đường cũ: kéo slider, xoay máy, đổi môi trường, preview Blender cập nhật trong ~250ms.
 * Dựng plate chỉ là bước CUỐI, khi góc đã chốt.
 */

export interface FirstFrame {
  blob: Blob
  width: number
  height: number
  duration: number
}

export function extractFirstFrame(file: File): Promise<FirstFrame> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false

    const fail = (message: string) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      reject(new Error(message))
    }

    // Không chờ vô hạn: một file trình duyệt không giải mã được sẽ không bắn sự kiện nào cả,
    // và lúc đó UI đứng ở trạng thái "đang xử lý" mãi mãi.
    const timer = setTimeout(() => fail('không đọc được video này (quá 15 giây)'), 15_000)

    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onerror = () => {
      clearTimeout(timer)
      fail(`không đọc được video này (mã ${video.error?.code ?? '?'})`)
    }

    // `loadeddata` chứ không phải `loadedmetadata`: metadata mới chỉ có kích thước, chưa có
    // pixel nào để vẽ — `drawImage` lúc đó cho ra một khung ĐEN, không báo lỗi.
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('không mở được canvas 2D')
        context.drawImage(video, 0, 0)
        canvas.toBlob((blob) => {
          clearTimeout(timer)
          if (!blob) {
            fail('không mã hoá được khung đầu tiên')
            return
          }
          settled = true
          URL.revokeObjectURL(url)
          resolve({
            blob,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
          })
        }, 'image/png')
      } catch (cause) {
        clearTimeout(timer)
        fail(cause instanceof Error ? cause.message : String(cause))
      }
    }

    video.src = url
    // Một số bộ giải mã chỉ trình khung đầu sau khi được yêu cầu tua tường minh.
    video.currentTime = 0
  })
}
