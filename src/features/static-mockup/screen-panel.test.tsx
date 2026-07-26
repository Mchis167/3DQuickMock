import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'

const api = vi.hoisted(() => ({ prepareScreen: { mutate: vi.fn() } }))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { prepareScreen: api.prepareScreen },
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

import { ScreenPanel } from './screen-panel'

const UPLOAD = { asset: 'cache/uploads/abc123.png', hash: 'abc123', bytes: 10 }

beforeEach(() => {
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  api.prepareScreen.mutate.mockReset()
  api.prepareScreen.mutate.mockResolvedValue({
    screen: 'cache/screens/abc_fill_1179x2552.png',
    source: { width: 1920, height: 1080 },
    target: { width: 1179, height: 2552 },
    cropped: true,
    letterboxed: false,
    distorted: false,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => UPLOAD } as unknown as Response),
  )
})

function pickFile(name = 'app.png') {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Choose screen image'), { target: { files: [file] } })
  return file
}

describe('ScreenPanel', () => {
  it('import ảnh: upload rồi khớp tỉ lệ, tài liệu nhận ảnh ĐÃ khớp', async () => {
    render(<ScreenPanel />)
    pickFile()

    await waitFor(() => {
      expect(useDocumentStore.getState().document.screen).toBe(
        'cache/screens/abc_fill_1179x2552.png',
      )
    })
    // File gốc được giữ lại để đổi chế độ mà không phải import lần nữa.
    expect(useDocumentStore.getState().document.screenSource).toBe(UPLOAD.asset)
    expect(api.prepareScreen.mutate).toHaveBeenCalledWith({ asset: UPLOAD.asset, mode: 'fill' })
  })

  it('giữ đúng phần mở rộng khi upload', async () => {
    render(<ScreenPanel />)
    pickFile('mockup.JPG')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('ext=JPG')
  })

  it('cảnh báo ảnh bị cắt / méo NGAY sau import', async () => {
    render(<ScreenPanel />)
    pickFile()
    await waitFor(() => expect(screen.getByTestId('fit-info')).toHaveTextContent('cropped'))
    expect(screen.getByTestId('fit-info')).toHaveTextContent('1920×1080')
  })

  it('stretch với ảnh 16:9 thì nói rõ là méo', async () => {
    api.prepareScreen.mutate.mockResolvedValue({
      screen: 'cache/screens/abc_stretch_1179x2552.png',
      source: { width: 1920, height: 1080 },
      target: { width: 1179, height: 2552 },
      cropped: false,
      letterboxed: false,
      distorted: true,
    })
    render(<ScreenPanel />)
    pickFile()
    // Màn hình 19.5:9 mà nội dung 16:9 — méo rất rõ, phải nói trước khi người dùng render.
    await waitFor(() => expect(screen.getByTestId('fit-info')).toHaveTextContent('distorted'))
  })

  it('đổi chế độ thì khớp LẠI từ file gốc, không cần import lại', async () => {
    render(<ScreenPanel />)
    pickFile()
    await waitFor(() => expect(api.prepareScreen.mutate).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('radio', { name: 'Fit' }))
    await waitFor(() => {
      expect(api.prepareScreen.mutate).toHaveBeenLastCalledWith({
        asset: UPLOAD.asset,
        mode: 'fit',
      })
    })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(useDocumentStore.getState().document.fitMode).toBe('fit')
  })

  it('chưa import gì thì đổi chế độ KHÔNG gọi server', async () => {
    render(<ScreenPanel />)
    await userEvent.click(screen.getByRole('radio', { name: 'Stretch' }))
    expect(api.prepareScreen.mutate).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().document.fitMode).toBe('stretch')
  })

  it('upload lỗi thì hiện lỗi và KHÔNG đổi ảnh đang dùng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413 } as Response))
    const before = useDocumentStore.getState().document.screen
    render(<ScreenPanel />)
    pickFile()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('413'))
    expect(useDocumentStore.getState().document.screen).toBe(before)
  })

  it('kéo-thả file cũng import được', async () => {
    render(<ScreenPanel />)
    const file = new File([new Uint8Array([1])], 'drop.png', { type: 'image/png' })
    const zone = screen.getByText(/Drag image here/).closest('div') as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })
})
