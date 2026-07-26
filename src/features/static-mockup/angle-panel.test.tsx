import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

import { AnglePanel } from './angle-panel'

beforeEach(() => {
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  useSessionStore.setState({ activeAngleSet: 'camera', preview: null, rendering: false })
})

describe('AnglePanel', () => {
  it('kéo slider azimuth thì cập nhật tài liệu', async () => {
    render(<AnglePanel />)
    const slider = screen.getByRole('slider', { name: 'Azimuth' })
    await userEvent.clear(screen.getByLabelText('Azimuth value'))
    await userEvent.type(screen.getByLabelText('Azimuth value'), '35')
    expect(useDocumentStore.getState().document.camera.azimuth).toBe(35)
    expect(slider).toHaveValue('35')
  })

  it('hiện số của bộ ĐANG ẨN ở dạng thu gọn', async () => {
    useDocumentStore.getState().setPose({ spin_y: -12, spin_z: 40 })
    render(<AnglePanel />)

    // Đang chỉnh camera -> phải thấy số của device, nếu không người dùng không biết vì
    // sao hình không về được như cũ.
    expect(screen.getByTestId('angle-collapsed')).toHaveTextContent('device')
    expect(screen.getByTestId('angle-collapsed')).toHaveTextContent('-12°')

    await userEvent.click(screen.getByRole('radio', { name: 'Device' }))
    expect(screen.getByTestId('angle-collapsed')).toHaveTextContent('camera')
  })

  it('reset chỉ tác động lên bộ đang chỉnh', async () => {
    useDocumentStore.getState().setCamera({ azimuth: 60 })
    useDocumentStore.getState().setPose({ spin_z: 33 })
    render(<AnglePanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Reset camera' }))
    const after = useDocumentStore.getState().document
    expect(after.camera.azimuth).toBe(0)
    // Đây là điểm chính: reset camera KHÔNG được xoá luôn pose của device.
    expect(after.pose.spin_z).toBe(33)
  })

  it('slider elevation chặn ở ±89 như schema', () => {
    render(<AnglePanel />)
    const slider = screen.getByRole('slider', { name: 'Elevation' })
    expect(slider).toHaveAttribute('min', '-89')
    expect(slider).toHaveAttribute('max', '89')
  })

  it('một lần kéo chỉ thành một bước undo', () => {
    const { setCamera } = useDocumentStore.getState()
    for (const azimuth of [5, 10, 15, 20]) setCamera({ azimuth }, true)
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    useDocumentStore.getState().undo()
    expect(useDocumentStore.getState().document.camera.azimuth).toBe(0)
  })
})
