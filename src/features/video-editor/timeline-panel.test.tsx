import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { setKeyframe, type Channels } from '@/entities/animation'
import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

import { KeyframeInspector } from './keyframe-inspector'
import { TimelinePanel } from './timeline-panel'

/**
 * Cổng UI của Pha 6. Hai điều đáng test nhất KHÔNG phải là hình dáng widget:
 *
 *  1. Nút key chốt đúng giá trị đang hiển thị, và bấm lại thì XOÁ (không tạo key thứ hai).
 *  2. Ctrl+Z hoàn tác keyframe, và state UI (tab, playhead, vùng chọn) không vào lịch sử.
 */
function setup(overrides: Partial<ReturnType<typeof createDocument>> = {}) {
  const document = createDocument(overrides)
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  useSessionStore.setState({ playhead: 1, selectedKeyframe: null, curveSamples: null })
}

const doc = () => useDocumentStore.getState().document

beforeEach(() => setup())

describe('bố cục timeline', () => {
  it('có đúng ba layer cố định, theo thứ tự', () => {
    render(<TimelinePanel />)
    const labels = screen
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label'))
      .filter((label) => label?.endsWith(' track'))
    expect(labels).toEqual(['Device track', 'Camera track', 'Lighting track'])
  })

  it('hiện timecode, frame đang đứng và fps', () => {
    setup({ timeline: { fps: 30, duration: 5, aspect: '3:4' } })
    render(<TimelinePanel />)
    expect(screen.getByText(/0:00\.00 · 1\/150f · 30fps · 3:4/)).toBeInTheDocument()
  })
})

describe('thêm và xoá keyframe', () => {
  it('nút key chốt giá trị đang hiển thị của cả layer', async () => {
    const user = userEvent.setup()
    useDocumentStore.getState().setPose({ spin_z: 33 })
    render(<TimelinePanel />)

    await user.click(screen.getByLabelText('Key Device'))

    expect(doc().channels['device.spin_z']?.keyframes[0]).toMatchObject({ frame: 1, value: 33 })
    expect(doc().channels['device.spin_x']?.keyframes[0]).toMatchObject({ frame: 1, value: 0 })
  })

  it('bấm lại ở cùng frame thì XOÁ, không tạo key thứ hai', async () => {
    const user = userEvent.setup()
    render(<TimelinePanel />)

    await user.click(screen.getByLabelText('Key Device'))
    await user.click(screen.getByLabelText('Remove Device key'))

    expect(doc().channels['device.spin_z']).toBeUndefined()
  })

  it('keyframe hiện thành nút bấm được trên track', async () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 42, 90)
    setup({ channels })
    render(<TimelinePanel />)
    expect(screen.getByLabelText('Keyframe 42')).toBeInTheDocument()
  })

  it('mũi tên trên keyframe dời đúng một frame', async () => {
    const user = userEvent.setup()
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 42, 90)
    setup({ channels })
    render(<TimelinePanel />)

    screen.getByLabelText('Keyframe 42').focus()
    await user.keyboard('{ArrowRight}')
    expect(doc().channels['device.spin_z']?.keyframes[0]?.frame).toBe(43)
  })
})

describe('playhead', () => {
  it('mũi tên tua từng frame và không vượt ra ngoài clip', async () => {
    const user = userEvent.setup()
    setup({ timeline: { fps: 30, duration: 0.1, aspect: '3:4' } }) // 3 frame
    render(<TimelinePanel />)

    const slider = screen.getByRole('slider', { name: 'Playhead' })
    slider.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(useSessionStore.getState().playhead).toBe(3)

    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(useSessionStore.getState().playhead).toBe(1)
  })

  it('tua KHÔNG tạo bước undo', async () => {
    const user = userEvent.setup()
    render(<TimelinePanel />)
    const before = useDocumentStore.getState().history.past.length

    screen.getByRole('slider', { name: 'Playhead' }).focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')

    expect(useDocumentStore.getState().history.past.length).toBe(before)
  })
})

describe('cảnh báo loop 360°', () => {
  it('hiện khi vòng tròn khép kín dùng nội suy có easing', () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0)
    setKeyframe(channels, 'device.spin_z', 120, 360)
    setup({ channels })
    render(<TimelinePanel />)
    expect(screen.getByText(/1 loop warning/)).toBeInTheDocument()
  })

  it('im lặng khi đã là LINEAR', () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 1, 0, { interpolation: 'LINEAR' })
    setKeyframe(channels, 'device.spin_z', 120, 360, { interpolation: 'LINEAR' })
    setup({ channels })
    render(<TimelinePanel />)
    expect(screen.queryByText(/loop warning/)).not.toBeInTheDocument()
  })
})

