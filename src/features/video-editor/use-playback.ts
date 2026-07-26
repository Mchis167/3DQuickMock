import { useCallback, useEffect, useRef } from 'react'

import {
  hasAnimation,
  lastFrame,
  PLAYBACK_SAMPLES,
  playbackResolution,
  renderChunks,
  screenFramePath,
} from '@/entities/animation'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { loadPlaybackImages, setPlaybackFrames } from '@/entities/session/playback-frames'
import { apiUrl, trpc } from '@/shared/api/trpc'

import { playbackSignature } from './playback-signature'

/**
 * Số frame mỗi lượt gọi server.
 *
 * Vì sao chia lượt: một lượt render 150 frame là ~12 giây trong đó UI không biết gì cả —
 * không tiến độ, không dừng được. Scene sống giữa các lượt nên chia nhỏ gần như không tốn
 * thêm (đo ở `bench_playback.py`). 24 frame ≈ 2 giây một nhịp cập nhật: đủ dày để thấy
 * tiến độ chạy, đủ thưa để không tốn vào chi phí gọi.
 */
const CHUNK = 24

/**
 * Space để phát lại — kiểu RAM preview của After Effects.
 *
 * Vì sao phải dựng dải ảnh trước chứ không render lúc đang phát: một frame EEVEE ở độ nét
 * phát lại mất ~81 ms, tức là phát trực tiếp chỉ được ~12 fps, và ở độ nét preview tĩnh thì
 * chỉ ~4 fps. Ở nhịp đó thì cái duy nhất mà việc phát lại dùng để đánh giá — chuyển động có
 * mượt và đúng nhịp không — hoàn toàn không quan sát được.
 *
 * Dải ảnh bị vứt khi cấu hình đổi (`playbackSignature`). Giữ lại là mời người dùng xem một
 * đoạn phim mượt của cấu hình cũ mà không có gì báo — bẫy plate của Pha 5.
 */
