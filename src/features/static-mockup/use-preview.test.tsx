import { act, render, waitFor } from '@testing-library/react'
import { TRPCClientError } from '@trpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

const preview = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { preview },
  apiUrl: (pathname: string) => `http://test${pathname}`,
}))

import { PREVIEW_DEBOUNCE_MS, usePreview } from './use-preview'

function Harness() {
  usePreview()
  return null
}

function reply(url: string) {
  return { url, ms: 300, liftMm: 0, bottomGapMm: 0 }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  useSessionStore.setState({ preview: null, rendering: false, error: null })
  preview.mutate.mockReset()
  preview.mutate.mockResolvedValue(reply('/preview/a.png'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePreview', () => {
  it('render ngay lần đầu, không chờ debounce', async () => {
    render(<Harness />)
    await waitFor(() => expect(preview.mutate).toHaveBeenCalledTimes(1))
  })

  it('kéo slider liên tiếp chỉ gửi MỘT yêu cầu nữa', async () => {
    render(<Harness />)
    await waitFor(() => expect(preview.mutate).toHaveBeenCalledTimes(1))

    act(() => {
      for (const azimuth of [10, 20, 30, 40, 50]) {
        useDocumentStore.getState().setCamera({ azimuth }, true)
      }
    })
    // Chưa hết thời gian chờ thì chưa được gửi gì.
    expect(preview.mutate).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10)
    })
    await waitFor(() => expect(preview.mutate).toHaveBeenCalledTimes(2))
    expect(preview.mutate.mock.calls[1]?.[0].camera.azimuth).toBe(50)
  })

  it('kết quả về SAI THỨ TỰ thì bỏ cái cũ', async () => {
    // Yêu cầu 1 chậm, yêu cầu 2 nhanh. Không có vé thứ tự thì ảnh cũ sẽ ghi đè ảnh mới
    // và preview trông như đang tụt về sau.
    let resolveSlow: ((value: unknown) => void) | undefined
    preview.mutate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(reply('/preview/new.png')))

    render(<Harness />)
    act(() => {
      useDocumentStore.getState().setCamera({ azimuth: 90 })
    })
    await act(async () => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10)
    })
    await waitFor(() =>
      expect(useSessionStore.getState().preview?.url).toBe('/preview/new.png'),
    )

    await act(async () => {
      resolveSlow?.(reply('/preview/old.png'))
    })
    expect(useSessionStore.getState().preview?.url).toBe('/preview/new.png')
  })

  it('yêu cầu bị hàng đợi thay thế KHÔNG hiện thành lỗi', async () => {
    const conflict = new TRPCClientError('yêu cầu bị thay thế bởi cái mới hơn (preview)')
    Object.assign(conflict, { data: { code: 'CONFLICT' } })
    preview.mutate.mockRejectedValue(conflict)

    render(<Harness />)
    await waitFor(() => expect(preview.mutate).toHaveBeenCalled())
    // Kéo slider luôn sinh ra tình huống này; hiện lên mặt người dùng là báo động giả.
    expect(useSessionStore.getState().error).toBeNull()
  })

  it('lỗi thật thì hiện ra, không im lặng', async () => {
    preview.mutate.mockRejectedValue(new Error('worker Blender đã chết'))
    render(<Harness />)
    await waitFor(() => {
      expect(useSessionStore.getState().error).toBe('worker Blender đã chết')
    })
    expect(useSessionStore.getState().rendering).toBe(false)
  })
})
