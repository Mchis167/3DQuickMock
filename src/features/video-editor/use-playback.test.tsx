import { act, render, renderHook, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setKeyframe } from '@/entities/animation'
import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const api = vi.hoisted(() => ({ previewAnimation: { mutate: vi.fn() } }))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { previewAnimation: api.previewAnimation },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

import { usePlayback } from './use-playback'

/**
 * jsdom không nạp ảnh thật nên `onload` không bao giờ bắn, và `preload()` sẽ treo vĩnh
 * viễn. Cổng giả bắn `onload` ở microtask sau — giữ đúng tính bất đồng bộ mà không chờ mạng.
 */
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

/**
 * Dải được render theo LƯỢT 24 frame, nên timeline 60 frame là 3 lượt gọi. Cổng giả bám
 * đúng hình dạng đó: mỗi lượt trả URL của khoảng nó nhận, cộng `session` để lượt sau ghi
 * vào cùng thư mục.
 */
const SESSION = '11111111-2222-3333-4444-555555555555'

function chunkReply(input: { from: number; to?: number; frames: number }) {
  const from = input.from
  const to = input.to ?? input.frames
  return {
    session: SESSION,
    dir: `cache/preview-anim/${SESSION}`,
    urls: Array.from(
      { length: to - from + 1 },
      (_, i) => `/cache/preview-anim/${SESSION}/frame_${String(from + i).padStart(4, '0')}.png`,
    ),
    from,
    to,
    ms: 200,
  }
}

function animatedDocument() {
  const document = createDocument({
    mode: 'video',
    timeline: { fps: 30, duration: 2, aspect: '3:4' },
  })
  setKeyframe(document.channels, 'device.spin_z', 1, 0, { interpolation: 'LINEAR' })
  setKeyframe(document.channels, 'device.spin_z', 60, 360, { interpolation: 'LINEAR' })
  return document
}

function setup(document = animatedDocument()) {
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
    autoKeyFrame: null,
  })
  useSessionStore.setState({
    playhead: 1,
    playing: false,
    playbackCache: null,
    playbackBuilding: false,
    error: null,
  })
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  api.previewAnimation.mutate.mockReset()
  api.previewAnimation.mutate.mockImplementation((input) => Promise.resolve(chunkReply(input)))
  setup()
})

describe('phát lại', () => {
  it('bấm phát lần đầu thì dựng dải ảnh rồi mới phát', async () => {
    const { result } = renderHook(() => usePlayback())

    await act(async () => {
      await result.current.toggle()
    })

    // 60 frame / 24 mỗi lượt = 3 lượt.
    expect(api.previewAnimation.mutate).toHaveBeenCalledTimes(3)
    const sent = api.previewAnimation.mutate.mock.calls[0]![0]
    expect(sent.frames).toBe(60)
    expect(sent.fps).toBe(30)
    expect(sent.channels['device.spin_z']).toBeDefined()
    // Độ nét RIÊNG cho phát lại: 4 spp, không phải 16 spp của preview tĩnh.
    expect(sent.quality.samples).toBe(4)

    // Lượt sau phải ghi vào CÙNG thư mục, nếu không dải bị xé thành ba chỗ.
    const later = api.previewAnimation.mutate.mock.calls.slice(1).map((c) => c[0])
    for (const call of later) expect(call.session).toBe(SESSION)
    expect(later.map((c) => c.from)).toEqual([25, 49])

    expect(useSessionStore.getState().playing).toBe(true)
    // Dải phải ĐỦ 60 frame, đúng thứ tự — thiếu đuôi là phát ra một clip cụt.
    const urls = useSessionStore.getState().playbackCache?.urls ?? []
    expect(urls).toHaveLength(60)
    expect(urls[0]).toMatch(/frame_0001\.png$/)
    expect(urls[59]).toMatch(/frame_0060\.png$/)
  })

  it('bấm lần hai chỉ dừng, KHÔNG render lại', async () => {
    const { result } = renderHook(() => usePlayback())
    await act(async () => {
      await result.current.toggle()
    })
    await act(async () => {
      await result.current.toggle()
    })

    expect(useSessionStore.getState().playing).toBe(false)
    expect(api.previewAnimation.mutate).toHaveBeenCalledTimes(3)
  })

  it('phát lại lần sau dùng dải đã có — không gọi Blender nữa', async () => {
    const { result } = renderHook(() => usePlayback())
    await act(async () => {
      await result.current.toggle()
    })
    await act(async () => {
      await result.current.toggle()
    })
    await act(async () => {
      await result.current.toggle()
    })

    expect(useSessionStore.getState().playing).toBe(true)
    expect(api.previewAnimation.mutate).toHaveBeenCalledTimes(3)
  })

  it('đổi góc là VỨT dải cũ và dừng phát — không chiếu phim của cấu hình cũ', async () => {
    const { result, rerender } = renderHook(() => usePlayback())
    await act(async () => {
      await result.current.toggle()
    })
    expect(useSessionStore.getState().playing).toBe(true)

    await act(async () => {
      useDocumentStore.getState().setCamera({ elevation: 40 })
      rerender()
    })

    await waitFor(() => {
      expect(useSessionStore.getState().playbackCache).toBeNull()
      expect(useSessionStore.getState().playing).toBe(false)
    })
  })

  it('tiến độ chạy theo từng lượt, không đứng ở 0 rồi nhảy về null', async () => {
    const seen: (number | null)[] = []
    const unsubscribe = useSessionStore.subscribe((state) => {
      const last = seen[seen.length - 1]
      if (state.playbackProgress !== last) seen.push(state.playbackProgress)
    })

    const { result } = renderHook(() => usePlayback())
    await act(async () => {
      await result.current.toggle()
    })
    unsubscribe()

    // 3 lượt trên 60 frame: 24/60, 48/60, 60/60. Đây là tiến độ THẬT (server trả lời từng
    // lượt), không phải một thanh chạy giả.
    expect(seen.filter((p): p is number => typeof p === 'number')).toEqual([
      0,
      24 / 60,
      48 / 60,
      1,
    ])
    expect(seen[seen.length - 1]).toBeNull()
  })

  it('bấm Space lúc đang dựng thì DỪNG, và không cất dải thiếu đuôi vào cache', async () => {
    // Chặn ở lượt thứ hai: lượt đầu xong, rồi người dùng bấm dừng.
    let calls = 0
    api.previewAnimation.mutate.mockImplementation(async (input) => {
      calls += 1
      if (calls === 2) {
        // Dừng NGAY trước khi lượt này trả về, mô phỏng bấm Space giữa đường.
        useSessionStore.setState({ playbackBuilding: true })
        await Promise.resolve()
      }
      return chunkReply(input)
    })

    const { result } = renderHook(() => usePlayback())
    const run = act(async () => {
      const started = result.current.toggle()
      // Ngắt trong lúc lượt đang bay.
      await Promise.resolve()
      await result.current.toggle()
      await started
    })
    await run

    expect(useSessionStore.getState().playing).toBe(false)
    // Dải KHÔNG được cất: một dải thiếu đuôi mà vẫn phát được là một dải nói dối.
    expect(useSessionStore.getState().playbackCache).toBeNull()
    // Và không chạy nốt cả 3 lượt.
    expect(api.previewAnimation.mutate.mock.calls.length).toBeLessThan(3)
  })

  it('chưa có keyframe nào thì không phát và không gọi Blender', async () => {
    setup(createDocument({ mode: 'video' }))
    const { result } = renderHook(() => usePlayback())

    await act(async () => {
      await result.current.toggle()
    })

    expect(api.previewAnimation.mutate).not.toHaveBeenCalled()
    expect(useSessionStore.getState().playing).toBe(false)
  })

  it('chế độ tĩnh thì Space không làm gì', async () => {
    const document = animatedDocument()
    document.mode = 'static'
    setup(document)
    const { result } = renderHook(() => usePlayback())

    await act(async () => {
      await result.current.toggle()
    })
    expect(useSessionStore.getState().playing).toBe(false)
  })

  it('lỗi render thì nói ra và KHÔNG phát', async () => {
    api.previewAnimation.mutate.mockRejectedValue(new Error('Blender chết'))
    const { result } = renderHook(() => usePlayback())

    await act(async () => {
      await result.current.toggle()
    })

    expect(useSessionStore.getState().playing).toBe(false)
    expect(useSessionStore.getState().error).toMatch(/Blender chết/)
  })
})

