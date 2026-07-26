import { existsSync, mkdirSync } from 'node:fs'

import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify, { type FastifyInstance } from 'fastify'

import { storeUpload } from './asset-store'
import { ExportRegistry } from './export-video'
import { RenderRegistry } from './render-queue'
import { previewDirFor, type AppContext } from './trpc/context'
import { appRouter } from './trpc/router'
import { BlenderWorker } from './worker-bridge/worker-process'

export interface CreateServerOptions {
  root: string
  /** Ghi đè lệnh chạy worker — test dùng worker giả. */
  workerCommand?: { exec: string; args: string[] }
  /** Cổng để sinh URL tuyệt đối cho trang export; `listen()` cập nhật lại nếu khác. */
  port?: number
}

export interface AppServer {
  fastify: FastifyInstance
  worker: BlenderWorker
  context: AppContext
  listen(port: number): Promise<string>
  close(): Promise<void>
}

/**
 * Server là một tiến trình Node SỐNG LÂU sở hữu tiến trình con Blender.
 *
 * Đây là lý do không dùng Next.js: hot-reload theo module của nó nạp lại module mỗi
 * lần sửa code, và mỗi lần như thế rò một tiến trình Blender — trừ khi ghim singleton
 * vào `globalThis`, một mẹo lách chứ không phải thiết kế. Ở đây quyền sở hữu là tự
 * nhiên: server chết thì worker chết theo.
 */
