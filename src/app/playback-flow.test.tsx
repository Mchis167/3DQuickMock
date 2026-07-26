import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const api = vi.hoisted(() => ({
  preview: { mutate: vi.fn() },
  sampleCurves: { mutate: vi.fn() },
  previewAnimation: { mutate: vi.fn() },
  environments: { query: vi.fn() },
  health: { query: vi.fn() },
}))

vi.mock('@/shared/api/trpc', () => ({
  trpc: api,
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

vi.mock('@/features/static-mockup/video-composite', () => ({
  VideoComposite: () => <div data-testid="video-composite" />,
}))

import { App } from './App'

/**
 * Phát lại, chạy qua CẢ App như người dùng thật dùng.
 *
 * Vì sao phải có phép kiểm ở tầng này: vòng lặp phát có test riêng và chạy đúng; canvas có
 * test riêng và đổi ảnh đúng; server đã đo và render đủ 150 frame khác nhau. Nhưng người
 * dùng báo "ấn play là nó chỉ hiển thị frame cuối". Nếu ba mảnh đều đúng mà tổng thể sai
 * thì lỗi nằm ở CHỖ LẮP — và chỉ phép kiểm ở tầng lắp mới thấy.
 */
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 360
  naturalHeight = 480
  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

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
    ms: 100,
  }
}

/** rAF giả có điều khiển, cùng mốc thời gian với `performance.now`. */
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
    async step(ms: number) {
      now += ms
      const due = callbacks
      callbacks = []
      await act(async () => {
        for (const cb of due) cb(now)
      })
    },
  }
}

const FPS = 30
const FRAMES = 60

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  api.preview.mutate.mockResolvedValue({
    url: '/preview/still.png',
    ms: 1,
    liftMm: 0,
    bottomGapMm: 0,
  })
  api.sampleCurves.mutate.mockImplementation((input: { frames: number[] }) =>
    Promise.resolve({
      frames: input.frames,
      values: { 'device.spin_z': input.frames.map((f) => ((f - 1) / (FRAMES - 1)) * 360) },
    }),
  )
  api.previewAnimation.mutate.mockReset()
  api.previewAnimation.mutate.mockImplementation((input) => Promise.resolve(chunkReply(input)))
  api.environments.query.mockResolvedValue({ reference: {}, presets: [] })
  api.health.query.mockResolvedValue({ blender: '/x', workerRunning: true, workerPid: 1 })

  // Bắt đầu ở đúng trạng thái người dùng có sau khi dựng animation: chế độ video, hai
  // keyframe, playhead đang ĐỨNG Ở FRAME CUỐI (chỗ họ vừa chốt key).
  const document = createDocument({
    mode: 'video',
    timeline: { fps: FPS, duration: FRAMES / FPS, aspect: '3:4' },
  })
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
    autoKeyFrame: null,
  })
  useSessionStore.setState({
    tab: 'control',
    zoom: 'fit',
    previewQuality: 'med',
    preview: { url: '/preview/still.png', ms: 1, liftMm: 0, bottomGapMm: 0 },
    plate: null,
    video: null,
    playhead: 1,
    playing: false,
    playbackCache: null,
    playbackBuilding: false,
    playbackProgress: null,
    curveSamples: null,
    error: null,
  })
})

const playbackCanvas = () => screen.getByLabelText('Playback frame')

async function buildAnimation(user: ReturnType<typeof userEvent.setup>) {
  // Key cả layer Device ở frame 1, rồi sang frame cuối và xoay — đúng luồng người dùng.
  await user.click(screen.getByLabelText('Key Device'))
  await act(async () => {
    useSessionStore.getState().setPlayhead(FRAMES)
  })
  await act(async () => {
    useDocumentStore.getState().setPose({ spin_z: 360 })
  })
  await waitFor(() =>
    expect(
      useDocumentStore.getState().document.channels['device.spin_z']?.keyframes,
    ).toHaveLength(2),
  )
}

describe('phát lại trong App thật', () => {
  it('ấn play thì ảnh trên canvas CHẠY, không dính ở frame cuối', async () => {
    const user = userEvent.setup()
    const clock = fakeRaf()
    render(<App />)
    await buildAnimation(user)

    await act(async () => {
      await user.click(screen.getByLabelText('Play'))
    })

    await waitFor(() => expect(useSessionStore.getState().playing).toBe(true))

    const frames: string[] = [playbackCanvas().getAttribute('data-frame') ?? '']
    for (let i = 0; i < 5; i++) {
      await clock.step(1000 / FPS)
      frames.push(playbackCanvas().getAttribute('data-frame') ?? '')
    }

    // Điều phải giữ: frame CHẠY. Dính một chỗ là đúng lỗi người dùng báo.
    expect(new Set(frames).size).toBeGreaterThan(3)
    // Bắt đầu ở frame cuối (chỗ người dùng vừa chốt key) rồi quay vòng về đầu.
    expect(frames).toEqual([String(FRAMES), '1', '2', '3', '4', '5'])
  })

  it('dải phát lại KHÔNG bị vứt ngay sau khi dựng xong', async () => {
    const user = userEvent.setup()
    fakeRaf()
    render(<App />)
    await buildAnimation(user)

    await act(async () => {
      await user.click(screen.getByLabelText('Play'))
    })

    // Nếu vân tay lệch giữa lúc dựng và lúc render thì effect `stale` vứt dải, `playing`
    // về false, và canvas quay lại preview tĩnh — đứng im ở frame đang đậu.
    await waitFor(() => expect(useSessionStore.getState().playbackCache).not.toBeNull())
    expect(useSessionStore.getState().playing).toBe(true)
  })
})
