import {
  agxLut,
  Compositor,
  loadPlate,
  meanLinearColour,
  type PlateManifest,
} from '@/entities/composite'

/**
 * Vòng lặp export, chạy trong Chrome headless.
 *
 * Khác preview đúng một chỗ: preview vẽ theo khung hình mà bộ giải mã đẩy ra
 * (`requestVideoFrameCallback`), còn ở đây ta TUA tới từng mốc thời gian rồi mới vẽ. Phép
 * ghép, plate, LUT, thuộc tính context đều là cùng một thứ.
 *
 * Frame đi ra bằng WebSocket dưới dạng RGBA thô, server đẩy thẳng vào stdin của ffmpeg.
 * ffmpeg KHÔNG làm phép toán màu nào — nó chỉ mã hoá.
 */

interface JobSpec {
  id: string
  manifest: PlateManifest
  videoUrl: string
  fps: number
  frames: number
  /** Phép khớp tỉ lệ, tính sẵn ở server bằng `screenFitTransform` — cùng hàm với preview. */
  contentScale: { x: number; y: number }
  letterbox: boolean
}

const MEAN_SIZE = 32

const params = new URLSearchParams(location.search)
const JOB = params.get('job') ?? ''

/**
 * Báo lỗi NGƯỢC VỀ SERVER qua HTTP.
 *
 * Không dựa vào log của Chrome: chạy headless thì stderr toàn tiếng ồn của bộ cập nhật, và một
 * lỗi JS trong trang là im lặng tuyệt đối — Chrome vẫn sống, chỉ không gửi khung nào, và job
 * treo tới hết hạn giờ mà không ai biết vì sao. Cũng không dựa vào WebSocket: lỗi hoàn toàn có
 * thể xảy ra TRƯỚC khi socket kịp mở.
 */
function fail(message: string): never {
  document.title = `export-error: ${message}`
  // `keepalive` để yêu cầu vẫn đi được kể cả khi trang bị đóng ngay sau đó.
  void fetch(`/export-fail/${encodeURIComponent(JOB)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
    keepalive: true,
  }).catch(() => undefined)
  throw new Error(message)
}

/**
 * Tua video tới đúng mốc thời gian và ĐỢI khung hình đó thật sự sẵn sàng.
 *
 * Không tin `onseeked` một mình: nếu server không hỗ trợ HTTP Range thì `currentTime` bị bỏ
 * qua **âm thầm** — `onseeked` vẫn bắn, và ba mốc thời gian khác nhau trả về cùng một khung.
 * Nên phải đối chiếu lại `currentTime` sau khi tua.
 */
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`tua tới ${time.toFixed(3)}s quá lâu`)),
      10_000,
    )
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', done)
      const drift = Math.abs(video.currentTime - time)
      // Một khung hình là 1/fps; lệch quá một khung nghĩa là tua không có tác dụng. Ngưỡng
      // phải rộng hơn nửa khung vì mốc yêu cầu đã nằm giữa khung, còn `currentTime` sau khi
      // tua bị kẹp về mốc trình bày của chính khung đó.
      if (drift > 1 / 30) {
        reject(
          new Error(
            `tua tới ${time.toFixed(3)}s nhưng dừng ở ${video.currentTime.toFixed(3)}s`,
          ),
        )
        return
      }
      resolve()
    }
    video.addEventListener('seeked', done)
    video.currentTime = time
  })
}

/**
 * Mọi phép chờ đều phải có HẠN GIỜ.
 *
 * Trang này chạy trong một Chrome ẩn, không ai nhìn. Một `await` treo vĩnh viễn ở đây là im
 * lặng tuyệt đối: Chrome vẫn sống, không lỗi, không log, job cứ chờ tới hết hạn giờ ở server
 * mà không ai biết tắc ở bước nào. Đã sập đúng như vậy một lần.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what}: quá ${ms / 1000}s`)), ms),
    ),
  ])
}

/** Mốc tiến trình, ghi vào tiêu đề trang để `--dump-dom` đọc được khi cần soi. */
function step(name: string): void {
  document.title = `export: ${name}`
}

async function main() {
  const id = JOB || fail('thiếu tham số job')
  step('job')
  const response = await withTimeout(fetch(`/export-job/${id}`), 10_000, 'lấy mô tả job')
  if (!response.ok) fail(`không lấy được mô tả job: HTTP ${response.status}`)
  const spec: JobSpec = await response.json()

  step('plate')
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const compositor = new Compositor(canvas)
  compositor.setAgxLut(await withTimeout(agxLut(), 30_000, 'nạp LUT AgX'))
  compositor.setPlate(await withTimeout(loadPlate(spec.manifest), 60_000, 'nạp plate'))
  compositor.setContentFit(spec.contentScale, spec.letterbox)

  step('video')
  const video = document.createElement('video')
  // Thứ tự và ba thuộc tính dưới đây đều bắt buộc, và thiếu cái nào cũng treo IM LẶNG:
  //  - `crossOrigin` phải đặt TRƯỚC `src`, đặt sau thì thuộc tính không có tác dụng;
  //  - `preload = 'auto'`, nếu không trình duyệt chỉ lấy metadata và `loadeddata` không bao
  //    giờ bắn;
  //  - phần tử phải NẰM TRONG document; một `<video>` rời có thể không được cấp tài nguyên
  //    giải mã. Đây chính là khác biệt với preview, nơi nó luôn nằm trong cây DOM.
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.className = 'probe'
  document.body.append(video)
  video.src = spec.videoUrl
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      if (video.readyState >= 2) return resolve()
      video.onloadeddata = () => resolve()
      video.onerror = () =>
        reject(new Error(`không nạp được video (mã ${video.error?.code ?? '?'})`))
    }),
    30_000,
    'nạp video',
  )

  const scratch = document.createElement('canvas')
  scratch.width = MEAN_SIZE
  scratch.height = MEAN_SIZE
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!

  const socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/export-frames?job=${id}`,
  )
  socket.binaryType = 'arraybuffer'
  step('socket')
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('không mở được WebSocket'))
    }),
    15_000,
    'mở WebSocket',
  )

  for (let frame = 0; frame < spec.frames; frame++) {
    // Tua vào GIỮA khung, không phải ranh giới: `frame / fps` rơi đúng mốc chuyển khung và
    // trình duyệt được phép trả về khung liền TRƯỚC. Đo thật với video 5 khung mức xám tăng
    // dần: tua theo ranh giới cho ra 108.3, 108.3, 108.3, 135.0, 161.1 — ba khung đầu trùng
    // nhau. Cộng nửa khung thì mỗi mốc nằm gọn trong đúng một khung.
    await withTimeout(seek(video, (frame + 0.5) / spec.fps), 15_000, `tua khung ${frame}`)
    scratchCtx.drawImage(video, 0, 0, MEAN_SIZE, MEAN_SIZE)
    const mean = meanLinearColour(scratchCtx.getImageData(0, 0, MEAN_SIZE, MEAN_SIZE).data)
    compositor.setFrame(video, mean)
    compositor.draw()
    socket.send(compositor.readPixels())
    // Chặn khi hàng đợi socket phình ra: gửi nhanh hơn ffmpeg nuốt sẽ ngốn hết RAM.
    while (socket.bufferedAmount > 32 * 1024 * 1024) {
      await new Promise((r) => setTimeout(r, 5))
    }
    document.title = `export ${frame + 1}/${spec.frames}`
  }
  socket.send(JSON.stringify({ done: true }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  document.title = 'export-done'
}

void main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
