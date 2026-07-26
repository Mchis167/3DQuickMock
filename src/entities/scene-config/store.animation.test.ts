import { beforeEach, describe, expect, it } from 'vitest'

import { useSessionStore } from '@/entities/session'

import { createDocument } from './document'
import { initHistory } from './history'
import { useDocumentStore } from './store'

/**
 * Cổng của Pha 6: thao tác keyframe phải đi qua patch, và Ctrl+Z phải hoàn tác THAO TÁC
 * chứ không đóng panel. Cái thứ hai không kiểm bằng mắt được — nó là một tính chất về
 * ranh giới giữa hai store, nên phải có test giữ.
 */
const reset = () => {
  const fresh = createDocument()
  useDocumentStore.setState({
    history: initHistory(fresh),
    document: fresh,
    canUndo: false,
    canRedo: false,
  })
}

const store = () => useDocumentStore.getState()

beforeEach(reset)

describe('chốt keyframe', () => {
  it('lấy đúng giá trị đang hiển thị của kênh', () => {
    store().setPose({ spin_z: 42 })
    store().keyChannel('device.spin_z', 30)
    expect(store().document.channels['device.spin_z']?.keyframes).toEqual([
      { frame: 30, value: 42, interpolation: 'BEZIER', easing: 'AUTO' },
    ])
  })

  it('kẹp vào frame cuối của timeline — không có keyframe ngoài clip', () => {
    store().setTimeline({ fps: 30, duration: 2 }) // 60 frame
    store().keyChannel('device.spin_z', 9999)
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.frame).toBe(60)
  })

  it('key cả layer trong MỘT bước undo', () => {
    store().keyChannels(['device.spin_x', 'device.spin_y', 'device.spin_z'], 1)
    expect(Object.keys(store().document.channels)).toHaveLength(3)
    store().undo()
    expect(Object.keys(store().document.channels)).toHaveLength(0)
  })
})

describe('undo/redo trên timeline', () => {
  it('hoàn tác được từng thao tác keyframe', () => {
    store().keyChannel('device.spin_z', 1)
    store().keyChannel('device.spin_z', 60)
    store().removeKeyframe('device.spin_z', 1)

    expect(store().document.channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([
      60,
    ])
    store().undo()
    expect(store().document.channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([
      1, 60,
    ])
    store().undo()
    expect(store().document.channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([
      1,
    ])
    store().undo()
    expect(store().document.channels['device.spin_z']).toBeUndefined()
    expect(store().canUndo).toBe(false)
  })

  it('redo dựng lại đúng thứ vừa hoàn tác', () => {
    store().keyChannel('camera.azimuth', 45)
    store().undo()
    store().redo()
    expect(store().document.channels['camera.azimuth']?.keyframes[0]?.frame).toBe(45)
    expect(store().canRedo).toBe(false)
  })

  it('kéo keyframe liên tiếp gộp thành MỘT bước undo, và undo về đúng chỗ xuất phát', () => {
    store().keyChannel('device.spin_z', 10)
    for (const to of [20, 30, 40, 50]) {
      store().moveKeyframe(
        'device.spin_z',
        store().document.channels['device.spin_z']!.keyframes[0]!.frame,
        to,
        true,
      )
    }
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.frame).toBe(50)
    store().undo()
    // Một lần undo, về thẳng frame 10 — không phải bấm bốn lần.
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.frame).toBe(10)
  })

  it('HAI cú kéo tách nhau là HAI bước undo — endGesture đóng cụm', () => {
    store().keyChannel('device.spin_z', 10)
    const base = store().history.past.length

    // Cú kéo thứ nhất: 10 → 20 → 30, rồi thả chuột.
    store().moveKeyframe('device.spin_z', 10, 20, true)
    store().moveKeyframe('device.spin_z', 20, 30, true)
    store().endGesture()

    // Cú kéo thứ hai: 30 → 40 → 50, cùng nhãn y hệt cú trước.
    store().moveKeyframe('device.spin_z', 30, 40, true)
    store().moveKeyframe('device.spin_z', 40, 50, true)

    expect(store().history.past.length).toBe(base + 2)
    store().undo()
    // Không có `endGesture` thì một lần undo sẽ nhảy thẳng về 10, tức là người dùng mất
    // luôn cả cú kéo mà họ không định hoàn tác.
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.frame).toBe(30)
    store().undo()
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.frame).toBe(10)
  })

  it('đổi nội suy hoàn tác được', () => {
    store().keyChannel('device.spin_z', 1)
    store().setInterpolation('device.spin_z', 1, 'LINEAR', 'AUTO')
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.interpolation).toBe(
      'LINEAR',
    )
    store().undo()
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.interpolation).toBe(
      'BEZIER',
    )
  })

  it('xoá sạch animation hoàn tác được — nút nguy hiểm nhất của timeline', () => {
    store().keyChannel('device.spin_z', 1)
    store().keyChannel('camera.azimuth', 30)
    store().clearAnimation()
    expect(store().document.channels).toEqual({})
    store().undo()
    expect(Object.keys(store().document.channels)).toHaveLength(2)
  })
})

describe('ranh giới documentStore / uiStore', () => {
  it('đổi tab hay playhead KHÔNG tạo bước undo', () => {
    store().keyChannel('device.spin_z', 1)
    const depth = store().history.past.length

    useSessionStore.getState().setTab('export')
    useSessionStore.getState().setPlayhead(37)
    useSessionStore.getState().setZoom('zoom')

    // Đây là điều kiện "Ctrl+Z hoàn tác keyframe CHỨ KHÔNG đóng panel": lịch sử không
    // hề nhúc nhích khi state của UI đổi.
    expect(store().history.past.length).toBe(depth)
    store().undo()
    expect(store().document.channels['device.spin_z']).toBeUndefined()
    // Và undo không kéo tab về chỗ cũ.
    expect(useSessionStore.getState().tab).toBe('export')
  })

  it('tài liệu không chứa field nào của UI', () => {
    const keys = Object.keys(store().document)
    for (const forbidden of ['playhead', 'tab', 'zoom', 'previewQuality', 'playing']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('setKeyframeValue', () => {
  it('sửa keyframe đang đứng, và kéo giá trị nền đi theo', () => {
    store().keyChannel('device.spin_z', 20)
    store().setKeyframeValue('device.spin_z', 20, 137)
    expect(store().document.channels['device.spin_z']?.keyframes[0]?.value).toBe(137)
    // Bỏ hết keyframe thì cái còn lại phải là giá trị vừa nhìn thấy.
    expect(store().document.pose.spin_z).toBe(137)
  })

  it('kéo slider liên tiếp gộp thành một bước undo', () => {
    store().keyChannel('device.spin_z', 20)
    const depth = store().history.past.length
    for (const v of [10, 20, 30, 40]) store().setKeyframeValue('device.spin_z', 20, v, true)
    expect(store().history.past.length).toBe(depth + 1)
  })
})

describe('chuyển chế độ', () => {
  it('sang video rồi về tĩnh vẫn GIỮ keyframe — bấm nhầm không mất việc', () => {
    store().setMode('video')
    store().keyChannel('device.spin_z', 1)
    store().setMode('static')
    expect(store().document.channels['device.spin_z']).toBeDefined()
  })
})
