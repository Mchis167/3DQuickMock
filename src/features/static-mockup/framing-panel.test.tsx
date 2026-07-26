import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { IPHONE_17_PRO_MAX, projectedHeightRatio } from '@/entities/device'
import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

import { FIT_TARGET, FramingPanel } from './framing-panel'
import { GroundPanel } from './ground-panel'

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

describe('FramingPanel', () => {
  it('Fit to frame đưa phần chiếm thật về đúng target', async () => {
    useDocumentStore.getState().setPose({ spin_y: 25 })
    useDocumentStore.getState().setCamera({ frame_fill: 0.3 })
    render(<FramingPanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Fit' }))

    const { camera, pose } = useDocumentStore.getState().document
    const occupied =
      camera.frame_fill * projectedHeightRatio(IPHONE_17_PRO_MAX.dimsMm, pose, camera)
    // Không bù theo pose thì frame_fill sẽ đúng bằng 0.9 và máy nghiêng sẽ tràn khung.
    expect(occupied).toBeCloseTo(FIT_TARGET, 6)
    expect(camera.frame_fill).not.toBeCloseTo(FIT_TARGET, 3)
  })

  it('frame_fill không bao giờ vượt 1 — schema từ chối', () => {
    render(<FramingPanel />)
    expect(screen.getByRole('slider', { name: 'Frame fill' })).toHaveAttribute('max', '1')
  })
})

describe('GroundPanel', () => {
  it('đổi chế độ thì đổi pose.ground', async () => {
    render(<GroundPanel />)
    await userEvent.click(screen.getByRole('radio', { name: 'Floating' }))
    expect(useDocumentStore.getState().document.pose.ground).toBe(false)
  })
})
