import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { screenClipSchema } from '@/entities/animation'

import { ScreenClipBar } from './screen-clip-bar'

/**
 * Thanh clip màn hình. Điều đáng test không phải hình dáng mà là PHÉP KÉO:
 *
 *  - kéo dời theo ĐỘ LỆCH so với chỗ bấm, không nhảy sao cho đầu thanh về dưới con trỏ;
 *  - kéo ra ngoài hai đầu timeline vẫn hợp lệ (bỏ mấy giây đầu của video).
 */
const WIDTH = 600
const LAST = 150

function setup(start: number, videoFrames = 90) {
  const onMove = vi.fn()
  const onCommit = vi.fn()
  render(
    <ScreenClipBar
      clip={screenClipSchema.parse({ start })}
      videoFrames={videoFrames}
      width={WIDTH}
      lastFrame={LAST}
      onMove={onMove}
      onCommit={onCommit}
    />,
  )
  const bar = screen.getByLabelText('Screen clip')
  bar.setPointerCapture = () => {}
  bar.releasePointerCapture = () => {}
  // jsdom không có layout; gán khung của track để quy đổi pixel -> frame có số thật.
  const track = bar.parentElement as HTMLElement
  track.getBoundingClientRect = () => ({ width: WIDTH, height: 36, left: 0, top: 0 }) as DOMRect
  return { bar, onMove, onCommit }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ScreenClipBar', () => {
  it('hiện độ dài clip bằng số khung — người dùng thấy ngay video dài bao nhiêu', () => {
    setup(1, 90)
    expect(screen.getByLabelText('Screen clip')).toHaveTextContent('90f')
  })

  it('kéo dời theo ĐỘ LỆCH, không nhảy đầu thanh về dưới con trỏ', () => {
    const { bar, onMove } = setup(40)
    // Bấm ở giữa thanh (frame ~75), rồi kéo sang phải 4 frame.
    const grabX = (74 / (LAST - 1)) * WIDTH
    const moveX = (78 / (LAST - 1)) * WIDTH

    fireEvent.pointerDown(bar, { pointerId: 1, clientX: grabX })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: moveX })

    // Dời 4 frame từ 40, KHÔNG phải nhảy về 75.
    expect(onMove).toHaveBeenCalledWith(44)
  })

  it('kéo sang trái ra TRƯỚC frame 1 vẫn hợp lệ — bỏ mấy giây đầu của video', () => {
    const { bar, onMove } = setup(5)
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: (20 / (LAST - 1)) * WIDTH })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 0 })

    expect(onMove).toHaveBeenCalledWith(-15)
  })

  it('thả chuột thì đóng cụm undo', () => {
    const { bar, onCommit } = setup(40)
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(bar, { pointerId: 1 })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('mũi tên dời đúng một frame và đóng cụm ngay', () => {
    const { bar, onMove, onCommit } = setup(40)
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(onMove).toHaveBeenCalledWith(41)
    expect(onCommit).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(onMove).toHaveBeenLastCalledWith(39)
  })

  it('không gọi onMove khi chưa bấm — di chuột qua thanh không được dời nó', () => {
    const { bar, onMove } = setup(40)
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 300 })
    expect(onMove).not.toHaveBeenCalled()
  })
})
