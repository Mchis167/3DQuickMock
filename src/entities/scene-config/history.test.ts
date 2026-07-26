import { describe, expect, it } from 'vitest'

import { canRedo, canUndo, commit, initHistory, redo, undo } from './history'
import { createDocument } from './document'

function start() {
  return initHistory(createDocument())
}

describe('undo/redo theo patch', () => {
  it('undo trả về đúng giá trị trước đó', () => {
    let h = start()
    h = commit(h, 'camera.azimuth', (d) => {
      d.camera.azimuth = 45
    })
    expect(h.present.camera.azimuth).toBe(45)

    h = undo(h)
    expect(h.present.camera.azimuth).toBe(0)
    expect(canRedo(h)).toBe(true)

    h = redo(h)
    expect(h.present.camera.azimuth).toBe(45)
  })

  it('không có gì để undo thì trả về chính nó', () => {
    const h = start()
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
    expect(canUndo(h)).toBe(false)
  })

  it('thay đổi không đổi gì thì không tạo bước undo', () => {
    let h = start()
    h = commit(h, 'noop', (d) => {
      // Gán lại đúng giá trị đang có: immer không sinh patch nào, nên không được tạo
      // bước undo rỗng (bấm Ctrl+Z mà không thấy gì đổi là cảm giác app bị hỏng).
      d.camera.azimuth = 0
    })
    expect(canUndo(h)).toBe(false)
  })

  it('gộp thao tác kéo slider thành MỘT bước undo', () => {
    let h = start()
    for (const value of [10, 20, 30, 40]) {
      h = commit(
        h,
        'camera.azimuth',
        (d) => {
          d.camera.azimuth = value
        },
        { coalesce: true },
      )
    }
    expect(h.present.camera.azimuth).toBe(40)
    // Không gộp thì phải bấm Ctrl+Z bốn lần mới về 0.
    expect(h.past).toHaveLength(1)

    h = undo(h)
    expect(h.present.camera.azimuth).toBe(0)
  })

  it('nhãn khác thì KHÔNG gộp, dù cùng bật coalesce', () => {
    let h = start()
    h = commit(h, 'camera.azimuth', (d) => void (d.camera.azimuth = 10), { coalesce: true })
    h = commit(h, 'pose.spin_z', (d) => void (d.pose.spin_z = 5), { coalesce: true })
    expect(h.past).toHaveLength(2)
    h = undo(h)
    expect(h.present.pose.spin_z).toBe(0)
    expect(h.present.camera.azimuth).toBe(10)
  })

  it('làm thao tác mới sau khi undo thì xoá nhánh redo', () => {
    let h = start()
    h = commit(h, 'a', (d) => void (d.camera.azimuth = 10))
    h = undo(h)
    h = commit(h, 'b', (d) => void (d.camera.elevation = 30))
    expect(canRedo(h)).toBe(false)
    expect(h.present.camera.azimuth).toBe(0)
    expect(h.present.camera.elevation).toBe(30)
  })

  it('undo nhiều bước ngược đúng thứ tự', () => {
    let h = start()
    h = commit(h, 'a', (d) => void (d.camera.azimuth = 10))
    h = commit(h, 'b', (d) => void (d.camera.azimuth = 20))
    h = commit(h, 'c', (d) => void (d.camera.azimuth = 30))
    h = undo(undo(h))
    expect(h.present.camera.azimuth).toBe(10)
    h = redo(h)
    expect(h.present.camera.azimuth).toBe(20)
  })

  it('không sửa tại chỗ — bản cũ giữ nguyên giá trị', () => {
    const h0 = start()
    const before = h0.present
    const h1 = commit(h0, 'a', (d) => void (d.camera.azimuth = 99))
    // Nếu immer bị bỏ qua ở đâu đó thì `before` sẽ đổi theo, và undo sẽ "thành công"
    // trong khi thật ra không quay về đâu cả.
    expect(before.camera.azimuth).toBe(0)
    expect(h1.present).not.toBe(before)
  })
})