export function usePlayback() {
  const document = useDocumentStore((state) => state.document)
  const quality = useSessionStore((state) => state.previewQuality)
  const playing = useSessionStore((state) => state.playing)
  const cache = useSessionStore((state) => state.playbackCache)
  const building = useSessionStore((state) => state.playbackBuilding)
  const progress = useSessionStore((state) => state.playbackProgress)

  const setPlaying = useSessionStore((state) => state.setPlaying)
  const setCache = useSessionStore((state) => state.setPlaybackCache)
  const setBuilding = useSessionStore((state) => state.setPlaybackBuilding)
  const setProgress = useSessionStore((state) => state.setPlaybackProgress)
  const setPlayhead = useSessionStore((state) => state.setPlayhead)
  const setError = useSessionStore((state) => state.setError)

  const screenSequenceInfo = useSessionStore((state) => state.screenSequence)
  const signature = playbackSignature(document, quality, screenSequenceInfo)
  const stale = cache !== null && cache.signature !== signature

  /** Bấm Space lần nữa trong lúc đang dựng = dừng. Ref vì vòng lặp đọc nó giữa các lượt. */
  const abort = useRef(false)

  // Dải ảnh của cấu hình cũ phải biến mất NGAY khi cấu hình đổi, kể cả đang phát: phát
  // tiếp là chiếu một đoạn phim sai.
  useEffect(() => {
    if (!stale) return
    setCache(null)
    setPlaying(false)
    // Thả luôn bitmap: chúng là hàng chục megabyte của một cấu hình không còn dùng nữa.
    setPlaybackFrames(null)
  }, [stale, setCache, setPlaying])

  const build = useCallback(async () => {
    const doc = useDocumentStore.getState().document
    const frames = lastFrame(doc.timeline)
    const [width, height] = playbackResolution(doc.timeline)

    abort.current = false
    setBuilding(true)
    setProgress(0)
    try {
      const urls: string[] = []
      let session: string | undefined

      // Dải PNG của video, nếu có: đây là thứ cho phép màn hình phát video TRONG LÚC device
      // animate — plate không làm được việc đó (nó khoá cứng một góc camera).
      const sequence = useSessionStore.getState().screenSequence
      const clip = sequence ? doc.screenClip : null

      // Lượt phải cắt đúng mốc `clip.start`: từ mốc trở đi dùng dải ảnh, trước mốc dùng ảnh
      // tĩnh (khung đầu) — trước mốc Blender hiện màu magenta "thiếu texture", đã đo.
      for (const chunk of renderChunks(frames, CHUNK, clip)) {
        // Dừng giữa đường: những frame đã render vẫn nằm trên đĩa, nhưng KHÔNG cất vào
        // cache — một dải thiếu đuôi mà vẫn phát được là một dải nói dối.
        if (abort.current) return false

        const screenForChunk =
          chunk.sequence && sequence
            ? { screenSequence: { ...sequence, start: doc.screenClip.start } }
            : { screen: sequence ? screenFramePath(sequence.dir, 1) : doc.screen }

        const result = await trpc.previewAnimation.mutate({
          camera: doc.camera,
          pose: doc.pose,
          world: doc.world,
          ...screenForChunk,
          channels: doc.channels,
          fps: doc.timeline.fps,
          frames,
          from: chunk.from,
          to: chunk.to,
          ...(session ? { session } : {}),
          // Độ nét RIÊNG cho phát lại, không dùng mức của preview tĩnh: samples mới là chi
          // phí chính (16 → 4 spp rẻ đi 3×, đo ở bench_playback.py).
          quality: {
            engine: 'eevee' as const,
            res: [width, height],
            samples: PLAYBACK_SAMPLES,
          },
        })
        session = result.session
        urls.push(...result.urls)
        setProgress(chunk.to / frames)
      }

      // Nạp và GIỮ ảnh đã giải mã. Giữ là điểm cốt yếu: bỏ tham chiếu đi thì bitmap bị
      // thu hồi và mỗi khung phải tải + giải mã lại — xem `playback-frames.ts`.
      const images = await loadPlaybackImages(urls.map(apiUrl))
      if (abort.current) return false

      // Vân tay lấy lại từ trạng thái HIỆN TẠI, không phải từ lúc bắt đầu: nếu người dùng
      // đổi gì trong lúc dựng thì dải này đã sai, và effect `stale` phải vứt được nó.
      const fresh = playbackSignature(
        doc,
        useSessionStore.getState().previewQuality,
        useSessionStore.getState().screenSequence,
      )
      setPlaybackFrames({ signature: fresh, images })
      setCache({ signature: fresh, urls, fps: doc.timeline.fps })
      return true
    } catch (error) {
      setError(
        `Không dựng được dải phát lại: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    } finally {
      setBuilding(false)
      setProgress(null)
    }
  }, [setBuilding, setCache, setError, setProgress])

  const toggle = useCallback(async () => {
    const state = useSessionStore.getState()
    if (state.playing) {
      setPlaying(false)
      return
    }
    // Bấm lần nữa trong lúc đang dựng là DỪNG, không phải xếp thêm một lượt dựng.
    if (state.playbackBuilding) {
      abort.current = true
      return
    }

    const doc = useDocumentStore.getState().document
    if (doc.mode !== 'video' || !hasAnimation(doc.channels)) return

    const fresh =
      state.playbackCache?.signature ===
      playbackSignature(doc, state.previewQuality, state.screenSequence)
    if (!fresh && !(await build())) return

    setPlaying(true)
  }, [build, setPlaying])

  // ---------------------------------------------------------------- vòng lặp phát
  const clock = useRef<{ start: number; from: number } | null>(null)

  useEffect(() => {
    if (!playing || !cache) {
      clock.current = null
      return
    }

    const end = cache.urls.length
    clock.current = { start: performance.now(), from: useSessionStore.getState().playhead }
    let raf = 0

    const tick = (now: number) => {
      const state = clock.current
      if (state) {
        // Bám ĐỒNG HỒ THẬT, không cộng dồn mỗi khung: cộng dồn thì mỗi khung bị bỏ làm cả
        // đoạn chậm dần, và nhịp — thứ duy nhất đang cần đánh giá — sai đi.
        const elapsed = (now - state.start) / 1000
        const advanced = state.from + Math.floor(elapsed * cache.fps)
        // Lặp vô hạn: vòng 360° chỉ lộ ra chỗ khựng ở lần nối, nên phát một lượt rồi dừng
        // là bỏ mất đúng cái mà cảnh báo loop đang nói về.
        setPlayhead(((advanced - 1) % end) + 1)
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, cache, setPlayhead])

  // ----------------------------------------------------------------- phím Space
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      // Không giành phím khi đang gõ.
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Space vốn cuộn trang — phải chặn, nếu không mỗi lần phát là canvas nhảy.
      event.preventDefault()
      void toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return { playing, building, progress, cache, stale, toggle }
}
