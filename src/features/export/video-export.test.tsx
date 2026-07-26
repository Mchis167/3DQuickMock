import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const api = vi.hoisted(() => ({ exportVideo: { mutate: vi.fn() } }))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { exportVideo: api.exportVideo },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

import { VideoExport } from './video-export'

const VIDEO = { url: '/cache/uploads/a.mp4', width: 1920, height: 1080 }
const PLATE = {
  res: [180, 240] as [number, number],
  files: {
    base: { url: '/b.bin', channels: 3, dtype: 'half' as const },
    t: { url: '/t.bin', channels: 3, dtype: 'half' as const },
    alpha: { url: '/a.bin', channels: 1, dtype: 'half' as const },
    uv: { url: '/uv.bin', channels: 3, dtype: 'float32' as const },
  },
}

beforeEach(() => {
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  useSessionStore.setState({ plate: null, plateSignature: null, video: VIDEO as never })
  api.exportVideo.mutate.mockReset()
  api.exportVideo.mutate.mockResolvedValue({
    jobId: 'j1',
    output: 'cache/exports/j1/mockup.mov',
    frames: 90,
    ms: 6080,
    plateMs: 14_000,
    bytes: 12_345_678,
    res: [1080, 1440],
    keepsAlpha: true,
  })
})

describe('VideoExport', () => {
  it('CHƯA có plate thì không cho render, và chỉ đúng chỗ bấm', () => {
    render(<VideoExport video={VIDEO} />)
    expect(screen.queryByRole('button', { name: /Render video/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Build the plate first/)).toBeInTheDocument()
  })

  it('gửi CẤU HÌNH cảnh, không gửi plate nháp của preview', async () => {
    // Plate của preview là bản nháp độ phân giải thấp. Gửi nó đi thì bản xuất ra mờ đúng bằng
    // preview. Gửi cấu hình thì server render lại ĐÚNG cảnh đó ở độ phân giải xuất.
    useSessionStore.setState({ plate: PLATE, plateSignature: 'sig' })
    render(<VideoExport video={VIDEO} />)
    await userEvent.click(screen.getByRole('button', { name: /Render video/ }))
    const sent = api.exportVideo.mutate.mock.calls[0]![0] as Record<string, unknown>
    expect(sent['plate']).toBeUndefined()
    expect(sent).toMatchObject({
      video: VIDEO.url,
      fps: 30,
      frames: 90,
      scale: 1,
      // Kích thước và chế độ khớp phải đi kèm: thiếu chúng thì server không tính được phép
      // khớp tỉ lệ và bản xuất ra sẽ luôn là `stretch`.
      source: { width: 1920, height: 1080 },
      fitMode: 'fill',
    })
    expect(sent['camera']).toBeDefined()
    expect(sent['world']).toBeDefined()
  })

  it('×2 và ×4 đổi độ phân giải xuất, và nói trước con số', async () => {
    useSessionStore.setState({ plate: PLATE, plateSignature: 'sig' })
    render(<VideoExport video={VIDEO} />)
    expect(screen.getByText(/1080×1440/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: '4×' }))
    expect(screen.getByText(/4320×5760/)).toBeInTheDocument()
    // ×4 là một render Cycles rất nặng — phải cảnh báo TRƯỚC khi người dùng bấm.
    expect(screen.getByText(/heavy Cycles render/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Render video/ }))
    expect(api.exportVideo.mutate).toHaveBeenCalledWith(expect.objectContaining({ scale: 4 }))
  })

  it('số khung = fps × thời lượng, và hiện ra trước khi bấm', async () => {
    useSessionStore.setState({ plate: PLATE, plateSignature: 'sig' })
    render(<VideoExport video={VIDEO} />)
    await userEvent.clear(screen.getByLabelText('Duration in seconds'))
    await userEvent.type(screen.getByLabelText('Duration in seconds'), '2')
    expect(screen.getByText(/60 frames/)).toBeInTheDocument()
  })

  it('cảnh báo mp4 mất alpha TRƯỚC khi render, không phải sau', async () => {
    useSessionStore.setState({ plate: PLATE, plateSignature: 'sig' })
    render(<VideoExport video={VIDEO} />)
    await userEvent.click(screen.getByRole('radio', { name: 'MP4' }))
    expect(screen.getByText(/NO alpha/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'MOV' }))
    expect(screen.getByText(/keeps alpha/)).toBeInTheDocument()
  })

  it('xong thì có nút tải về kèm số đo thật', async () => {
    useSessionStore.setState({ plate: PLATE, plateSignature: 'sig' })
    render(<VideoExport video={VIDEO} />)
    await userEvent.click(screen.getByRole('button', { name: /Render video/ }))
    await waitFor(() => expect(screen.getByTestId('video-output')).toBeInTheDocument())
    // Thời gian báo ra phải GỒM cả lúc render plate: người dùng đợi cả hai, nên báo mỗi phần
    // ghép sẽ ra một con số đẹp nhưng vô nghĩa.
    expect(screen.getByText(/done in 20.1s/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument()
  })
})
