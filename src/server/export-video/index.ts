import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { ffmpegArgs } from './ffmpeg-args'

/**
 * Export video: Chrome headless ghép, ffmpeg mã hoá.
 *
 * Chrome nạp `export.html` — **entry thứ hai của cùng bundle với UI**, nên nó chạy đúng file
 * shader mà preview chạy. Trang tự tua video, ghép từng khung, rồi đẩy RGBA thô qua WebSocket
 * về đây; ta bơm thẳng vào stdin của ffmpeg. Không có phép toán màu nào ở phía Node.
 *
 * Vì sao không dùng `gl` của npm hay tự dựng WebGL ở Node: khác driver là khác kết quả, và
 * lúc đó "preview không lệch export" lại thành một phép đo thay vì một bảo đảm. Chrome thật
 * dùng chính ANGLE Metal như bản có cửa sổ.
 */

export interface ExportJobSpec {
  id: string
  manifest: { res: [number, number]; files: Record<string, unknown> }
  videoUrl: string
  fps: number
  frames: number
}

export interface ExportJobResult {
  output: string
  frames: number
  ms: number
  bytes: number
}

export class ExportError extends Error {}

const CHROME =
  process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Trang export. Vite dev phục vụ ở 5173; bản build nằm trong `dist/export.html`. */
export function exportPageUrl(port: number): string {
  // Mặc định là bản BUILD phục vụ ngay từ API server: cùng origin nên không vướng CORS, và
  // quan trọng hơn — cùng bundle với UI, tức cùng shader. Trỏ sang Vite dev (5173) được, nhưng
  // lúc đó phải tự chịu trách nhiệm rằng hai bên đang cùng một bản mã.
  return process.env['EXPORT_PAGE_URL'] ?? `http://127.0.0.1:${port}/app/export.html`
}

interface Pending {
  spec: ExportJobSpec
  encoder: ChildProcess
  received: number
  resolve: (result: ExportJobResult) => void
  reject: (error: Error) => void
  startedAt: number
  output: string
  onProgress?: (frame: number, total: number) => void
}

/**
 * Sổ job đang chạy. Trang export tự lấy mô tả job và tự đẩy frame về, nên server phải giữ
 * trạng thái giữa hai kết nối đó.
 */
export class ExportRegistry {
  private readonly jobs = new Map<string, Pending>()
  private readonly root: string
  private chrome: ChildProcess | null = null
  private port = 5174
  private chromeLog: () => string = () => ''

  constructor(root: string, port = 5174) {
    this.root = root
    this.port = port
  }

  setPort(port: number): void {
    this.port = port
  }

  get(id: string): ExportJobSpec | undefined {
    return this.jobs.get(id)?.spec
  }

  /** Khung hình mỗi frame — dùng để bắt frame cụt trước khi nó thành video hỏng. */
  private frameBytes(spec: ExportJobSpec): number {
    return spec.manifest.res[0] * spec.manifest.res[1] * 4
  }

