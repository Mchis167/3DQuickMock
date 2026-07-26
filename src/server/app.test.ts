import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createServer, type AppServer } from './app'

const ROOT = process.cwd()
const FAKE = path.join(ROOT, 'tests/fixtures/fake-worker.mjs')

let server: AppServer

beforeEach(async () => {
  server = createServer({
    root: ROOT,
    workerCommand: { exec: process.execPath, args: [FAKE, '--noisy'] },
  })
  await server.fastify.ready()
})

afterEach(async () => {
  await server.close()
})

async function trpc(
  procedure: string,
  input: Record<string, unknown> | undefined,
  kind: 'query' | 'mutation' = 'mutation',
) {
  const response =
    kind === 'mutation'
      ? await server.fastify.inject({
          method: 'POST',
          url: `/trpc/${procedure}`,
          payload: input,
        })
      : await server.fastify.inject({
          method: 'GET',
          url: `/trpc/${procedure}`,
        })
  return { status: response.statusCode, body: JSON.parse(response.body) }
}

describe('server + worker bridge', () => {
  it('health cho biết Blender ở đâu', async () => {
    const { status, body } = await trpc('health', undefined, 'query')
    expect(status).toBe(200)
    // Đường dẫn Blender từng bị hardcode ở nhiều nơi; giờ dò một lần và hiện ra được.
    expect(body.result.data.blender).toMatch(/[Bb]lender/)
  })

  it('preview gọi worker và trả về URL phục vụ được', async () => {
    const { status, body } = await trpc('preview', {
      camera: { azimuth: 20, elevation: 12 },
      world: { hdri: 'assets/hdri/studio_small_03.hdr', strength: 0.6 },
    })
    expect(status).toBe(200)
    const url: string = body.result.data.url
    expect(url).toMatch(/^\/preview\/still_.+\.png$/)

    // Worker giả không ghi file thật, nên tự ghi để kiểm route tĩnh.
    writeFileSync(path.join(server.context.previewDir, path.basename(url)), 'png-giả')
    const served = await server.fastify.inject({ method: 'GET', url })
    expect(served.statusCode).toBe(200)
  })

  it('mỗi preview có URL khác nhau', async () => {
    const a = await trpc('preview', { world: { hdri: 'assets/hdri/studio_small_03.hdr' } })
    const b = await trpc('preview', { world: { hdri: 'assets/hdri/studio_small_03.hdr' } })
    // Dùng lại tên file thì browser giữ ảnh cũ trong cache và preview trông như đứng.
    expect(a.body.result.data.url).not.toBe(b.body.result.data.url)
  })

  it('từ chối config sai ngay ở biên tRPC', async () => {
    const { status, body } = await trpc('preview', {
      camera: { elevation: 120 },
      world: { hdri: 'h.hdr' },
    })
    // 120 độ làm rig TRACK_TO mất trục tham chiếu và camera lật — chặn trước khi render.
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toMatch(/elevation/)
  })

  it('chặn đường dẫn thoát ra ngoài gốc repo', async () => {
    const { status, body } = await trpc('preview', {
      world: { hdri: '../../../../etc/passwd' },
    })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(body)).toMatch(/ngoài gốc repo/)
  })

  it('lỗi worker thành lỗi HTTP có nội dung, không phải treo', async () => {
    // Ép worker giả trả về ok:false.
    const { status, body } = await trpc('resetScene', { engine: 'khong-ton-tai' })
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toMatch(/engine/)
  })

  it('close() hạ cả HTTP và tiến trình worker', async () => {
    // `health` không chạm worker (worker khởi động lười), nên phải gửi lệnh thật.
    await trpc('preview', { world: { hdri: 'assets/hdri/studio_small_03.hdr' } })
    const pid = server.worker.pid
    expect(pid).toBeDefined()

    await server.close()

    // Kiểm bằng `ps`: server chết mà worker sống là rò tiến trình, và mỗi lần sửa code
    // rò thêm một cái.
    const alive = execFileSync('sh', ['-c', `ps -p ${pid} -o pid= | wc -l`], {
      encoding: 'utf8',
    }).trim()
    expect(alive).toBe('0')

    // Gọi lại close() trong afterEach phải vô hại.
  })
})