export function createServer(options: CreateServerOptions): AppServer {
  const previewDir = previewDirFor(options.root)
  mkdirSync(previewDir, { recursive: true })

  const worker = new BlenderWorker({
    root: options.root,
    ...(options.workerCommand ? { command: options.workerCommand } : {}),
  })

  const renders = new RenderRegistry()
  const exports_ = new ExportRegistry(options.root)
  const context: AppContext = {
    root: options.root,
    previewDir,
    worker,
    renders,
    exports: exports_,
    port: options.port ?? 5174,
  }
  const fastify = Fastify({ logger: false })

  // Vite (5173) và Fastify (5174) là hai origin khác nhau, nên trình duyệt chặn cả
  // `fetch` (preflight OPTIONS thiếu header) lẫn WebSocket nếu không có CORS. Đây là
  // công cụ nội bộ chạy trên localhost, không phục vụ ra ngoài — origin cho phép chỉ
  // cần khớp cổng dev, không cần khớp domain.
  void fastify.register(fastifyCors, {
    origin: [/^http:\/\/(127\.0\.0\.1|localhost):5173$/],
  })

  void fastify.register(fastifyWebsocket)
  void fastify.register(fastifyStatic, {
    root: previewDir,
    prefix: '/preview/',
    // Tên file có UUID nên nội dung không bao giờ đổi dưới cùng một URL.
    cacheControl: true,
    maxAge: '1h',
  })

  // Thumbnail HDRI và ảnh test nằm trong `assets/`. `decorateReply: false` vì bản
  // static thứ hai không được decorate `reply.sendFile` lần nữa — Fastify sẽ throw.
  void fastify.register(fastifyStatic, {
    root: `${options.root}/assets`,
    prefix: '/assets/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '1h',
  })

  // Ảnh export và ảnh màn hình đã khớp tỉ lệ nằm trong `cache/` — UI cần xem được.
  void fastify.register(fastifyStatic, {
    root: `${options.root}/cache`,
    prefix: '/cache/',
    decorateReply: false,
  })

  // Bản build của UI. Trang export chạy từ đây nên nó CÙNG ORIGIN với API — Chrome headless
  // khỏi vướng CORS, và `video.currentTime` khỏi vướng chuyện cross-origin.
  const distDir = `${options.root}/dist`
  if (existsSync(distDir)) {
    void fastify.register(fastifyStatic, {
      root: distDir,
      prefix: '/app/',
      decorateReply: false,
    })
  }

  void fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext: () => context },
  })

  // Import file: thân yêu cầu là byte thô. Không dùng multipart để khỏi thêm dependency
  // cho một route duy nhất; client gửi thẳng `File` làm body.
  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 64 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  )

  /**
   * Mô tả job cho trang export. Trang tự lấy về thay vì nhận qua tham số URL: manifest có
   * bốn URL và một URL video, nhồi hết vào query string là đường ngắn nhất tới lỗi cắt chuỗi.
   */
  fastify.get('/export-job/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const spec = exports_.get(id)
    if (!spec) return reply.code(404).send({ error: 'không có job này' })
    return spec
  })

  /**
   * Trang export báo lỗi về đây.
   *
   * Có route riêng vì lỗi hoàn toàn có thể xảy ra TRƯỚC khi WebSocket kịp mở — và lúc đó không
   * còn kênh nào khác: log của Chrome headless toàn tiếng ồn của bộ cập nhật, còn job thì cứ
   * treo tới hết hạn giờ.
   */
  fastify.post('/export-fail/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { error } = (request.body ?? {}) as { error?: string }
    exports_.fail(id, `trang export báo lỗi: ${error ?? 'không rõ'}`)
    return reply.code(204).send()
  })

  fastify.post('/upload', async (request, reply) => {
    const extension = String((request.query as { ext?: string }).ext ?? 'png')
    const body = request.body
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      return reply.code(400).send({ error: 'thân yêu cầu rỗng' })
    }
    try {
      const asset = storeUpload(options.root, body, extension)
      return { asset: asset.relativePath, hash: asset.hash, bytes: asset.bytes }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })

  // Sự kiện vòng đời của worker. Không có kênh này thì worker chết đi là UI chỉ thấy
  // yêu cầu thất bại mà không biết vì sao — đúng kiểu lỗi im lặng Pha 10 phải dẹp.
  void fastify.register((instance, _opts, done) => {
    const sockets = new Set<{ send: (data: string) => void }>()

    const broadcast = (event: string, payload: unknown) => {
      const message = JSON.stringify({ event, payload })
      for (const socket of sockets) {
        try {
          socket.send(message)
        } catch {
          sockets.delete(socket)
        }
      }
    }

    // Khung hình từ trang export đi vào đây dưới dạng nhị phân THÔ rồi thẳng sang ffmpeg.
    // Không đi qua tRPC: mỗi khung 1080×1440 là 6.2 MB, base64 hoá nó là tăng 33% băng thông
    // và một vòng sao chép chuỗi cho mỗi khung.
    instance.get('/export-frames', { websocket: true }, (socket, request) => {
      const id = String((request.query as { job?: string }).job ?? '')
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          exports_.frame(id, data)
          return
        }
        try {
          const message = JSON.parse(data.toString()) as { done?: boolean; error?: string }
          if (message.error) exports_.fail(id, message.error)
          else if (message.done) exports_.finish(id)
        } catch {
          exports_.fail(id, 'trang export gửi thông điệp không đọc được')
        }
      })
    })

    worker.on('exit', (info) => broadcast('worker-exit', info))
    // Tiến trình render final: đi qua WebSocket vì một job Cycles có thể chạy 28 phút,
    // lâu hơn mọi timeout HTTP hợp lý.
    renders.onUpdate((info) => broadcast('render-update', info))
    worker.on('error', (error: Error) => broadcast('worker-error', { message: error.message }))

    instance.get('/ws', { websocket: true }, (connection) => {
      sockets.add(connection)
      connection.send(
        JSON.stringify({ event: 'hello', payload: { workerRunning: worker.isRunning } }),
      )
      connection.on('close', () => sockets.delete(connection))
    })
    done()
  })

  return {
    fastify,
    worker,
    context,
    async listen(port: number) {
      const address = await fastify.listen({ port, host: '127.0.0.1' })
      // Đọc cổng THẬT từ địa chỉ trả về, không dùng lại tham số: gọi `listen(0)` là để hệ điều
      // hành tự cấp cổng, và ghi lại số 0 thì URL của trang export thành `127.0.0.1:0` —
      // Chrome im lặng không kết nối được, job treo tới hết hạn giờ mà không có lỗi nào.
      const actual = Number(new URL(address).port)
      context.port = actual
      exports_.setPort(actual)
      return address
    },
    async close() {
      exports_.dispose()
      // Thứ tự quan trọng: đóng HTTP trước để không nhận thêm yêu cầu, rồi mới hạ
      // worker. Ngược lại thì yêu cầu đang bay sẽ gặp worker đã chết.
      await fastify.close()
      // Job render là tiến trình Blender riêng: không giết thì chúng sống sót qua cả
      // server và ngốn CPU cho một kết quả không ai nhận.
      renders.cancelAll()
      await worker.stop()
    },
  }
}
