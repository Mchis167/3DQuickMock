import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const api = vi.hoisted(() => ({
  sampleCurves: { mutate: vi.fn() },
  preview: { mutate: vi.fn() },
}))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { sampleCurves: api.sampleCurves, preview: api.preview },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

import { usePreview } from '@/features/static-mockup/use-preview'

import { useAutoKey } from './use-auto-key'
import { useCurveSample } from './use-curve-sample'

/**
 * Luồng dựng animation, chạy qua ĐÚNG các hook mà app dùng.
 *
 * Cổng này còn thiếu và đó là lý do một lỗi lọt: các test trước kiểm từng mảnh (thao tác
 * keyframe thuần, `evaluateAt` thuần, đường cong từ Blender thật) nhưng KHÔNG có phép kiểm
 * nào chạy cả chuỗi `useCurveSample → uiStore → evaluateAt → usePreview`. Lỗi nằm ở chỗ
 * nối, nơi không mảnh nào chịu trách nhiệm.
 *
 * Điều phải giữ: tua tới một frame nằm GIỮA hai keyframe thì yêu cầu preview mang giá trị
 * đã nội suy, không mang giá trị nền.
 */
function Harness() {
  useAutoKey()
  useCurveSample()
  usePreview()
  return null
}

function setup() {
  const document = createDocument({
    mode: 'video',
    timeline: { fps: 30, duration: 2, aspect: '3:4' },
  })
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
    curveSamples: null,
    preview: null,
    error: null,
  })
}

/** Đường cong tuyến tính 0 → 180 qua 60 frame, đúng như worker Blender sẽ trả về. */
const linearSpin = () => Array.from({ length: 60 }, (_, i) => (i / 59) * 180)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api.sampleCurves.mutate.mockReset()
  api.preview.mutate.mockReset()
  api.sampleCurves.mutate.mockImplementation((input: { frames: number[] }) =>
    Promise.resolve({ frames: input.frames, values: { 'device.spin_z': linearSpin() } }),
  )
  api.preview.mutate.mockResolvedValue({
    url: '/preview/x.png',
    ms: 1,
    liftMm: 0,
    bottomGapMm: 0,
  })
  setup()
})

const lastPreview = () =>
  api.preview.mutate.mock.calls[api.preview.mutate.mock.calls.length - 1]?.[0]

describe('luồng dựng animation, chạy qua các hook thật', () => {
  it('tua tới frame GIỮA hai keyframe thì preview nhận giá trị đã nội suy', async () => {
    render(<Harness />)

    // Hai keyframe: frame 1 = 0°, frame 60 = 180°.
    await act(async () => {
      useDocumentStore.getState().keyChannel('device.spin_z', 1)
      useSessionStore.getState().setPlayhead(60)
    })
    await act(async () => {
      useDocumentStore.getState().setPose({ spin_z: 180 })
    })

    // Chờ worker lấy mẫu xong.
    await waitFor(() => expect(api.sampleCurves.mutate).toHaveBeenCalled())
    await waitFor(() => expect(useSessionStore.getState().curveSamples).not.toBeNull())

    // Tua về giữa quãng.
    await act(async () => {
      useSessionStore.getState().setPlayhead(30)
      await vi.advanceTimersByTimeAsync(300)
    })

    await waitFor(() => {
      // Nếu chỗ nối hỏng thì con số ở đây là 180 (giá trị nền) hoặc 0 — tức là "chỉ
      // frame đầu và frame cuối đúng".
      expect(lastPreview()?.pose.spin_z).toBeCloseTo(linearSpin()[29]!, 1)
    })
  })

  it('lấy mẫu ĐỦ mọi frame của timeline, không chỉ các frame có keyframe', async () => {
    render(<Harness />)

    await act(async () => {
      useDocumentStore.getState().keyChannel('device.spin_z', 1)
      useSessionStore.getState().setPlayhead(60)
    })
    await act(async () => {
      useDocumentStore.getState().setPose({ spin_z: 180 })
      await vi.advanceTimersByTimeAsync(300)
    })

    await waitFor(() => {
      const sent = api.sampleCurves.mutate.mock.calls.at(-1)?.[0]
      expect(sent.frames).toHaveLength(60)
      expect(sent.frames[0]).toBe(1)
      expect(sent.frames[59]).toBe(60)
    })
  })

  it('mẫu cũ bị vứt khi keyframe đổi — không hiện đường cong của lần chỉnh trước', async () => {
    render(<Harness />)

    await act(async () => {
      useDocumentStore.getState().keyChannel('device.spin_z', 1)
      useSessionStore.getState().setPlayhead(60)
    })
    await act(async () => {
      useDocumentStore.getState().setPose({ spin_z: 180 })
      await vi.advanceTimersByTimeAsync(300)
    })
    await waitFor(() => expect(useSessionStore.getState().curveSamples).not.toBeNull())

    const before = api.sampleCurves.mutate.mock.calls.length
    await act(async () => {
      useDocumentStore.getState().moveKeyframe('device.spin_z', 60, 40)
      await vi.advanceTimersByTimeAsync(300)
    })

    await waitFor(() =>
      expect(api.sampleCurves.mutate.mock.calls.length).toBeGreaterThan(before),
    )
  })
})
