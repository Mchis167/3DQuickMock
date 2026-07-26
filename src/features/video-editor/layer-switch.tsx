import { TIMELINE_LAYERS } from '@/entities/animation'
import { useSessionStore } from '@/entities/session'
import { Segmented } from '@/shared/ui/segmented'

/**
 * Chọn layer đang sửa trong Control tab — Device / Camera / Lighting.
 *
 * Đây là chốt chính giảm nhồi nhét: panel Control chỉ hiện đúng nhóm của layer đang chọn,
 * không hiện cả sáu section cùng lúc. Chọn keyframe trên timeline tự đổi layer theo kênh
 * đó (xem `entities/session`); đây là chỗ đổi TAY khi chưa chọn keyframe nào.
 */
export function LayerSwitch() {
  const layer = useSessionStore((state) => state.videoLayer)
  const setLayer = useSessionStore((state) => state.setVideoLayer)

  return (
    <div className="bg-input p-1">
      <Segmented
        label="Editing layer"
        options={TIMELINE_LAYERS.map((l) => ({ value: l.id, label: l.label }))}
        value={layer}
        onChange={setLayer}
      />
    </div>
  )
}