describe('inspector keyframe', () => {
  const withSelection = () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 30, 90)
    setup({ channels })
    useSessionStore.setState({ selectedKeyframe: { channel: 'device.spin_z', frame: 30 } })
  }

  it('đổi được kiểu nội suy của keyframe đang chọn', async () => {
    const user = userEvent.setup()
    withSelection()
    render(<KeyframeInspector />)

    await user.click(screen.getByRole('radio', { name: 'ELASTIC' }))
    expect(doc().channels['device.spin_z']?.keyframes[0]?.interpolation).toBe('ELASTIC')
  })

  it('có đủ 13 kiểu nội suy và 4 hướng easing, mỗi ô có hình minh hoạ', () => {
    withSelection()
    render(<KeyframeInspector />)
    expect(screen.getByRole('radiogroup', { name: 'Interpolation' }).children).toHaveLength(13)
    expect(screen.getByRole('radiogroup', { name: 'Easing' }).children).toHaveLength(4)
  })

  it('khoá ô easing với LINEAR — nó không có gia tốc để mà tăng giảm', async () => {
    const user = userEvent.setup()
    withSelection()
    render(<KeyframeInspector />)

    expect(screen.getByRole('radio', { name: 'IN' })).not.toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'LINEAR' }))
    expect(screen.getByRole('radio', { name: 'IN' })).toBeDisabled()
  })

  it('xoá keyframe rồi bỏ vùng chọn — không trỏ vào thứ đã mất', async () => {
    const user = userEvent.setup()
    withSelection()
    render(<KeyframeInspector />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(doc().channels['device.spin_z']).toBeUndefined()
    expect(useSessionStore.getState().selectedKeyframe).toBeNull()
  })

  it('nói rõ phải chọn gì khi chưa chọn keyframe nào', () => {
    render(<KeyframeInspector />)
    expect(screen.getByText(/Chọn một keyframe/)).toBeInTheDocument()
  })
})

describe('tap ra khỏi keyframe = deselect', () => {
  /**
   * Panel Keyframe giờ nằm ngoài tab Control, chỉ hiện khi có `selectedKeyframe` — nên
   * "tua ra chỗ khác của timeline" phải xoá vùng chọn, nếu không panel dính lại dù người
   * dùng đã rõ ràng chuyển sự chú ý sang chỗ khác.
   */
  const withSelection = () => {
    const channels: Channels = {}
    setKeyframe(channels, 'device.spin_z', 30, 90)
    setup({ channels })
    useSessionStore.setState({ selectedKeyframe: { channel: 'device.spin_z', frame: 30 } })
  }

  it('bấm vào nền của track (không trúng keyframe nào) thì deselect', () => {
    withSelection()
    render(<TimelinePanel />)

    const track = screen.getByLabelText('Device track')
    fireEvent.pointerDown(track, { clientX: 5, clientY: 5 })

    expect(useSessionStore.getState().selectedKeyframe).toBeNull()
  })

  it('bấm/kéo trên thước thời gian cũng deselect', () => {
    withSelection()
    render(<TimelinePanel />)

    const ruler = screen.getByRole('slider', { name: 'Playhead' })
    ruler.setPointerCapture = () => {}
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: 5, clientY: 5 })

    expect(useSessionStore.getState().selectedKeyframe).toBeNull()
  })

  it('bấm ĐÚNG một viên kim cương thì KHÔNG deselect — nó chọn keyframe đó', () => {
    withSelection()
    render(<TimelinePanel />)

    const diamond = screen.getByLabelText('Keyframe 30')
    diamond.setPointerCapture = () => {}
    diamond.releasePointerCapture = () => {}
    fireEvent.pointerDown(diamond, { pointerId: 1 })
    fireEvent.pointerUp(diamond, { pointerId: 1 })

    expect(useSessionStore.getState().selectedKeyframe).toEqual({
      channel: 'device.spin_z',
      frame: 30,
    })
  })
})

describe('ranh giới undo', () => {
  it('Ctrl+Z hoàn tác keyframe và KHÔNG chạm vào state UI', async () => {
    const user = userEvent.setup()
    render(<TimelinePanel />)
    await user.click(screen.getByLabelText('Key Camera'))

    useSessionStore.getState().setTab('export')
    useSessionStore.getState().setPlayhead(20)
    useDocumentStore.getState().undo()

    expect(doc().channels['camera.azimuth']).toBeUndefined()
    expect(useSessionStore.getState().tab).toBe('export')
    expect(useSessionStore.getState().playhead).toBe(20)
  })
})
