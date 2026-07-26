import { beforeEach, describe, expect, it } from 'vitest'

import { useSessionStore } from './index'

/**
 * Cổng của UX Pha 6 (đợt 2): chọn keyframe của một kênh phải tự chuyển layer/bộ góc
 * tương ứng, để Control tab hiện đúng panel mà không cần người dùng tự đi tìm.
 */
beforeEach(() => {
  useSessionStore.setState({
    videoLayer: 'device',
    activeAngleSet: 'camera',
    selectedKeyframe: null,
  })
})

describe('selectKeyframe đồng bộ layer', () => {
  it('chọn keyframe device thì chuyển videoLayer và activeAngleSet sang device', () => {
    useSessionStore.getState().selectKeyframe({ channel: 'device.spin_z', frame: 10 })
    expect(useSessionStore.getState().videoLayer).toBe('device')
    expect(useSessionStore.getState().activeAngleSet).toBe('device')
  })

  it('chọn keyframe camera.azimuth thì chuyển sang camera', () => {
    useSessionStore.getState().selectKeyframe({ channel: 'camera.azimuth', frame: 10 })
    expect(useSessionStore.getState().videoLayer).toBe('camera')
    expect(useSessionStore.getState().activeAngleSet).toBe('camera')
  })

  it('chọn keyframe world (lighting) thì chuyển videoLayer nhưng KHÔNG đụng activeAngleSet', () => {
    useSessionStore.setState({ activeAngleSet: 'device' })
    useSessionStore.getState().selectKeyframe({ channel: 'world.strength', frame: 10 })
    expect(useSessionStore.getState().videoLayer).toBe('lighting')
    // Lighting không có khái niệm camera/device — giữ nguyên lựa chọn trước đó.
    expect(useSessionStore.getState().activeAngleSet).toBe('device')
  })

  it('bỏ chọn (null) không đổi layer đang xem', () => {
    useSessionStore.getState().selectKeyframe({ channel: 'camera.azimuth', frame: 10 })
    useSessionStore.getState().selectKeyframe(null)
    expect(useSessionStore.getState().videoLayer).toBe('camera')
    expect(useSessionStore.getState().selectedKeyframe).toBeNull()
  })
})
