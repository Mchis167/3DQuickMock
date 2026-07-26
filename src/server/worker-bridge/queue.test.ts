import { describe, expect, it, vi } from 'vitest'

import { LatestWinsQueue, SupersededError } from './queue'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('LatestWinsQueue', () => {
  it('chạy tuần tự, không bao giờ hai lệnh cùng lúc', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const queue = new LatestWinsQueue<number, number>(async (n) => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 1))
      concurrent -= 1
      return n
    })

    const results = await Promise.all([1, 2, 3, 4].map((n) => queue.enqueue(n)))
    expect(results).toEqual([1, 2, 3, 4])
    // Worker Blender đọc từng dòng một; gửi chồng lệnh là ghép nhầm cặp hỏi/đáp.
    expect(maxConcurrent).toBe(1)
  })

  it('10 yêu cầu liên tiếp cùng key thì chỉ chạy cái đầu và cái cuối', async () => {
    const gate = deferred<void>()
    const executed: number[] = []
    const queue = new LatestWinsQueue<number, number>(async (n) => {
      executed.push(n)
      if (n === 0) await gate.promise
      return n
    })

    // Cái đầu chiếm chỗ đang-chạy (không huỷ được), 9 cái sau tranh nhau chỗ chờ.
    const promises = Array.from({ length: 10 }, (_, i) =>
      queue.enqueue(i, { coalesceKey: 'preview' }).catch((e: unknown) => e),
    )
    gate.resolve()
    const settled = await Promise.all(promises)

    expect(executed).toEqual([0, 9])
    expect(settled[0]).toBe(0)
    expect(settled[9]).toBe(9)
    for (const mid of settled.slice(1, 9)) {
      expect(mid).toBeInstanceOf(SupersededError)
    }
  })

  it('yêu cầu không có key thì không bao giờ bị bỏ', async () => {
    const executed: string[] = []
    const gate = deferred<void>()
    const queue = new LatestWinsQueue<string, string>(async (cmd) => {
      executed.push(cmd)
      if (cmd === 'block') await gate.promise
      return cmd
    })

    const all = Promise.all([
      queue.enqueue('block'),
      queue.enqueue('meta'),
      queue.enqueue('preview-1', { coalesceKey: 'preview' }).catch(() => 'bỏ'),
      queue.enqueue('sample'),
      queue.enqueue('preview-2', { coalesceKey: 'preview' }),
    ])
    gate.resolve()
    await all

    // `meta` và `sample` bị nuốt thì UI treo vĩnh viễn chờ kết quả.
    expect(executed).toContain('meta')
    expect(executed).toContain('sample')
    expect(executed).not.toContain('preview-1')
    expect(executed).toContain('preview-2')
  })

  it('key khác nhau thì không thay thế lẫn nhau', async () => {
    const gate = deferred<void>()
    const executed: string[] = []
    const queue = new LatestWinsQueue<string, string>(async (cmd) => {
      executed.push(cmd)
      if (cmd === 'block') await gate.promise
      return cmd
    })

    const all = Promise.all([
      queue.enqueue('block'),
      queue.enqueue('still', { coalesceKey: 'still' }),
      queue.enqueue('strip', { coalesceKey: 'strip' }),
    ])
    gate.resolve()
    await all

    expect(executed).toEqual(['block', 'still', 'strip'])
  })

  it('lệnh hỏng không làm kẹt hàng đợi', async () => {
    const queue = new LatestWinsQueue<string, string>(async (cmd) => {
      if (cmd === 'boom') throw new Error('worker lỗi')
      return cmd
    })

    await expect(queue.enqueue('boom')).rejects.toThrow('worker lỗi')
    // Worker không được chết vì một lệnh hỏng — hàng đợi cũng vậy.
    await expect(queue.enqueue('ok')).resolves.toBe('ok')
  })

  it('cancelPending bỏ cái đang chờ nhưng để cái đang chạy xong', async () => {
    const gate = deferred<void>()
    const started: string[] = []
    const queue = new LatestWinsQueue<string, string>(async (cmd) => {
      started.push(cmd)
      if (cmd === 'running') await gate.promise
      return cmd
    })

    const running = queue.enqueue('running')
    const waiting = queue.enqueue('waiting')
    await vi.waitFor(() => expect(started).toEqual(['running']))

    expect(queue.cancelPending()).toBe(1)
    gate.resolve()

    // Blender không cho ngắt giữa lúc render — cái đang chạy phải về đích.
    await expect(running).resolves.toBe('running')
    await expect(waiting).rejects.toThrow('đã huỷ')
    expect(started).toEqual(['running'])
  })

  it('idle() đợi tới khi hết việc', async () => {
    const queue = new LatestWinsQueue<number, number>(async (n) => {
      await new Promise((r) => setTimeout(r, 2))
      return n
    })
    void queue.enqueue(1)
    void queue.enqueue(2)
    await queue.idle()
    expect(queue.pendingCount).toBe(0)
    expect(queue.isRunning).toBe(false)
  })
})