  start(
    spec: ExportJobSpec,
    outputRelative: string,
    onProgress?: (frame: number, total: number) => void,
    timeoutMs = 45_000,
  ): Promise<ExportJobResult> {
    const output = path.join(this.root, outputRelative)
    mkdirSync(path.dirname(output), { recursive: true })
    const [width, height] = spec.manifest.res
    const encoder = spawn('ffmpeg', ffmpegArgs({ width, height, fps: spec.fps, output }), {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    encoder.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    return new Promise<ExportJobResult>((resolve, reject) => {
      // Chặn treo vô hạn: Chrome không nạp được trang, hay WebSocket không mở được, thì không
      // có sự kiện nào để mà chờ. Thà đỏ sau một phút còn hơn đứng im.
      const deadline = setTimeout(
        () =>
          this.fail(
            spec.id,
            `export quá ${Math.round(timeoutMs / 1000)}s mà chưa xong. Log Chrome:\n${this.chromeLog().slice(-1500)}`,
          ),
        timeoutMs,
      )
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          clearTimeout(deadline)
          fn(value)
        }
      resolve = settle(resolve)
      reject = settle(reject)
      const pending: Pending = {
        spec,
        encoder,
        received: 0,
        resolve,
        reject,
        startedAt: Date.now(),
        output,
        ...(onProgress ? { onProgress } : {}),
      }
      this.jobs.set(spec.id, pending)

      encoder.on('exit', (code) => {
        this.jobs.delete(spec.id)
        this.chrome?.kill()
        this.chrome = null
        if (code !== 0) {
          reject(new ExportError(`ffmpeg thoát mã ${code}: ${stderr.slice(-500)}`))
          return
        }
        // Bằng chứng "xong" là FILE CÓ THẬT và khác 0 byte, không phải mã thoát — Blender đã
        // dạy dự án này bài đó (PRD §7), và ffmpeg cũng ghi file rỗng khi đầu vào cụt.
        if (!existsSync(output) || statSync(output).size === 0) {
          reject(new ExportError(`ffmpeg báo xong nhưng ${output} rỗng`))
          return
        }
        if (pending.received !== spec.frames) {
          reject(
            new ExportError(`nhận ${pending.received}/${spec.frames} khung hình — video cụt`),
          )
          return
        }
        resolve({
          output: outputRelative,
          frames: pending.received,
          ms: Date.now() - pending.startedAt,
          bytes: statSync(output).size,
        })
      })

      this.launchChrome(spec.id).catch((error: unknown) => {
        encoder.kill()
        this.jobs.delete(spec.id)
        reject(error instanceof Error ? error : new ExportError(String(error)))
      })
    })
  }

  /** Nhận một khung hình từ trang export. */
  frame(id: string, data: Buffer): void {
    const pending = this.jobs.get(id)
    if (!pending) return
    const expected = this.frameBytes(pending.spec)
    if (data.byteLength !== expected) {
      pending.encoder.kill()
      pending.reject(
        new ExportError(
          `khung hình ${pending.received}: ${data.byteLength} byte, cần ${expected}`,
        ),
      )
      return
    }
    pending.encoder.stdin?.write(data)
    pending.received += 1
    pending.onProgress?.(pending.received, pending.spec.frames)
  }

  /** Trang báo đã gửi hết. Đóng stdin để ffmpeg kết thúc file tử tế. */
  finish(id: string): void {
    this.jobs.get(id)?.encoder.stdin?.end()
  }

  fail(id: string, message: string): void {
    const pending = this.jobs.get(id)
    if (!pending) return
    pending.encoder.kill()
    this.jobs.delete(id)
    pending.reject(new ExportError(message))
  }

  private async launchChrome(jobId: string): Promise<void> {
    if (!existsSync(CHROME)) {
      throw new ExportError(
        `không tìm thấy Chrome ở ${CHROME}. Đặt CHROME_PATH nếu cài chỗ khác.`,
      )
    }
    const url = `${exportPageUrl(this.port)}?job=${encodeURIComponent(jobId)}`
    this.chrome = spawn(
      CHROME,
      [
        '--headless=new',
        // BẮT BUỘC có hồ sơ riêng: không có nó, nếu người dùng đang mở Chrome thì tiến trình
        // mới chỉ chuyển URL sang cửa sổ đang chạy rồi TỰ THOÁT — job treo, và trang export
        // lại mở ra trong Chrome của người dùng.
        `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mockup-export-'))}`,
        // ANGLE Metal: chính đường mà bản có cửa sổ đi. Không ép thì Chrome có thể rơi về
        // SwiftShader và ra kết quả KHÁC — vẫn là ảnh hợp lệ, chỉ khác vài đơn vị màu.
        '--use-angle=metal',
        '--enable-unsafe-webgpu',
        '--disable-gpu-sandbox',
        '--no-first-run',
        // Đẩy console của trang ra stderr: không có nó thì một lỗi JS trong trang export là
        // im lặng tuyệt đối — Chrome vẫn sống, chỉ không gửi frame nào.
        '--enable-logging=stderr',
        '--v=0',
        '--disable-extensions',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        url,
      ],
      // KHÔNG vứt log của Chrome: khi trang export hỏng, đây là kênh DUY NHẤT nói được vì
      // sao — WebSocket có thể chưa kịp mở để báo lỗi về.
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let log = ''
    const collect = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-4000)
    }
    this.chrome.stdout?.on('data', collect)
    this.chrome.stderr?.on('data', collect)
    this.chromeLog = () => log
    this.chrome.on('exit', (code) => {
      // Chrome chết giữa chừng thì job treo mãi nếu không bắt ở đây.
      if (this.jobs.has(jobId)) {
        this.fail(jobId, `Chrome thoát sớm (mã ${code})\n${log.slice(-1500)}`)
      }
    })
  }

  dispose(): void {
    this.chrome?.kill()
    for (const pending of this.jobs.values()) pending.encoder.kill()
    this.jobs.clear()
  }
}
