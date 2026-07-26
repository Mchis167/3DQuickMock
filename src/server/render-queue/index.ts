import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { locateBlender } from '../worker-bridge/locate-blender'

/**
 * Render final: MỘT TIẾN TRÌNH RIÊNG cho mỗi job.
 *
 * Không dùng worker preview vì render final tốn từ vài chục giây tới 28 phút — chạy trên
 * worker thì UI đứng im suốt thời gian đó (Architecture.md §7).
 *
 * Huỷ ở đây là huỷ THẬT: giết tiến trình. Khác hẳn "huỷ" của hàng đợi preview, nơi việc
 * đang chạy phải xong nốt vì Blender không cho ngắt giữa frame.
 */
export type JobState = 'running' | 'done' | 'failed' | 'cancelled'

export interface JobProgress {
  /** Mẫu Cycles đã xong / tổng. EEVEE không báo nên hai số này là 0. */
  sample: number
  totalSamples: number
  /** 0..1, để hiện thanh tiến trình. */
  fraction: number
}

export interface JobInfo {
  id: string
  state: JobState
  progress: JobProgress
  /** Ảnh ra, đường dẫn tương đối gốc repo. Chỉ có khi state = done. */
  output?: string
  error?: string
  ms?: number
}

export interface RenderJobOptions {
  id: string
  root: string
  /** Config theo schema Pha 1 — chính Python sẽ validate lại trước khi dựng scene. */
  config: Record<string, unknown>
  outputDir: string
  outputName: string
  /** Ghi đè lệnh Blender cho test. */
  command?: { exec: string; args: string[] }
  /**
   * Hậu xử lý ảnh (ghép nền màu…), chạy TRƯỚC khi job báo `done`.
   *
   * Phải nằm trong vòng đời của job chứ không treo vào sự kiện 'end': làm ngoài thì job
   * đã báo xong trong khi file còn là bản chưa ghép nền, và người gọi đọc phải bản cũ.
   */
  postProcess?: (outputAbsolute: string) => Promise<void>
}

export class RenderJob extends EventEmitter {
  readonly id: string
  readonly root: string
  readonly outputRelative: string

  private readonly options: RenderJobOptions
  private child: ChildProcess | null = null
  private state: JobState = 'running'
  private progress: JobProgress = { sample: 0, totalSamples: 0, fraction: 0 }
  private stderr = ''
  private startedAt = 0

  constructor(options: RenderJobOptions) {
    super()
    this.options = options
    this.id = options.id
    this.root = options.root
    this.outputRelative = path.join(options.outputDir, `${options.outputName}.png`)
  }

