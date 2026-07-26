import { beforeEach, describe, expect, it } from 'vitest'

import { setKeyframe } from '@/entities/animation'

import { createDocument } from './document'
import { evaluateAt } from './evaluate'
import { initHistory } from './history'
import { useDocumentStore } from './store'

/**
 * Cổng cho trải nghiệm dựng animation.
 *
 * Điều phải giữ, phát biểu bằng lời người dùng: "đứng ở frame 60, xoay máy, thì thấy máy
 * xoay NGAY và có keyframe ở frame 60". Trước khi có auto-key thì slider ghi vào giá trị
 * nền — mà giá trị nền không ảnh hưởng gì tới kênh đã có đường cong, nên hình đứng im và
 * công cụ trông như hỏng.
 */
const reset = () => {
  const fresh = createDocument({ mode: 'video' })
  useDocumentStore.setState({
    history: initHistory(fresh),
    document: fresh,
    canUndo: false,
    canRedo: false,
    autoKeyFrame: null,
  })
}

const store = () => useDocumentStore.getState()
const doc = () => store().document

beforeEach(reset)

describe('auto-key', () => {
  it('xoay ở frame 60 thì chốt keyframe ở frame 60, không ghi ra chỗ khác', () => {
    store().keyChannel('device.spin_z', 1)
    store().setAutoKeyFrame(60)
    store().setPose({ spin_z: 120 })

    const keyframes = doc().channels['device.spin_z']?.keyframes ?? []
    expect(keyframes.map((k) => k.frame)).toEqual([1, 60])
    expect(keyframes[1]?.value).toBe(120)
  })

  it('kênh CHƯA có animation thì chỉ ghi giá trị nền — không tự sinh keyframe', () => {
    store().setAutoKeyFrame(60)
    store().setPose({ spin_y: 45 })

    expect(doc().channels['device.spin_y']).toBeUndefined()
    expect(doc().pose.spin_y).toBe(45)
  })

  it('chế độ tĩnh (autoKeyFrame null) thì không bao giờ auto-key', () => {
    store().keyChannel('device.spin_z', 1)
    store().setAutoKeyFrame(null)
    store().setPose({ spin_z: 99 })

    expect(doc().channels['device.spin_z']?.keyframes).toHaveLength(1)
    expect(doc().pose.spin_z).toBe(99)
  })

  it('auto-key một bộ chỉ chạm vào kênh của bộ đó', () => {
    store().keyChannel('camera.azimuth', 1)
    store().keyChannel('device.spin_z', 1)
    store().setAutoKeyFrame(30)
    store().setCamera({ azimuth: 200 })

    expect(doc().channels['camera.azimuth']?.keyframes.map((k) => k.frame)).toEqual([1, 30])
    expect(doc().channels['device.spin_z']?.keyframes.map((k) => k.frame)).toEqual([1])
  })

  it('field không animate được vẫn ghi thẳng vào giá trị nền', () => {
    store().keyChannel('device.spin_z', 1)
    store().setAutoKeyFrame(30)
    // `ground` là boolean, `frame_fill` là tỉ lệ khung hình (khác đơn vị với camera.distance).
    store().setPose({ ground: false })
    store().setCamera({ frame_fill: 0.5 })

    expect(doc().pose.ground).toBe(false)
    expect(doc().camera.frame_fill).toBe(0.5)
    expect(doc().channels['camera.distance']).toBeUndefined()
  })

  it('kéo slider liên tiếp vẫn gộp thành MỘT bước undo dù có auto-key', () => {
    store().keyChannel('device.spin_z', 1)
    store().setAutoKeyFrame(60)
    const depth = store().history.past.length

    for (const value of [10, 20, 30, 40]) store().setPose({ spin_z: value }, true)

    expect(store().history.past.length).toBe(depth + 1)
    store().undo()
    expect(doc().channels['device.spin_z']?.keyframes).toHaveLength(1)
  })

  it('`autoKeyFrame` KHÔNG nằm trong tài liệu nên không vào lịch sử undo', () => {
    store().setAutoKeyFrame(42)
    expect(Object.keys(doc())).not.toContain('autoKeyFrame')
    expect(store().history.past).toHaveLength(0)
  })
})

describe('live preview tại frame đang đứng', () => {
  it('keyframe đúng frame thắng mẫu của worker — không phải chờ lấy mẫu lại', () => {
    const document = createDocument({ mode: 'video' })
    setKeyframe(document.channels, 'device.spin_z', 1, 0)
    setKeyframe(document.channels, 'device.spin_z', 60, 120)

    // Mẫu CŨ: chưa biết gì về keyframe ở frame 60 (nó vừa được tạo).
    const staleSamples = { 'device.spin_z': new Array(60).fill(0) }

    expect(evaluateAt(document, staleSamples, 60).pose.spin_z).toBe(120)
  })

  it('frame GIỮA hai keyframe thì dùng mẫu của worker', () => {
    const document = createDocument({ mode: 'video' })
    setKeyframe(document.channels, 'device.spin_z', 1, 0)
    setKeyframe(document.channels, 'device.spin_z', 61, 120)

    const samples = { 'device.spin_z': Array.from({ length: 61 }, (_, i) => i * 2) }
    expect(evaluateAt(document, samples, 31).pose.spin_z).toBe(60)
  })

  it('chưa có mẫu nào mà đã có keyframe thì vẫn hiện đúng — không cần mạng', () => {
    const document = createDocument({ mode: 'video' })
    setKeyframe(document.channels, 'camera.azimuth', 25, 77)

    expect(evaluateAt(document, null, 25).camera.azimuth).toBe(77)
    // Frame không có keyframe và không có mẫu: giữ giá trị nền, KHÔNG đoán.
    expect(evaluateAt(document, null, 26).camera.azimuth).toBe(document.camera.azimuth)
  })

  it('không có animation thì trả về đúng object cũ — preview không phải render lại', () => {
    const document = createDocument()
    expect(evaluateAt(document, null, 1)).toBe(document)
  })
})
