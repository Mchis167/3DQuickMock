import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

import { IPHONE_17_PRO_MAX, deviceById } from '@/entities/device'
import { FIT_MODES, screenFitTransform, screenTargetSize } from '@/entities/screen-fit'
import { environmentLibrarySchema } from '@schema/environments'
import { cameraSchema, channelsSchema, poseSchema, worldSchema } from '@schema/scene-config'
import type { CHANNEL_KEYS } from '@schema/channels'

import type { AppContext } from './context'
import { flattenOnColor, prepareScreenImage } from '../asset-store'
import { RenderJob } from '../render-queue'
import { extractScreenSequence, SEQUENCE_PREFIX } from '../screen-sequence'
import { locateBlender } from '../worker-bridge/locate-blender'
import { SupersededError } from '../worker-bridge/queue'

const t = initTRPC.context<AppContext>().create()

export const publicProcedure = t.procedure

/**
 * Input dùng chung schema với config render (Pha 1) chứ không khai lại — khai lại là
 * cách nhanh nhất để hai bên trôi khỏi nhau.
 *
 * `.partial()` vì preview cho phép gửi từng phần: kéo một slider thì chỉ cần đúng
 * field vừa đổi.
 */
/** Độ phân giải gốc của bản xuất, trước khi nhân bội số ×1/×2/×4. */
const EXPORT_BASE_RESOLUTION = [1080, 1440] as const

const previewInput = z.object({
  camera: cameraSchema.partial().optional(),
  pose: poseSchema.partial().optional(),
  world: worldSchema.partial().extend({ hdri: z.string().min(1) }),
  screen: z.string().min(1).optional(),
  quality: z
    .object({
      engine: z.enum(['eevee', 'cycles']).default('eevee'),
      res: z.tuple([z.int().min(2).max(4096), z.int().min(2).max(4096)]).default([480, 640]),
      samples: z.int().min(1).max(512).default(16),
    })
    .partial()
    .optional(),
})

/**
 * Dựng dải ảnh cho PHÁT LẠI (RAM preview).
 *
 * Giới hạn 600 frame: ở draft EEVEE 0.26 s/frame thì 600 frame là ~2.6 phút chờ — quá
 * ngưỡng mà một thao tác tương tác còn hợp lý. Chặn bằng số thay vì để người dùng tự phát
 * hiện bằng cách chờ.
 */
const previewAnimInput = previewInput
  .extend({
    channels: channelsSchema,
    fps: z.int().min(1).max(240),
    frames: z.int().min(2).max(600),
    /**
     * Khoảng frame của lượt này. Client chia dải dài thành nhiều lượt để có tiến độ thật
     * và dừng được giữa đường — xem `use-playback.ts`.
     */
    from: z.int().min(1).max(600).default(1),
    to: z.int().min(1).max(600).optional(),
    /**
     * Thư mục của dải đang dựng, để các lượt sau ghi vào CÙNG chỗ.
     *
     * Bắt buộc là UUID: nó được ghép thẳng vào đường dẫn, nên một chuỗi tự do ở đây là
     * một lỗ ghi file ra ngoài `cache/`. Ràng buộc bằng kiểu rẻ hơn kiểm tra bằng tay.
     */
    session: z.uuid().optional(),
    /**
     * Dải ảnh dán lên màn hình cho lượt này — đây là cách phát video TRONG LÚC device
     * animate, thay cho plate (plate khoá cứng một góc nên vô dụng ở đây).
     *
     * `start` là frame TIMELINE mà khung đầu của video rơi vào; Blender giữ khung cuối sau
     * khi hết dải. Nhưng TRƯỚC `start` nó hiện màu magenta "thiếu texture" (đã đo), nên
     * lượt nào nằm trước `start` phải gửi `screen` (ảnh tĩnh) chứ không gửi field này —
     * `renderChunks` ở client chia đúng chỗ đó.
     */
    screenSequence: z
      .object({
        dir: z.string().min(1),
        frames: z.int().min(1).max(36000),
        start: z.int(),
      })
      .optional(),
  })
  .refine((v) => (v.to ?? v.frames) >= v.from, {
    message: 'khoảng frame rỗng: `to` phải >= `from`',
    path: ['to'],
  })
  .refine((v) => !(v.screenSequence && v.screen), {
    // Worker cũng chặn, nhưng chặn ở biên cho thông báo lỗi gắn đúng tên field.
    message: 'chỉ được gửi MỘT trong `screen` hoặc `screenSequence`',
    path: ['screenSequence'],
  })

