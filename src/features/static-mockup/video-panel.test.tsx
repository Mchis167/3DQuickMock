import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const api = vi.hoisted(() => ({ prepareScreen: { mutate: vi.fn() } }))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { prepareScreen: api.prepareScreen },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

// jsdom không có canvas 2D thật nên không giải mã được video; cổng giả trả đúng hình dạng dữ
// liệu mà panel cần.
vi.mock('./first-frame', () => ({
  extractFirstFrame: vi.fn().mockResolvedValue({
    blob: new Blob(['png']),
    width: 1080,
    height: 1920,
    duration: 3,
  }),
}))

import { VideoPanel } from './video-panel'

beforeEach(() => {
  vi.restoreAllMocks()
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  useSessionStore.setState({ video: null, plate: null, plateSignature: null })
  api.prepareScreen.mutate.mockReset()
  api.prepareScreen.mutate.mockResolvedValue({ screen: 'cache/screens/frame.png' })
})

async function importVideo() {
  const uploads: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      uploads.push(url)
      return Promise.resolve({
        ok: true,
        json: async () => ({
          asset: url.includes('png') ? 'cache/uploads/f.png' : 'cache/uploads/a.mp4',
        }),
      })
    }),
  )
  render(<VideoPanel />)
  await userEvent.upload(
    screen.getByLabelText('Choose video'),
    new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
  )
  await waitFor(() => expect(useSessionStore.getState().video).not.toBeNull())
  return uploads
}

describe('VideoPanel', () => {
  it('import video thì dán ngay KHUNG ĐẦU lên màn hình như ảnh tĩnh', async () => {
    // Điểm mấu chốt của luồng: không có khung đầu thì người dùng buộc phải dựng plate (hàng
    // chục giây, và nó đóng băng góc) TRƯỚC khi biết mình muốn góc nào.
    await importVideo()
    expect(api.prepareScreen.mutate).toHaveBeenCalledWith({
      asset: 'cache/uploads/f.png',
      mode: 'fill',
    })
    await waitFor(() =>
      expect(useDocumentStore.getState().document.screen).toBe('cache/screens/frame.png'),
    )
    vi.unstubAllGlobals()
  })

  it('tải lên CẢ video lẫn khung đầu, mỗi thứ đúng phần mở rộng', async () => {
    const uploads = await importVideo()
    expect(uploads.some((url) => url.includes('ext=mp4'))).toBe(true)
    expect(uploads.some((url) => url.includes('ext=png'))).toBe(true)
    vi.unstubAllGlobals()
  })

  it('ghi nhận kích thước THẬT của video, không đoán', async () => {
    await importVideo()
    expect(useSessionStore.getState().video).toEqual({
      url: '/cache/uploads/a.mp4',
      width: 1080,
      height: 1920,
    })
    expect(screen.getByText(/1080×1920/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('panel KHÔNG có nút dựng plate — nút đó thuộc về canvas', async () => {
    // Dựng plate là việc làm SAU khi chỉnh xong góc, nên nút phải nằm ngay cạnh mockup chứ
    // không nằm trong panel import ở tận bên phải.
    await importVideo()
    expect(screen.queryByRole('button', { name: /plate/i })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('bỏ video thì plate bị vứt theo', async () => {
    await importVideo()
    useSessionStore.setState({
      plate: { res: [8, 10], files: {} } as never,
      plateSignature: 'x',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Remove video' }))
    expect(useSessionStore.getState().video).toBeNull()
    expect(useSessionStore.getState().plate).toBeNull()
    vi.unstubAllGlobals()
  })
})
