import { act, render, screen } from '@testing-library/react'
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
 * Cổng của UX Pha 6 (đợt 3): Control tab ở chế độ video chỉ hiện panel của LAYER đang
 * chọn. Keyframe và Video Settings đã TÁCH HẲN khỏi Control — Keyframe là một khối riêng
 * chỉ xuất hiện khi có `selectedKeyframe` (bất kể đang mở tab gì), Video Settings là một
 * tab riêng (`video`) cạnh Import/Control/Export. Ba thứ này không cùng mental model:
 * đổi layer hay đổi tab không được kéo theo trạng thái chọn keyframe hay ngược lại.
 */
function panelTitle(text: string) {
  return screen.queryByRole('heading', { name: text })
}

beforeEach(() => {
  api.preview.mutate.mockResolvedValue({
    url: '/preview/a.png',
    ms: 1,
    liftMm: 0,
    bottomGapMm: 0,
  })
  api.sampleCurves.mutate.mockResolvedValue({ frames: [], values: {} })
  api.previewAnimation.mutate.mockResolvedValue({ session: 'x', urls: [], ms: 1 })
  api.environments.query.mockResolvedValue({ reference: {}, presets: [] })
  api.health.query.mockResolvedValue({ blender: '/x', workerRunning: true, workerPid: 1 })

  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
    autoKeyFrame: null,
  })
  useSessionStore.setState({
    tab: 'control',
    activeAngleSet: 'camera',
    videoLayer: 'device',
    selectedKeyframe: null,
    preview: { url: '/preview/a.png', ms: 1, liftMm: 0, bottomGapMm: 0 },
    error: null,
  })
})

describe('mockup tĩnh', () => {
  it('vẫn hiện cả bốn panel cùng lúc — không có khái niệm layer ở đây', () => {
    render(<App />)
    expect(panelTitle('Angle')).toBeInTheDocument()
    expect(panelTitle('Framing')).toBeInTheDocument()
    expect(panelTitle('Floor')).toBeInTheDocument()
    expect(panelTitle('Environment')).toBeInTheDocument()
  })
})

describe('mockup video — Control theo layer', () => {
  beforeEach(() => {
    const document = createDocument({ mode: 'video' })
    useDocumentStore.setState({
      history: initHistory(document),
      document,
      canUndo: false,
      canRedo: false,
      autoKeyFrame: null,
    })
  })

  it('layer Device: chỉ hiện Angle + Floor, KHÔNG hiện Framing/Environment', () => {
    render(<App />)
    expect(panelTitle('Angle')).toBeInTheDocument()
    expect(panelTitle('Floor')).toBeInTheDocument()
    expect(panelTitle('Framing')).not.toBeInTheDocument()
    expect(panelTitle('Environment')).not.toBeInTheDocument()
    // Chưa chọn keyframe nào và đang ở tab Control — cả hai KHÔNG có mặt.
    expect(panelTitle('Keyframe')).not.toBeInTheDocument()
    expect(panelTitle('Video')).not.toBeInTheDocument()
  })

  it('có tab Video riêng, tách khỏi Control — và chỉ tồn tại ở chế độ video', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('tab', { name: 'Video' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Video' }))
    expect(panelTitle('Video')).toBeInTheDocument()
    // Sang tab Video thì các panel của Control biến mất — hai tab không chồng nội dung.
    expect(panelTitle('Angle')).not.toBeInTheDocument()
  })

  it('panel Keyframe chỉ hiện khi có keyframe được chọn, KHÔNG phụ thuộc tab đang mở', async () => {
    const user = userEvent.setup()
    render(<App />)

    await act(async () => {
      useSessionStore.getState().selectKeyframe({ channel: 'device.spin_z', frame: 1 })
    })
    expect(panelTitle('Keyframe')).toBeInTheDocument()

    // Chuyển sang tab Export — Keyframe vẫn còn đó, vì nó không thuộc tab nào cả.
    await user.click(screen.getByRole('tab', { name: 'Export' }))
    expect(panelTitle('Keyframe')).toBeInTheDocument()

    await act(async () => {
      useSessionStore.getState().selectKeyframe(null)
    })
    expect(panelTitle('Keyframe')).not.toBeInTheDocument()
  })

  it('rời chế độ video mà đang ở tab Video thì tự về Control', async () => {
    render(<App />)
    useSessionStore.getState().setTab('video')
    expect(useSessionStore.getState().tab).toBe('video')

    await act(async () => {
      useDocumentStore.getState().setMode('static')
    })
    expect(useSessionStore.getState().tab).toBe('control')
  })

  it('chuyển layer bằng LayerSwitch thì đổi panel hiện ra', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('radio', { name: 'Camera' }))
    expect(panelTitle('Framing')).toBeInTheDocument()
    expect(panelTitle('Floor')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Lighting' }))
    expect(panelTitle('Environment')).toBeInTheDocument()
    expect(panelTitle('Framing')).not.toBeInTheDocument()
  })

  it('chọn keyframe của Camera trong khi đang xem layer Device thì TỰ chuyển sang Camera', async () => {
    render(<App />)
    expect(panelTitle('Floor')).toBeInTheDocument()

    await act(async () => {
      useSessionStore.getState().selectKeyframe({ channel: 'camera.azimuth', frame: 1 })
    })

    expect(panelTitle('Framing')).toBeInTheDocument()
    expect(panelTitle('Floor')).not.toBeInTheDocument()
  })

  it('AnglePanel bị khoá bộ theo layer — không còn công tắc "Angle set" bên trong', () => {
    render(<App />)
    // Layer Device: AnglePanel hiện SPIN thẳng, không còn Segmented "Angle set" nội bộ —
    // layer đã quyết định thay, hai chỗ cùng chọn một việc là dư thừa và dễ lệch nhau.
    expect(screen.getByRole('slider', { name: 'Spin X' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Angle set' })).not.toBeInTheDocument()
    // Radio "Device" duy nhất còn lại là của LayerSwitch, không phải của AnglePanel.
    expect(screen.getAllByRole('radio', { name: 'Device' })).toHaveLength(1)
  })
})