const sampleInput = z.object({
  channels: channelsSchema,
  frames: z.array(z.number()).min(1).max(4096),
})

export const appRouter = t.router({
  /** Trạng thái để UI hiện lỗi rõ ràng thay vì im lặng — xem Pha 10. */
  health: publicProcedure.query(({ ctx }) => ({
    blender: locateBlender(),
    workerRunning: ctx.worker.isRunning,
    workerPid: ctx.worker.pid ?? null,
  })),

  meta: publicProcedure.query(async ({ ctx }) => {
    const reply = await ctx.worker.send({ cmd: 'meta' })
    return reply as unknown as {
      channels: string[]
      interpolations: string[]
      easings: string[]
    }
  }),

  /**
   * Thư viện môi trường. Đọc file mỗi lần gọi thay vì cache: file này do
   * `scripts/calibrate_env.py` sinh lại, cache sẽ giữ số cũ sau khi hiệu chuẩn lại.
   */
  environments: publicProcedure.query(({ ctx }) => {
    const file = path.join(ctx.root, 'assets/hdri/presets.json')
    const library = environmentLibrarySchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    return {
      reference: library.reference,
      presets: library.presets.map((preset) => ({
        ...preset,
        // URL phục vụ được, tách khỏi đường dẫn asset mà Blender cần.
        thumbnailUrl: `/${preset.thumbnail}`,
      })),
    }
  }),

  /** Dựng lại scene — chỉ cần khi đổi engine hoặc độ phân giải. */
  resetScene: publicProcedure
    .input(
      z.object({
        engine: z.enum(['eevee', 'cycles']).default('eevee'),
        res: z.tuple([z.int().min(2).max(4096), z.int().min(2).max(4096)]).default([480, 640]),
        samples: z.int().min(1).max(512).default(16),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.worker.send({ cmd: 'scene', ...input })
      return { ok: true as const }
    }),

  preview: publicProcedure.input(previewInput).mutation(async ({ ctx, input }) => {
    // Tên file duy nhất mỗi lần: browser cache theo URL, dùng lại tên thì ảnh cũ
    // dính lại và trông như preview bị đứng.
    const name = `still_${randomUUID()}.png`
    const out = path.join(ctx.previewDir, name)

    let reply
    try {
      reply = await ctx.worker.send(
        {
          cmd: 'still',
          out,
          ...(input.screen ? { screen: resolveAsset(ctx.root, input.screen) } : {}),
          ...(input.camera ? { camera: input.camera } : {}),
          ...(input.pose ? { pose: input.pose } : {}),
          world: { ...input.world, hdri: resolveAsset(ctx.root, input.world.hdri) },
          ...(input.quality ? { quality: input.quality as never } : {}),
        },
        // Kéo slider sinh ra hàng chục yêu cầu; chỉ cái mới nhất còn ý nghĩa.
        { coalesceKey: 'preview' },
      )
    } catch (error) {
      // Bị thay thế là chuyện BÌNH THƯỜNG khi kéo slider. Gắn mã CONFLICT để client
      // phân biệt được bằng mã, không phải bằng cách dò chuỗi thông báo.
      if (error instanceof SupersededError) {
        throw new TRPCError({ code: 'CONFLICT', message: error.message, cause: error })
      }
      throw error
    }

    return {
      url: `/preview/${name}`,
      ms: Number(reply['ms'] ?? 0),
      // Độ nâng do chế độ "đứng trên mặt phẳng" — UI hiện được, test kiểm được thay vì
      // phải suy đoán từ ảnh.
      liftMm: Number(reply['lift_mm'] ?? 0),
      bottomGapMm: Number(reply['bottom_gap_mm'] ?? 0),
    }
  }),

  /**
   * Dựng plate để client ghép video bằng WebGL — xem `scripts/blender/plate.py`.
   *
   * Trả về manifest chứ không trả ảnh: bốn buffer là dữ liệu THÔ (scene-linear half và
   * float32), không phải ảnh xem được. Đóng gói thành PNG là mất bit — spike Pha 2.5 đo
   * PNG 16-bit qua `<img>` bị trình duyệt hạ xuống 8 bit, lệch 5.01 px.
   *
   * BẮT BUỘC Cycles: light group là tính năng của Cycles, EEVEE không có (mà `lightgroups.add()`
   * vẫn chạy trót lọt và AOV vẫn xuất hiện — toàn số 0). Nên plate đắt hơn preview nhiều;
   * UI phải dựng nó khi người dùng THẢ chuột, không phải trong lúc kéo.
   */
  plate: publicProcedure.input(previewInput).mutation(async ({ ctx, input }) => {
    const id = randomUUID()
    const relative = `cache/plate/${id}`
    const reply = await ctx.worker.send(
      {
        cmd: 'plate',
        out_dir: path.join(ctx.root, relative),
        ...(input.screen ? { screen: resolveAsset(ctx.root, input.screen) } : {}),
        ...(input.camera ? { camera: input.camera } : {}),
        ...(input.pose ? { pose: input.pose } : {}),
        world: { ...input.world, hdri: resolveAsset(ctx.root, input.world.hdri) },
        quality: {
          ...(input.quality as object),
          // Ghi đè bất kể client gửi gì: plate mà chạy EEVEE thì T toàn số 0 và màn hình
          // đứng yên, không báo lỗi. Rào chắn thật nằm ở plate.py; đây chỉ là để không ai
          // vô tình rơi vào đó.
          engine: 'cycles' as const,
        },
      },
      // Đổi góc liên tục thì chỉ plate cuối cùng còn ý nghĩa.
      { coalesceKey: 'plate' },
    )

    const files = reply['files'] as Record<
      string,
      { path: string; channels: number; dtype: 'half' | 'float32' }
    >
    return {
      res: reply['res'] as [number, number],
      screenPx: Number(reply['screen_px'] ?? 0),
      ms: Number(reply['ms'] ?? 0),
      files: Object.fromEntries(
        Object.entries(files).map(([name, info]) => [
          name,
          {
            url: `/${relative}/${path.basename(info.path)}`,
            channels: info.channels,
            dtype: info.dtype,
          },
        ]),
      ) as Record<
        'base' | 't' | 'alpha' | 'uv',
        { url: string; channels: number; dtype: 'half' | 'float32' }
      >,
    }
  }),

  /**
   * Export video: Chrome headless ghép bằng ĐÚNG shader của preview, ffmpeg chỉ mã hoá.
   *
   * Nhận sẵn `plate` và `video` từ client thay vì tự dựng lại: client đang xem đúng plate đó,
   * và dựng lại một plate mới nghĩa là bản xuất ra khác bản đang xem — đúng thứ cả pha này
   * tồn tại để dẹp.
   */
  /**
   * Export video: Chrome headless ghép bằng ĐÚNG shader của preview, ffmpeg chỉ mã hoá.
   *
   * Nhận CẤU HÌNH cảnh chứ không nhận plate của preview, và dựng một plate mới ở độ phân giải
   * xuất. Nghe có vẻ ngược với "đừng dựng lại plate", nhưng khác biệt nằm ở chỗ khác nhau:
   *
   *   - dựng lại với cấu hình KHÁC  -> bản xuất khác bản đang xem. Cấm.
   *   - dựng lại với cấu hình HỆT, chỉ khác độ phân giải -> đúng cảnh đó, nét hơn. Đây là
   *     nghĩa của ×2/×4, và cũng là cách đường ảnh tĩnh vẫn làm từ Pha 4.
   *
   * Cấu hình gửi lên chắc chắn khớp plate đang xem, vì plate tự bị vứt ngay khi bất cứ trường
   * nào trong đó đổi (`usePlateInvalidation`) — nên client không thể gửi một cấu hình khác mà
   * vẫn còn plate để bấm nút.
   */
  exportVideo: publicProcedure
    .input(
      previewInput.extend({
        video: z.string().min(1),
        /** Kích thước thật của video — cần để tính phép khớp tỉ lệ trong shader. */
        source: z.object({ width: z.int().positive(), height: z.int().positive() }),
        fitMode: z.enum(FIT_MODES).default('fill'),
        /** Bội số so với 1080×1440. ×4 là 4320×5760 — một render Cycles rất nặng. */
        scale: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
        fps: z.int().min(1).max(120).default(30),
        frames: z.int().min(1).max(36000),
        name: z.string().min(1).default('mockup'),
        container: z.enum(['mov', 'mp4', 'webm']).default('mov'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = randomUUID()
      const base = `http://127.0.0.1:${ctx.port}`
      const fit = screenFitTransform(input.source, IPHONE_17_PRO_MAX.screenMm, input.fitMode)
      // `quality.res` là độ phân giải GỐC, `scale` là bội số nhân lên. Mặc định gốc là
      // 1080×1440 — độ phân giải xuất, không phải độ phân giải preview.
      const [baseWidth, baseHeight] = input.quality?.res ?? EXPORT_BASE_RESOLUTION
      const [width, height] = [baseWidth * input.scale, baseHeight * input.scale]

      const relative = `cache/plate/${id}`
      const reply = await ctx.worker.send({
        cmd: 'plate',
        out_dir: path.join(ctx.root, relative),
        ...(input.screen ? { screen: resolveAsset(ctx.root, input.screen) } : {}),
        ...(input.camera ? { camera: input.camera } : {}),
        ...(input.pose ? { pose: input.pose } : {}),
        world: { ...input.world, hdri: resolveAsset(ctx.root, input.world.hdri) },
        quality: {
          ...(input.quality as object),
          engine: 'cycles' as const,
          res: [width, height] as [number, number],
        },
      })
      const plateFiles = reply['files'] as Record<
        string,
        { path: string; channels: number; dtype: 'half' | 'float32' }
      >

      const spec = {
        id,
        manifest: {
          res: reply['res'] as [number, number],
          // URL tuyệt đối: trang export nạp từ origin của chính server này, nhưng đường tương
          // đối trong một trang phục vụ dưới `/app/` sẽ trỏ nhầm thư mục.
          files: Object.fromEntries(
            Object.entries(plateFiles).map(([name, file]) => [
              name,
              {
                url: `${base}/${relative}/${path.basename(file.path)}`,
                channels: file.channels,
                dtype: file.dtype,
              },
            ]),
          ),
        },
        videoUrl: `${base}${input.video}`,
        fps: input.fps,
        frames: input.frames,
        // Đặt tên tường minh chứ KHÔNG trải `...`: hàm trả về `{ scale, letterbox }` còn trang
        // đọc `contentScale`, và trải thẳng đã cho ra `undefined` ở phía trang.
        contentScale: fit.scale,
        letterbox: fit.letterbox,
      }

      const result = await ctx.exports.start(
        spec,
        `cache/exports/${id}/${input.name}.${input.container}`,
        undefined,
        // Mỗi khung phải tua, ghép, đọc ngược và mã hoá; ×4 thì mỗi khung là 4320×5760.
        Math.max(120_000, input.frames * 2_000 * input.scale),
      )
      return {
        jobId: id,
        ...result,
        res: [width, height] as [number, number],
        plateMs: Number(reply['ms'] ?? 0),
        keepsAlpha: input.container !== 'mp4',
      }
    }),

  /**
   * Áp chế độ khớp tỉ lệ cho ảnh vừa import.
   *
   * Trả về cả cờ `cropped/letterboxed/distorted` để UI nói TRƯỚC rằng ảnh sẽ bị cắt hay
   * méo, thay vì để người dùng tự phát hiện sau khi render.
   */
  prepareScreen: publicProcedure
    .input(
      z.object({
        asset: z.string().min(1),
        mode: z.enum(FIT_MODES),
        device: z.string().min(1).default(IPHONE_17_PRO_MAX.id),
        /** Chiều rộng ảnh màn hình. Mặc định = số pixel thật của iPhone 17 Pro Max. */
        width: z.int().min(64).max(8192).default(1179),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      resolveAsset(ctx.root, input.asset)
      const spec = deviceById(input.device) ?? IPHONE_17_PRO_MAX
      const target = screenTargetSize(spec.screenMm, input.width)
      const prepared = await prepareScreenImage(ctx.root, input.asset, input.mode, target)
      return {
        screen: prepared.relativePath,
        source: prepared.source,
        target,
        cropped: prepared.plan.cropped,
        letterboxed: prepared.plan.letterboxed,
        distorted: prepared.plan.distorted,
      }
    }),

  /**
   * Render final ra ảnh — tiến trình Blender RIÊNG, có tiến trình và huỷ được.
   *
   * Trả về ngay `jobId`; kết quả đi qua WebSocket. Chờ đồng bộ ở đây thì một bản Cycles
   * 28 phút sẽ làm timeout HTTP và UI mất luôn kết quả.
   */
  exportStill: publicProcedure
    .input(
      z.object({
        camera: cameraSchema.partial().optional(),
        pose: poseSchema.partial().optional(),
        world: worldSchema.partial().extend({ hdri: z.string().min(1) }),
        screen: z.string().min(1),
        engine: z.enum(['cycles', 'eevee']).default('cycles'),
        samples: z.int().min(1).max(4096).default(128),
        /** 1× = 1080×1440. 2× nhân đôi ĐỘ PHÂN GIẢI RENDER, không phóng ảnh lên sau. */
        scale: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
        /** `null` = giữ nền alpha. Mã màu = ghép lên nền đặc sau khi render. */
        background: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable()
          .default(null),
        name: z.string().min(1).max(80).default('mockup'),
      }),
    )
    .mutation(({ ctx, input }) => {
      // Kiểm file tồn tại NGAY, trước khi spawn: một bản Cycles có thể chạy 28 phút rồi
      // mới lộ ra là thiếu ảnh màn hình.
      for (const [field, value] of [
        ['screen', input.screen],
        ['world.hdri', input.world.hdri],
      ] as const) {
        if (!existsSync(resolveAsset(ctx.root, value))) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `${field} không tồn tại: ${value}`,
          })
        }
      }

      const id = randomUUID()
      const base = 1080
      const config = {
        schemaVersion: 1,
        screen: input.screen,
        world: input.world,
        ...(input.camera ? { camera: input.camera } : {}),
        ...(input.pose ? { pose: input.pose } : {}),
        render: {
          engine: input.engine,
          samples: input.samples,
          res: [base * input.scale, Math.round(base * (4 / 3)) * input.scale] as [
            number,
            number,
          ],
        },
        output: { dir: `cache/exports/${id}`, name: input.name },
      }

      const job = new RenderJob({
        id,
        root: ctx.root,
        config,
        outputDir: `cache/exports/${id}`,
        outputName: input.name,
        // Ghép nền màu SAU khi render, nhưng trước khi job báo xong. Làm trong Blender thì
        // màu đi qua tone map và không còn đúng mã người dùng chọn.
        ...(input.background
          ? {
              postProcess: async (absolute: string) => {
                await flattenOnColor(absolute, absolute, input.background as string)
              },
            }
          : {}),
      })

      ctx.renders.add(job)
      job.start()
      return { jobId: id, output: job.outputRelative, blender: job.pid ?? null }
    }),

  renderStatus: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      const job = ctx.renders.get(input.jobId)
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'không có job này' })
      return job.info
    }),

  cancelRender: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const job = ctx.renders.get(input.jobId)
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'không có job này' })
      job.cancel()
      return job.info
    }),

  /**
   * Render cả dải frame để PHÁT LẠI được ở đúng fps (RAM preview, kiểu After Effects).
   *
   * Vì sao phải cache thay vì render lúc phát: một frame draft EEVEE mất ~0.26 s, tức là
   * phát trực tiếp cho ~4 fps. Không cache thì "phát" chỉ là một chuỗi ảnh giật, và người
   * dùng không đánh giá được nhịp chuyển động — thứ duy nhất mà việc phát lại dùng để làm.
   *
   * Dùng `bpy.ops.render.render(animation=True)` của Blender chứ không gọi `still` 150
   * lần: vòng lặp của Blender giữ nguyên scene giữa các frame, còn 150 lượt gọi qua giao
   * thức thì mỗi lượt dựng lại cấu hình.
   */
  previewAnimation: publicProcedure.input(previewAnimInput).mutation(async ({ ctx, input }) => {
    const id = input.session ?? randomUUID()
    const relative = `cache/preview-anim/${id}`
    const reply = await ctx.worker.send(
      {
        cmd: 'anim',
        out_dir: path.join(ctx.root, relative),
        channels: input.channels,
        fps: input.fps,
        frames: input.frames,
        from: input.from,
        to: input.to ?? input.frames,
        ...(input.screen ? { screen: resolveAsset(ctx.root, input.screen) } : {}),
        ...(input.screenSequence
          ? {
              screen_sequence: {
                first: resolveAsset(
                  ctx.root,
                  `${input.screenSequence.dir}/${SEQUENCE_PREFIX}0001.png`,
                ),
                frames: input.screenSequence.frames,
                start: input.screenSequence.start,
              },
            }
          : {}),
        ...(input.camera ? { camera: input.camera } : {}),
        ...(input.pose ? { pose: input.pose } : {}),
        world: { ...input.world, hdri: resolveAsset(ctx.root, input.world.hdri) },
        ...(input.quality ? { quality: input.quality as never } : {}),
      },
      // Bấm phát lại lần nữa trong lúc đang dựng thì chỉ lần cuối còn ý nghĩa.
      { coalesceKey: 'preview-anim' },
    )

    const from = Number(reply['from'] ?? input.from)
    const to = Number(reply['to'] ?? input.to ?? input.frames)
    return {
      session: id,
      dir: relative,
      // Blender đánh số 4 chữ số từ 1. Suy ra tên chứ không đọc thư mục: đọc thư mục sẽ
      // trả về cả file dở dang nếu có job khác đang ghi.
      urls: Array.from(
        { length: to - from + 1 },
        (_, i) => `/${relative}/frame_${String(from + i).padStart(4, '0')}.png`,
      ),
      from,
      to,
      ms: Number(reply['ms'] ?? 0),
    }
  }),

  /**
   * Trích video thành dải PNG để dán lên màn hình theo từng frame.
   *
   * Đây là thứ cho phép "vừa xoay device vừa phát video" mà KHÔNG cần plate — plate khoá
   * cứng vào một góc camera nên nó vô dụng khi device đang animate. Xem `screen-sequence.ts`.
   *
   * Kết quả cache theo (asset, fps) nên gọi lại nhiều lần là rẻ.
   */
  screenSequence: publicProcedure
    .input(
      z.object({
        asset: z.string().min(1),
        fps: z.int().min(1).max(240),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Khoá cache phải là hàm THUẦN của (asset, fps) và an toàn để ghép vào đường dẫn.
      // Băm để tên thư mục không mang ký tự lạ từ tên file người dùng tải lên.
      const key = createHash('sha256')
        .update(`${input.asset}|${input.fps}`)
        .digest('hex')
        .slice(0, 16)
      // Vẫn đi qua `resolveAsset` để một `../../` trong `asset` không đọc được file ngoài repo.
      resolveAsset(ctx.root, input.asset)
      const sequence = await extractScreenSequence({
        root: ctx.root,
        asset: input.asset,
        fps: input.fps,
        key,
      })
      return sequence
    }),

  /**
   * Lấy mẫu đường cong. UI KHÔNG tự tính bezier — Blender tính, để đường vẽ trên màn
   * hình chắc chắn khớp kết quả render. Xem Architecture.md §9.
   */
  sampleCurves: publicProcedure.input(sampleInput).mutation(async ({ ctx, input }) => {
    const reply = await ctx.worker.send({
      cmd: 'sample',
      channels: input.channels,
      frames_list: input.frames,
    })
    return {
      frames: input.frames,
      values: reply['values'] as Partial<Record<(typeof CHANNEL_KEYS)[number], number[]>>,
    }
  }),
})

/**
 * Chặn đường dẫn thoát ra ngoài gốc repo. Server này chỉ chạy localhost, nhưng một
 * `../../` lọt vào đây là đọc được file bất kỳ trên máy — rẻ hơn nhiều nếu chặn ngay.
 */
function resolveAsset(root: string, p: string): string {
  const abs = path.resolve(root, p)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`đường dẫn asset nằm ngoài gốc repo: ${p}`)
  }
  return abs
}

export type AppRouter = typeof appRouter