  get info(): JobInfo {
    return {
      id: this.id,
      state: this.state,
      progress: this.progress,
      ...(this.state === 'done' ? { output: this.outputRelative } : {}),
      ...(this.stderr && this.state === 'failed' ? { error: this.stderr.slice(-800) } : {}),
      ...(this.startedAt ? { ms: Date.now() - this.startedAt } : {}),
    }
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  start(): void {
    const jobsDir = path.join(this.root, 'cache/jobs')
    mkdirSync(jobsDir, { recursive: true })
    mkdirSync(path.join(this.root, this.options.outputDir), { recursive: true })

    const configPath = path.join(jobsDir, `${this.id}.json`)
    writeFileSync(configPath, JSON.stringify(this.options.config, null, 2))

    const command = this.options.command ?? {
      exec: locateBlender(),
      args: [
        '-b',
        '--factory-startup',
        '-P',
        'scripts/blender/render_config.py',
        '--',
        configPath,
      ],
    }

    this.startedAt = Date.now()
    // `detached: false` như worker preview: job phải chết theo server chứ không thành
    // tiến trình mồ côi ngốn hết CPU.
    this.child = spawn(command.exec, command.args, {
      cwd: this.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    this.child.stdout?.on('data', (chunk: Buffer) => this.readProgress(chunk.toString()))
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString()
    })

    this.child.on('error', (error: Error) => {
      this.stderr += error.message
      this.finish('failed')
    })

    this.child.on('exit', (code, signal) => {
      if (this.state === 'cancelled') return
      // Bị giết bằng tín hiệu = đã huỷ, không phải lỗi. Không phân biệt thì UI báo "render
      // thất bại" mỗi lần người dùng bấm huỷ.
      if (signal) return void this.finish('cancelled')
      if (code !== 0) return void this.finish('failed')
      // Mã thoát 0 KHÔNG đủ để tin: Blender thoát 0 kể cả khi script `-P` raise (đã kiểm
      // chứng 2026-07-25). Bằng chứng duy nhất là có file ảnh thật.
      const absolute = path.join(this.root, this.outputRelative)
      let size: number
      try {
        size = statSync(absolute).size
      } catch {
        size = 0
      }
      if (size === 0) {
        this.stderr += `Blender thoát 0 nhưng không có ảnh ra: ${this.outputRelative}`
        return void this.finish('failed')
      }
      void this.runPostProcess()
    })
  }

  /**
   * Huỷ thật: SIGKILL.
   *
   * SIGTERM thì Blender đang giữa một mẫu Cycles có thể không phản hồi ngay, và bấm huỷ mà
   * tiến trình còn sống là mất niềm tin vào nút đó. Ở đây không có gì cần dọn dẹp tử tế:
   * ảnh chưa ghi xong thì bỏ luôn.
   */
  cancel(): void {
    if (this.state !== 'running') return
    this.state = 'cancelled'
    this.child?.kill('SIGKILL')
    this.emit('update', this.info)
    this.emit('end', this.info)
  }

  private readProgress(text: string): void {
    // Cycles in ra: "Fra:1 Mem:… | Time:00:12.34 | … | Sample 37/128"
    for (const match of text.matchAll(/Sample (\d+)\/(\d+)/g)) {
      const sample = Number(match[1])
      const totalSamples = Number(match[2])
      if (!totalSamples) continue
      this.progress = { sample, totalSamples, fraction: Math.min(1, sample / totalSamples) }
      this.emit('update', this.info)
    }
  }

  private async runPostProcess(): Promise<void> {
    const post = this.options.postProcess
    if (!post) return this.finish('done')
    try {
      await post(path.join(this.root, this.outputRelative))
      this.finish('done')
    } catch (error) {
      this.stderr += `hậu xử lý thất bại: ${(error as Error).message}`
      this.finish('failed')
    }
  }

  private finish(state: JobState): void {
    this.state = state
    if (state === 'done') this.progress = { ...this.progress, fraction: 1 }
    this.emit('update', this.info)
    this.emit('end', this.info)
  }
}

/**
 * Sổ theo dõi job.
 *
 * Giữ cả job đã xong để UI hỏi lại kết quả sau khi mất kết nối WebSocket — mất mạng một
 * giây không được làm mất một bản render 28 phút.
 */
export class RenderRegistry {
  private readonly jobs = new Map<string, RenderJob>()
  private readonly listeners = new Set<(info: JobInfo) => void>()

  add(job: RenderJob): void {
    this.jobs.set(job.id, job)
    // Đăng ký ngay khi thêm: job phát 'update' từ lúc start(), muộn một nhịp là mất
    // những phần trăm đầu của thanh tiến trình.
    job.on('update', (info: JobInfo) => {
      for (const listener of this.listeners) listener(info)
    })
  }

  /** Nghe mọi job — server dùng để phát ra WebSocket. */
  onUpdate(listener: (info: JobInfo) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get(id: string): RenderJob | undefined {
    return this.jobs.get(id)
  }

  /** Huỷ mọi job đang chạy — dùng khi server đóng. */
  cancelAll(): void {
    for (const job of this.jobs.values()) job.cancel()
  }
}
