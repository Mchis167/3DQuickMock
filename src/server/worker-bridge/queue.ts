/**
 * Hàng đợi "mới nhất thắng" — thứ quyết định cảm giác mượt khi kéo slider.
 *
 * Worker Blender xử lý TUẦN TỰ: mỗi dòng lệnh đúng một dòng trả lời, không có id để
 * ghép cặp. Nên bridge phải tự tuần tự hoá, và kéo slider sinh ra hàng chục yêu cầu
 * thì phải bỏ hết trừ cái mới nhất.
 *
 * Hai điểm dễ làm sai:
 *
 * 1. KHÔNG huỷ được cái đang chạy. Blender không cho ngắt giữa lúc render, nên "huỷ"
 *    ở đây nghĩa là bỏ những yêu cầu đang CHỜ. Cái đang chạy vẫn xong — 0.23 giây,
 *    không ai nhận ra.
 *
 * 2. Không phải yêu cầu nào cũng được phép bỏ. `meta` và `sample` mà bị nuốt thì UI
 *    treo vĩnh viễn chờ kết quả. Chỉ những yêu cầu có cùng `coalesceKey` mới thay thế
 *    nhau; không có key thì xếp hàng đầy đủ.
 */

export class SupersededError extends Error {
  readonly coalesceKey: string

  constructor(coalesceKey: string) {
    super(`yêu cầu bị thay thế bởi cái mới hơn (${coalesceKey})`)
    this.name = 'SupersededError'
    this.coalesceKey = coalesceKey
  }
}

interface Job<TCmd, TRes> {
  cmd: TCmd
  coalesceKey: string | undefined
  resolve: (value: TRes) => void
  reject: (error: unknown) => void
}

export interface EnqueueOptions {
  /**
   * Yêu cầu đang chờ có cùng key sẽ bị yêu cầu mới thay thế. Bỏ trống nghĩa là
   * không bao giờ bị bỏ.
   */
  coalesceKey?: string
}

export class LatestWinsQueue<TCmd, TRes> {
  private pending: Job<TCmd, TRes>[] = []
  private running = false
  private draining: Promise<void> | null = null

  private readonly run: (cmd: TCmd) => Promise<TRes>

  constructor(run: (cmd: TCmd) => Promise<TRes>) {
    this.run = run
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get isRunning(): boolean {
    return this.running
  }

  enqueue(cmd: TCmd, options: EnqueueOptions = {}): Promise<TRes> {
    const { coalesceKey } = options
    return new Promise<TRes>((resolve, reject) => {
      if (coalesceKey !== undefined) {
        // Bỏ những cái đang chờ cùng key. Chúng được BÁO LỖI chứ không im lặng treo:
        // phía gọi cần biết kết quả sẽ không bao giờ tới.
        const superseded = this.pending.filter((j) => j.coalesceKey === coalesceKey)
        this.pending = this.pending.filter((j) => j.coalesceKey !== coalesceKey)
        for (const job of superseded) job.reject(new SupersededError(coalesceKey))
      }
      this.pending.push({ cmd, coalesceKey, resolve, reject })
      void this.drain()
    })
  }

  /** Bỏ mọi thứ đang chờ. Cái đang chạy vẫn chạy nốt — xem ghi chú đầu file. */
  cancelPending(reason: Error = new Error('đã huỷ')): number {
    const dropped = this.pending
    this.pending = []
    for (const job of dropped) job.reject(reason)
    return dropped.length
  }

  /** Đợi tới khi hàng đợi rỗng và không còn gì đang chạy. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining
    this.draining = this.loop().finally(() => {
      this.draining = null
    })
    return this.draining
  }

  private async loop(): Promise<void> {
    while (this.pending.length > 0) {
      const job = this.pending.shift()
      if (!job) break
      this.running = true
      try {
        job.resolve(await this.run(job.cmd))
      } catch (error) {
        job.reject(error)
      } finally {
        this.running = false
      }
    }
  }
}
