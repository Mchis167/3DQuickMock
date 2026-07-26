import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SliderRow } from './slider-row'

/**
 * Click hoặc kéo trên slider.
 * Giả lập container có left=10, width=200.
 */
function dragSlider(
  label: string,
  fromX: number,
  toX: number,
) {
  const slider = screen.getByRole('slider', { name: label })
  const container = slider.closest('.group')!
  
  // jsdom không có Pointer Capture; gắn hàm rỗng để component không crash.
  container.setPointerCapture = () => {}
  container.releasePointerCapture = () => {}

  fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: fromX })
  fireEvent.pointerMove(container, { pointerId: 1, clientX: toX })
  fireEvent.pointerUp(container, { pointerId: 1 })
}

function setup(props: Partial<Parameters<typeof SliderRow>[0]> = {}) {
  const onChange = vi.fn()
  const { container } = render(
    <SliderRow label="Azimuth" value={0} min={-180} max={180} onChange={onChange} {...props} />,
  )
  const element = container.firstChild as HTMLElement
  if (element) {
    element.getBoundingClientRect = () => ({
      left: 10,
      right: 210,
      top: 0,
      bottom: 26,
      width: 200,
      height: 26,
      x: 10,
      y: 0,
      toJSON: () => {},
    })
  }
  return onChange
}

describe('SliderRow — kéo thả 1:1 theo chuột', () => {
  it('click vào vị trí nào thì nhảy về giá trị tương ứng', () => {
    const onChange = setup()
    // click ở clientX = 110 (chính giữa container left=10, width=200 => 50%)
    dragSlider('Azimuth', 110, 110)
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('kéo chuột sang phải thì tăng giá trị theo tỉ lệ width', () => {
    const onChange = setup()
    // kéo từ 110 (50% = 0) sang 160 (75% = 90)
    dragSlider('Azimuth', 110, 160)
    expect(onChange).toHaveBeenLastCalledWith(90)
  })

  it('kéo chuột sang trái thì giảm giá trị theo tỉ lệ width', () => {
    const onChange = setup({ value: 90 })
    // kéo từ 160 (75% = 90) về 60 (25% = -90)
    dragSlider('Azimuth', 160, 60)
    expect(onChange).toHaveBeenLastCalledWith(-90)
  })

  it('kẹp trong khoảng, không tràn ra ngoài min/max', () => {
    const onChange = setup()
    // kéo quá max (clientX = 250 > 210)
    dragSlider('Azimuth', 110, 250)
    expect(onChange).toHaveBeenLastCalledWith(180)

    // kéo quá min (clientX = 0 < 10)
    dragSlider('Azimuth', 110, 0)
    expect(onChange).toHaveBeenLastCalledWith(-180)
  })

  it('bước thập phân giữ đúng số chữ số', () => {
    const onChange = setup({ value: 0.2, min: 0, max: 1, step: 0.01, label: 'Frame fill' })
    // kéo tới clientX = 70 (30% của container left=10, width=200 => value 0.3)
    dragSlider('Frame fill', 50, 70)
    expect(onChange).toHaveBeenLastCalledWith(0.3)
  })

  it('disabled thì kéo không có tác dụng', () => {
    const onChange = setup({ disabled: true })
    dragSlider('Azimuth', 110, 160)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SliderRow — double-click nhãn để reset', () => {
  it('về đúng giá trị mặc định', async () => {
    const onChange = setup({ value: 137, defaultValue: 0 })
    const slider = screen.getByRole('slider', { name: 'Azimuth' })
    const container = slider.closest('.group')!
    await userEvent.dblClick(container)
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('không truyền defaultValue thì double-click không reset', async () => {
    const onChange = setup({ value: 137 })
    const slider = screen.getByRole('slider', { name: 'Azimuth' })
    const container = slider.closest('.group')!
    await userEvent.dblClick(container)
    // Nó snap theo click nhưng không reset về 0 (defaultValue không có)
    expect(onChange).not.toHaveBeenLastCalledWith(0)
  })
})

describe('SliderRow — bàn phím và ô số', () => {
  it('vẫn là slider thật: có role, min, max cho bàn phím và ARIA', () => {
    setup({ value: 20 })
    const slider = screen.getByRole('slider', { name: 'Azimuth' })
    expect(slider).toHaveValue('20')
    expect(slider).toHaveAttribute('min', '-180')
    expect(slider).toHaveAttribute('max', '180')
  })

  it('Shift+ArrowUp nhảy ×10 — cùng quy ước với chuột', () => {
    const onChange = setup({ value: 0 })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Azimuth' }), {
      key: 'ArrowUp',
      shiftKey: true,
    })
    expect(onChange).toHaveBeenLastCalledWith(10)
  })

  it('gõ số vào ô là đổi giá trị', async () => {
    const onChange = setup()
    const input = screen.getByLabelText('Azimuth value')
    await userEvent.clear(input)
    await userEvent.type(input, '42')
    expect(onChange).toHaveBeenLastCalledWith(42)
  })

  it('gõ dở dang (chuỗi rỗng) KHÔNG nhảy về 0', async () => {
    const onChange = setup({ value: 50 })
    await userEvent.clear(screen.getByLabelText('Azimuth value'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hiển thị theo số chữ số của step', () => {
    setup({ value: 0.72, min: 0, max: 1, step: 0.01, label: 'Frame fill' })
    expect(screen.getByLabelText('Frame fill value')).toHaveValue(0.72)
  })
})
