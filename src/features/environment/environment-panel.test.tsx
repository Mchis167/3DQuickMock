import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'

// Cổng giả thay cho server: component test không được phụ thuộc Blender hay Fastify.
const environments = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/shared/api/trpc', () => ({
  trpc: { environments },
  apiUrl: (pathname: string) => `http://test${pathname}`,
}))

import { EnvironmentPanel } from './environment-panel'

const PRESETS = [
  {
    id: 'studio_small_03',
    label: 'Phòng chụp nhỏ',
    description: 'mốc hiệu chuẩn',
    hdri: 'assets/hdri/studio_small_03.hdr',
    strength: 0.6,
    rotation: 0,
    thumbnailUrl: '/assets/hdri/thumbs/studio_small_03.png',
  },
  {
    id: 'venice_sunset',
    label: 'Hoàng hôn Venice',
    description: 'ngoài trời ấm',
    hdri: 'assets/hdri/venice_sunset.hdr',
    strength: 2.354,
    rotation: 15,
    thumbnailUrl: '/assets/hdri/thumbs/venice_sunset.png',
  },
]

beforeEach(() => {
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
  environments.query.mockReset()
  environments.query.mockResolvedValue({ presets: PRESETS, reference: {} })
})

describe('EnvironmentPanel', () => {
  it('chọn preset thì lấy CẢ strength đã hiệu chuẩn', async () => {
    render(<EnvironmentPanel />)
    await userEvent.click(await screen.findByRole('button', { name: 'Hoàng hôn Venice' }))

    const { world, environmentId } = useDocumentStore.getState().document
    expect(environmentId).toBe('venice_sunset')
    expect(world.hdri).toBe('assets/hdri/venice_sunset.hdr')
    // Đây là phép kiểm quan trọng nhất của panel này: bỏ strength (hay đặt 1.0) thì đổi
    // môi trường sẽ nhảy độ phơi sáng — mất một tiêu chí "xong" của Pha 3.
    expect(world.strength).toBeCloseTo(2.354, 6)
    expect(world.rotation).toBe(15)
  })

  it('đánh dấu preset đang chọn', async () => {
    render(<EnvironmentPanel />)
    const current = await screen.findByRole('button', { name: 'Phòng chụp nhỏ' })
    expect(current).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Hoàng hôn Venice' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('đọc presets.json lỗi thì NÓI RA, không hiện bảng rỗng', async () => {
    environments.query.mockRejectedValue(new Error('ENOENT presets.json'))
    render(<EnvironmentPanel />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ENOENT presets.json')
    })
  })

  it('slider cường độ vẫn cho lệch khỏi số đã hiệu chuẩn', async () => {
    render(<EnvironmentPanel />)
    const input = await screen.findByLabelText('Strength value')
    await userEvent.clear(input)
    await userEvent.type(input, '1.5')
    expect(useDocumentStore.getState().document.world.strength).toBeCloseTo(1.5, 6)
  })
})
