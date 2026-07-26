import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { BlenderWorker, WorkerError } from './worker-process'
import { SupersededError } from './queue'

const ROOT = process.cwd()
const FAKE = path.join(ROOT, 'tests/fixtures/fake-worker.mjs')

function makeWorker(extraArgs: string[] = []) {
  return new BlenderWorker({
    root: ROOT,
    command: { exec: process.execPath, args: [FAKE, ...extraArgs] },
    timeoutMs: 5000,
  })
}

let active: BlenderWorker[] = []

function track(w: BlenderWorker) {
  active.push(w)
  return w
}

afterEach(async () => {
  await Promise.all(active.map((w) => w.stop()))
  active = []
})

describe('BlenderWorker', () => {
  it('khởi động và nhận được thông điệp ready', async () => {
    const worker = track(makeWorker())
    const ready = await worker.start()
    expect(ready['ready']).toBe(true)
    expect(worker.isRunning).toBe(true)
  })

  it('gửi lệnh và nhận đúng phản hồi', async () => {
    const worker = track(makeWorker())
    const reply = await worker.send({ cmd: 'still', out: '/tmp/x.png' })
    expect(reply['out']).toBe('/tmp/x.png')
  })

  it('bỏ qua log của Blender lẫn trong stdout', async () => {
    // Blender in tiến độ render ra cùng stdout. Không lọc theo tiền tố `@@` thì
    // bridge sẽ tưởng dòng log là câu trả lời.
    const worker = track(makeWorker(['--noisy']))
    const reply = await worker.send({ cmd: 'ping' })
    expect(reply['blender']).toBe('giả 4.5.1')
  })

  it('ghép lại phản hồi bị cắt vụn giữa hai lần data', async () => {
    // stdout tới theo mẩu, không theo dòng. Lỗi ghép sai chỉ hiện ra ngẫu nhiên khi
    // phản hồi dài — rất khó tìm nếu không ép nó xảy ra ở đây.
    const worker = track(makeWorker(['--chunked']))
    const reply = await worker.send({ cmd: 'still', out: '/tmp/dai'.repeat(30) })
    expect(reply['ok']).toBe(true)
  })

  it('giữ đúng cặp hỏi/đáp khi gửi nhiều lệnh liên tiếp', async () => {
    const worker = track(makeWorker(['--delay', '2']))
    const outs = ['/a.png', '/b.png', '/c.png', '/d.png']
    const replies = await Promise.all(outs.map((out) => worker.send({ cmd: 'still', out })))
    expect(replies.map((r) => r['out'])).toEqual(outs)
  })

  it('lệnh lỗi thành WorkerError kèm traceback, worker vẫn sống', async () => {
    const worker = track(makeWorker())
    await expect(
      worker.send({ cmd: 'boom' } as unknown as { cmd: 'ping' }),
    ).rejects.toBeInstanceOf(WorkerError)
    // Một lệnh hỏng không được giết cả phiên làm việc.
    await expect(worker.send({ cmd: 'ping' })).resolves.toMatchObject({ ok: true })
  })

  it('kéo slider: chỉ cái đầu và cái cuối thực sự chạy', async () => {
    const worker = track(makeWorker(['--delay', '15']))
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        worker
          .send({ cmd: 'still', out: `/tmp/slider_${i}.png` }, { coalesceKey: 'preview' })
          .catch((e: unknown) => e),
      ),
    )
    expect(results[0]).toMatchObject({ out: '/tmp/slider_0.png' })
    expect(results[9]).toMatchObject({ out: '/tmp/slider_9.png' })
    expect(results.slice(1, 9).every((r) => r instanceof SupersededError)).toBe(true)
  })

  it('worker chết bất ngờ thì yêu cầu đang chờ bị từ chối, không treo', async () => {
    const worker = track(makeWorker(['--die-after', '1']))
    await worker.send({ cmd: 'ping' })
    // Yêu cầu treo vĩnh viễn là kiểu hỏng tệ nhất: UI quay vòng mãi không báo gì.
    await expect(worker.send({ cmd: 'ping' })).rejects.toThrow(/thoát bất ngờ|không còn chạy/)
  })

  it('stop() giết tiến trình con, không để lại process mồ côi', async () => {
    const worker = makeWorker()
    await worker.start()
    const pid = worker.pid
    expect(pid).toBeDefined()

    await worker.stop()
    expect(worker.isRunning).toBe(false)

    // Kiểm bằng `ps` thay vì tin vào cờ nội bộ — process mồ côi ăn RAM tới lúc reboot.
    const alive = execFileSync('sh', ['-c', `ps -p ${pid} -o pid= | wc -l`], {
      encoding: 'utf8',
    }).trim()
    expect(alive).toBe('0')
  })
})
