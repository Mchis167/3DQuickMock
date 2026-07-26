import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { RenderJob, RenderRegistry, type JobInfo } from './index'

const ROOT = process.cwd()
const FAKE = path.join(ROOT, 'tests/fixtures/fake-blender.mjs')
const OUT_DIR = 'cache/test-exports'

function makeJob(id: string, extra: string[] = []) {
  const outputName = `job_${id}`
  const absoluteOut = path.join(ROOT, OUT_DIR, `${outputName}.png`)
  const job = new RenderJob({
    id,
    root: ROOT,
    config: { schemaVersion: 1 },
    outputDir: OUT_DIR,
    outputName,
    command: {
      exec: process.execPath,
      args: [FAKE, '--out', absoluteOut, '--step-ms', '15', ...extra],
    },
  })
  return { job, absoluteOut }
}

function done(job: RenderJob): Promise<JobInfo> {
  return new Promise((resolve) => job.once('end', resolve))
}

function alive(pid: number): boolean {
  const count = execFileSync('sh', ['-c', `ps -p ${pid} -o pid= | wc -l`], {
    encoding: 'utf8',
  }).trim()
  return count !== '0'
}

afterEach(() => {
  rmSync(path.join(ROOT, OUT_DIR), { recursive: true, force: true })
})

describe('RenderJob', () => {
  it('chạy xong thì báo done và ảnh có thật', async () => {
    const { job, absoluteOut } = makeJob('ok', ['--samples', '4'])
    job.start()
    const info = await done(job)
    expect(info.state).toBe('done')
    expect(info.progress.fraction).toBe(1)
    expect(existsSync(absoluteOut)).toBe(true)
  })

  it('đọc được tiến trình từ log Cycles, bỏ qua dòng rác', async () => {
    const { job } = makeJob('progress', ['--samples', '5'])
    const seen: number[] = []
    job.on('update', (info: JobInfo) => {
      if (info.progress.sample) seen.push(info.progress.sample)
    })
    job.start()
    await done(job)
    // Phải thấy đủ 5 mốc và tổng đúng — bắt sai dòng thì thanh tiến trình nhảy loạn.
    // Mốc cuối xuất hiện hai lần vì `finish()` phát thêm một cập nhật kết thúc; điều
    // đáng kiểm là dãy mốc, không phải số lần phát.
    expect([...new Set(seen)]).toEqual([1, 2, 3, 4, 5])
    expect(job.info.progress.totalSamples).toBe(5)
  })

  it('huỷ thì tiến trình CHẾT THẬT, kiểm bằng ps', async () => {
    const { job } = makeJob('cancel', ['--samples', '3', '--hang'])
    job.start()
    const pid = job.pid
    expect(pid).toBeDefined()
    expect(alive(pid as number)).toBe(true)

    const ended = done(job)
    job.cancel()
    const info = await ended

    expect(info.state).toBe('cancelled')
    // Chỗ quan trọng nhất của cả module: "đã huỷ" trên UI mà tiến trình còn sống thì
    // người dùng vẫn mất máy vì CPU, và mỗi lần bấm huỷ lại rò thêm một tiến trình.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(alive(pid as number)).toBe(false)
  })

  it('huỷ KHÔNG bị báo thành thất bại', async () => {
    const { job } = makeJob('cancel-state', ['--samples', '3', '--hang'])
    job.start()
    const ended = done(job)
    job.cancel()
    const info = await ended
    expect(info.state).not.toBe('failed')
    expect(info.error).toBeUndefined()
  })

  it('huỷ hai lần là vô hại', async () => {
    const { job } = makeJob('cancel-twice', ['--samples', '3', '--hang'])
    job.start()
    const ended = done(job)
    job.cancel()
    job.cancel()
    expect((await ended).state).toBe('cancelled')
  })

  it('thoát mã khác 0 thì báo failed kèm stderr', async () => {
    const { job } = makeJob('fail', ['--samples', '2', '--fail'])
    job.start()
    const info = await done(job)
    expect(info.state).toBe('failed')
    expect(info.error).toContain('lỗi giả')
  })

  it('thoát 0 mà KHÔNG có ảnh vẫn là failed', async () => {
    // Blender thoát 0 kể cả khi script `-P` raise (đã kiểm chứng với Blender 4.5.1), nên
    // mã thoát không phải bằng chứng. Ở đây giả lập đúng tình huống đó: tiến trình thoát
    // êm nhưng không ghi file nào.
    const job = new RenderJob({
      id: 'exit0-no-file',
      root: ROOT,
      config: {},
      outputDir: OUT_DIR,
      outputName: 'khong-ghi-gi',
      command: { exec: process.execPath, args: ['-e', 'process.exit(0)'] },
    })
    job.start()
    const info = await done(job)
    expect(info.state).toBe('failed')
    expect(info.error).toContain('không có ảnh ra')
  })

  it('lệnh không tồn tại thì failed, không treo im lặng', async () => {
    const job = new RenderJob({
      id: 'missing',
      root: ROOT,
      config: {},
      outputDir: OUT_DIR,
      outputName: 'x',
      command: { exec: '/khong/co/blender', args: [] },
    })
    job.start()
    const info = await done(job)
    expect(info.state).toBe('failed')
  })

  it('ghi config ra đĩa để Python tự validate lại', async () => {
    const { job } = makeJob('config', ['--samples', '2'])
    job.start()
    await done(job)
    // Đường validate duy nhất đáng tin là chính `validate_config.py`; muốn thế thì config
    // phải tồn tại thành file, không chỉ nằm trong bộ nhớ Node.
    expect(existsSync(path.join(ROOT, 'cache/jobs/config.json'))).toBe(true)
  })
})

describe('RenderRegistry', () => {
  it('phát tiến trình của mọi job cho người nghe', async () => {
    const registry = new RenderRegistry()
    const updates: JobInfo[] = []
    registry.onUpdate((info) => updates.push(info))

    const { job } = makeJob('reg', ['--samples', '3'])
    registry.add(job)
    job.start()
    await done(job)

    expect(updates.length).toBeGreaterThanOrEqual(3)
    expect(registry.get('reg')?.info.state).toBe('done')
  })

  it('cancelAll giết mọi job đang chạy', async () => {
    const registry = new RenderRegistry()
    const first = makeJob('all-1', ['--samples', '2', '--hang'])
    const second = makeJob('all-2', ['--samples', '2', '--hang'])
    for (const { job } of [first, second]) {
      registry.add(job)
      job.start()
    }
    const pids = [first.job.pid as number, second.job.pid as number]

    registry.cancelAll()
    await new Promise((resolve) => setTimeout(resolve, 250))
    // Server đóng mà job còn sống là rò tiến trình — mỗi lần restart dev server lại rò thêm.
    for (const pid of pids) expect(alive(pid)).toBe(false)
  })

  it('giữ job đã xong để hỏi lại sau khi mất WebSocket', async () => {
    const registry = new RenderRegistry()
    const { job } = makeJob('keep', ['--samples', '2'])
    registry.add(job)
    job.start()
    await done(job)
    expect(registry.get('keep')?.info.output).toContain('job_keep.png')
  })
})
