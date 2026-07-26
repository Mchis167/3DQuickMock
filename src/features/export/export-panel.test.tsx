import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'

const api = vi.hoisted(() => ({
  exportStill: { mutate: vi.fn() },
  cancelRender: { mutate: vi.fn() },
  emit: undefined as undefined | ((event: { event: string; payload: unknown }) => void),
}))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { exportStill: api.exportStill, cancelRender: api.cancelRender },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

// Cổng giả cho WebSocket: test không dựng server thật, nhưng vẫn phải chứng minh panel
// cập nhật theo sự kiện đến từ server.
vi.mock('@/shared/api/ws', () => ({
  connectEvents: (onEvent: (event: { event: string; payload: unknown }) => void) => {
    api.emit = onEvent
    return () => {
      api.emit = undefined
    }
  },
}))

import { ExportPanel } from './export-panel'

beforeEach(() => {
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  api.exportStill.mutate.mockReset()
  api.cancelRender.mutate.mockReset()
  api.exportStill.mutate.mockResolvedValue({
    jobId: 'job-1',
    output: 'cache/exports/job-1/mockup.png',
  })
})

function update(payload: Record<string, unknown>) {
  api.emit?.({ event: 'render-update', payload })
}

describe('ExportPanel', () => {
  it('mặc định là nền alpha và 1×', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    expect(api.exportStill.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ background: null, scale: 1 }),
    )
  })

  it('chọn nền màu thì gửi mã màu, không gửi null', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('radio', { name: 'Solid' }))
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    expect(api.exportStill.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ background: '#111111' }),
    )
  })

  it('2× gửi scale 2 và nói rõ độ phân giải', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('radio', { name: '2×' }))
    expect(screen.getByText(/2160×2880/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    expect(api.exportStill.mutate).toHaveBeenCalledWith(expect.objectContaining({ scale: 2 }))
  })

  it('theo tiến trình từ WebSocket', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    update({
      id: 'job-1',
      state: 'running',
      progress: { sample: 32, totalSamples: 128, fraction: 0.25 },
    })
    await waitFor(() => expect(screen.getByTestId('job-status')).toHaveTextContent('32/128'))
  })

  it('bỏ qua cập nhật của job KHÁC', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    update({
      id: 'job-1',
      state: 'running',
      progress: { sample: 10, totalSamples: 128, fraction: 0.08 },
    })
    await waitFor(() => expect(screen.getByTestId('job-status')).toHaveTextContent('10/128'))

    // Tab khác đang render job của nó; thanh tiến trình ở đây không được nhảy theo.
    update({
      id: 'job-khac',
      state: 'running',
      progress: { sample: 99, totalSamples: 128, fraction: 0.77 },
    })
    expect(screen.getByTestId('job-status')).toHaveTextContent('10/128')
  })

  it('huỷ gửi đúng jobId và không còn nút huỷ sau khi huỷ', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(api.cancelRender.mutate).toHaveBeenCalledWith({ jobId: 'job-1' })

    update({
      id: 'job-1',
      state: 'cancelled',
      progress: { sample: 12, totalSamples: 128, fraction: 0.1 },
    })
    await waitFor(() => expect(screen.getByTestId('job-status')).toHaveTextContent('cancelled'))
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument()
  })

  it('xong thì có link tải ảnh', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    update({
      id: 'job-1',
      state: 'done',
      progress: { sample: 128, totalSamples: 128, fraction: 1 },
      output: 'cache/exports/job-1/mockup.png',
      ms: 42_000,
    })
    // Không phải `<a download>`: ảnh nằm ở origin của API server, trình duyệt bỏ qua thuộc
    // tính `download` cross-origin và điều hướng thẳng sang ảnh thay vì tải về. Panel fetch
    // thành blob rồi mới tạo link cùng origin — nên bằng chứng ở đây là URL được fetch.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })

    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('http://test/cache/exports/job-1/mockup.png'),
    )
    vi.unstubAllGlobals()
    expect(screen.getByTestId('job-status')).toHaveTextContent('42.0s')
  })

  it('thất bại thì hiện lỗi, không im lặng', async () => {
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Render/ }))
    update({
      id: 'job-1',
      state: 'failed',
      progress: { sample: 0, totalSamples: 0, fraction: 0 },
      error: 'ConfigError: world.hdri thiếu\n',
    })
    await waitFor(() => expect(screen.getByTestId('job-status')).toHaveTextContent('failed'))
  })
})
