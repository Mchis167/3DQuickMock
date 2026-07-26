import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'

import { locateBlender } from './locate-blender'
import { LatestWinsQueue, type EnqueueOptions } from './queue'
import { extractReplies, type WorkerCommand, type WorkerReply } from './protocol'

export class WorkerError extends Error {
  readonly trace: string | undefined

  constructor(message: string, trace?: string) {
    super(message)
    this.name = 'WorkerError'
    this.trace = trace
  }
}

export interface WorkerOptions {
  /** Gốc repo — worker.py phân giải đường dẫn asset tương đối theo cwd này. */
  root: string
  /** Ghi đè lệnh chạy, dùng cho worker giả trong test. */
  command?: { exec: string; args: string[] }
  /** Thời gian chờ tối đa một lệnh (ms). Render final KHÔNG đi qua đây. */
  timeoutMs?: number
}

/**
 * Tiến trình Blender thường trực cho live preview.
 *
 * Vì sao thường trực: khởi động Blender tốn ~1.4 s còn dựng lại scene chỉ 0.07 s.
 * Giữ tiến trình sống thì mỗi lần cập nhật chỉ còn ~0.25 s thay vì 1.9 s.
 *
 * Chỉ có MỘT instance sống suốt session. Render final phải spawn tiến trình riêng —
 * chạy nó ở đây thì UI đứng im 28 phút.
 */
export class BlenderWorker extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  /** Hàng chờ hỏi/đáp: worker trả lời đúng thứ tự nhận nên FIFO là ghép đúng cặp. */
  private awaiting: {
    resolve: (r: WorkerReply) => void
    reject: (e: unknown) => void
    timer?: NodeJS.Timeout
  }[] = []
  private readyPromise: Promise<WorkerReply> | null = null
  private stopping = false
  private readonly queue = new LatestWinsQueue<WorkerCommand, WorkerReply>((cmd) =>
    this.dispatch(cmd),
  )

  private readonly options: WorkerOptions

  constructor(options: WorkerOptions) {
    super()
    this.options = options
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  /** Khởi động và đợi thông điệp `ready` đầu tiên. Gọi nhiều lần là vô hại. */
  start(): Promise<WorkerReply> {
    if (this.readyPromise) return this.readyPromise

    const { exec, args } = this.options.command ?? {
      exec: locateBlender(),
      args: [
        '-b',
        '--factory-startup',
        '-P',
        path.join(this.options.root, 'scripts/blender/worker.py'),
      ],
    }

    const child = spawn(exec, args, {
      cwd: this.options.root,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Không tách process group: worker phải chết theo server. Nếu detach, kill
      // server sẽ để lại một tiến trình Blender mồ côi ăn RAM tới lúc reboot.
      detached: false,
    })
    this.child = child

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))

    // stderr của Blender là log thường, không phải lỗi. Chỉ giữ lại phần cuối để
    // đính vào thông báo nếu tiến trình chết.
    let stderrTail = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000)
      this.emit('log', chunk)
    })

    child.on('exit', (code, signal) => {
      const reason = this.stopping
        ? 'worker đã dừng theo yêu cầu'
        : `worker Blender thoát bất ngờ (code=${code}, signal=${signal})\n${stderrTail}`
      this.failAllAwaiting(new WorkerError(reason))
      this.queue.cancelPending(new WorkerError(reason))
      this.child = null
      this.readyPromise = null
      this.emit('exit', { code, signal, stderr: stderrTail })
    })

    child.on('error', (error) => {
      this.failAllAwaiting(error)
      this.emit('error', error)
    })

    this.readyPromise = this.expectReply()
    return this.readyPromise
  }

  /**
   * Gửi một lệnh. `coalesceKey` cho phép yêu cầu mới thay thế yêu cầu cùng key đang
   * chờ — xem queue.ts. Bỏ trống thì lệnh không bao giờ bị bỏ.
   */
  async send(cmd: WorkerCommand, options: EnqueueOptions = {}): Promise<WorkerReply> {
    await this.start()
    const reply = await this.queue.enqueue(cmd, options)
    if (!reply.ok) {
      throw new WorkerError(reply.error ?? 'worker báo lỗi không rõ', reply.trace)
    }
    return reply
  }

  /** Bỏ mọi yêu cầu đang chờ; cái đang chạy vẫn chạy nốt. */
  cancelPending(): number {
    return this.queue.cancelPending(new WorkerError('bị huỷ do có yêu cầu mới'))
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    this.queue.cancelPending(new WorkerError('worker đang dừng'))

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      child.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
    } catch {
      // stdin đã đóng — sẽ dùng tín hiệu ở dưới.
    }

    // Blender đang render giữa chừng thì không đọc stdin, nên `quit` có thể không tới.
    // Đợi ngắn rồi mới cưỡng chế.
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500))
    await Promise.race([exited, timeout])
    if (this.child) {
      child.kill('SIGKILL')
      await exited
    }
    this.stopping = false
  }

  // ------------------------------------------------------------------ nội bộ

  private dispatch(cmd: WorkerCommand): Promise<WorkerReply> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      return Promise.reject(new WorkerError('worker không còn chạy'))
    }
    const reply = this.expectReply()
    child.stdin.write(JSON.stringify(cmd) + '\n')
    return reply
  }

  private expectReply(): Promise<WorkerReply> {
    return new Promise<WorkerReply>((resolve, reject) => {
      const entry: (typeof this.awaiting)[number] = { resolve, reject }
      if (this.options.timeoutMs) {
        entry.timer = setTimeout(() => {
          const i = this.awaiting.indexOf(entry)
          if (i >= 0) this.awaiting.splice(i, 1)
          reject(new WorkerError(`worker không trả lời sau ${this.options.timeoutMs} ms`))
        }, this.options.timeoutMs)
      }
      this.awaiting.push(entry)
    })
  }

  private onStdout(chunk: string): void {
    const { replies, rest } = extractReplies(this.stdoutBuffer + chunk)
    this.stdoutBuffer = rest
    for (const reply of replies) {
      const entry = this.awaiting.shift()
      if (!entry) {
        this.emit('orphan-reply', reply)
        continue
      }
      if (entry.timer) clearTimeout(entry.timer)
      entry.resolve(reply)
    }
  }

  private failAllAwaiting(error: unknown): void {
    const entries = this.awaiting
    this.awaiting = []
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(error)
    }
  }
}