describe('phím Space', () => {
  function Harness() {
    usePlayback()
    return <input aria-label="số" />
  }

  it('Space trên trang thì phát', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await act(async () => {
      await user.keyboard(' ')
    })
    await waitFor(() => expect(useSessionStore.getState().playing).toBe(true))
  })

  it('Space trong ô nhập thì KHÔNG phát — người dùng đang gõ', async () => {
    const user = userEvent.setup()
    const { getByLabelText } = render(<Harness />)

    getByLabelText('số').focus()
    await act(async () => {
      await user.keyboard(' ')
    })

    expect(api.previewAnimation.mutate).not.toHaveBeenCalled()
    expect(useSessionStore.getState().playing).toBe(false)
  })
})

/**
 * Vòng lặp phát — chỗ CHƯA có phép kiểm nào, và là chỗ người dùng báo lỗi: "ấn play là
 * nó chỉ hiển thị frame cuối luôn".
 *
 * Điều phải giữ: playhead phải CHẠY theo đồng hồ, và phải quay vòng về 1 khi hết dải.
 */
describe('vòng lặp phát', () => {
  /** rAF giả có điều khiển: mỗi `step(ms)` là một khung, với mốc thời gian tăng thật. */
  function fakeRaf() {
    let now = 0
    let callbacks: ((t: number) => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      callbacks.push(cb)
      return callbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('performance', { now: () => now })
    return {
      step(ms: number) {
        now += ms
        const due = callbacks
        callbacks = []
        for (const cb of due) cb(now)
      },
    }
  }

  it('playhead chạy theo đồng hồ và quay vòng, không đứng ở một frame', async () => {
    const clock = fakeRaf()
    const { result } = renderHook(() => usePlayback())
    await act(async () => {
      await result.current.toggle()
    })
    expect(useSessionStore.getState().playing).toBe(true)

    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        // 1/30 giây một khung ở 30 fps = tiến đúng một frame.
        clock.step(1000 / 30)
      })
      seen.push(useSessionStore.getState().playhead)
    }

    expect(seen).toEqual([2, 3, 4, 5, 6, 7])
  })

  it('bắt đầu từ frame CUỐI thì quay vòng về 1, không đứng lại ở cuối', async () => {
    const clock = fakeRaf()
    useSessionStore.setState({ playhead: 60 })
    const { result } = renderHook(() => usePlayback())
    await act(async () => {
      await result.current.toggle()
    })

    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        clock.step(1000 / 30)
      })
      seen.push(useSessionStore.getState().playhead)
    }

    // Đây chính là triệu chứng người dùng báo: đứng ở frame cuối thì phải chạy tiếp,
    // không được dính lại.
    expect(seen).toEqual([1, 2, 3])
  })
})
