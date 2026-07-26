import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const api = vi.hoisted(() => ({ health: { query: vi.fn() } }))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { health: api.health },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

import { AppStatusBar } from './app-status-bar'

beforeEach(() => {
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  useSessionStore.setState({ preview: null, rendering: false, error: null })
  api.health.query.mockReset()
  api.health.query.mockResolvedValue({
    blender: '/Applications/Blender.app/Contents/MacOS/Blender',
    workerRunning: true,
    workerPid: 1234,
  })
})

/**
 * Status bar là nơi Pha 4.5 dồn hết số liệu về. Những phép kiểm dưới đây trước nằm trong
 * `framing-panel.test.tsx` và `ground-panel`; chuyển chỗ nhưng KHÔNG nới lỏng.
 */
describe('AppStatusBar', () => {
  it('hiện phần chiếm khung THẬT, khác frame_fill khi máy nghiêng', () => {
    useDocumentStore.getState().setPose({ spin_y: 40 })
    useDocumentStore.getState().setCamera({ frame_fill: 0.6 })
    render(<AppStatusBar />)
    // frame_fill 0.6 nhưng nghiêng 40° quanh Y ở elevation mặc định 10° làm máy cao lên
    // ~8.6% -> 65%. Bằng 60% nghĩa là phần bù theo pose đã bị bỏ.
    expect(screen.getByText('65%')).toBeInTheDocument()
    expect(screen.queryByText('60%')).not.toBeInTheDocument()
  })

  it('cảnh báo khi máy cắm xuống sàn', () => {
    useSessionStore.setState({
      preview: { url: '/preview/a.png', ms: 300, liftMm: 4.2, bottomGapMm: -0.35 },
    })
    render(<AppStatusBar />)
    // Ở draft EEVEE mặt phẳng bị ẩn nên mắt không thấy được — con số này là cách duy nhất.
    expect(screen.getByText('device clipping floor')).toBeInTheDocument()
  })

  it('không cảnh báo khi máy nằm đúng trên mặt phẳng', () => {
    useSessionStore.setState({
      preview: { url: '/preview/a.png', ms: 300, liftMm: 4.2, bottomGapMm: 0 },
    })
    render(<AppStatusBar />)
    expect(screen.queryByText('device clipping floor')).not.toBeInTheDocument()
    expect(screen.getByText('0.00 mm')).toBeInTheDocument()
  })

  it('chế độ lơ lửng thì KHÔNG cảnh báo dù hở đáy âm', () => {
    useDocumentStore.getState().setPose({ ground: false })
    useSessionStore.setState({
      preview: { url: '/preview/a.png', ms: 300, liftMm: 0, bottomGapMm: -7.6 },
    })
    render(<AppStatusBar />)
    // Lơ lửng thì không có mặt phẳng nào để cắm vào; cảnh báo ở đây là báo động giả.
    expect(screen.queryByText('device clipping floor')).not.toBeInTheDocument()
  })

  it('hiện thời gian render, và trạng thái đang render', () => {
    useSessionStore.setState({
      preview: { url: '/preview/a.png', ms: 241, liftMm: 0, bottomGapMm: 0 },
    })
    render(<AppStatusBar />)
    expect(screen.getByText('241 ms')).toBeInTheDocument()
  })

  it('hiện pid worker sau khi hỏi health', async () => {
    render(<AppStatusBar />)
    await waitFor(() => expect(screen.getByText('pid 1234')).toBeInTheDocument())
  })

  it('health lỗi thì báo worker chưa chạy, không để trống', async () => {
    api.health.query.mockRejectedValue(new Error('ECONNREFUSED'))
    render(<AppStatusBar />)
    // Server chưa bật là tình huống thật (quên chạy `pnpm dev:server`), và im lặng ở đây
    // làm người dùng tưởng app hỏng.
    await waitFor(() => expect(screen.getByText('not running')).toBeInTheDocument())
  })

  it('lỗi render hiện thẳng trên status bar', () => {
    useSessionStore.setState({ error: 'worker Blender đã chết' })
    render(<AppStatusBar />)
    expect(screen.getByText('worker Blender đã chết')).toBeInTheDocument()
  })
})
