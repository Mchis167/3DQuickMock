import { useSessionStore, type ImportKind } from '@/entities/session'
import { Segmented } from '@/shared/ui/segmented'

import { ScreenPanel } from './screen-panel'
import { VideoPanel } from './video-panel'

/**
 * Tab Import — chọn ĐANG LÀM VIỆC VỚI ảnh hay video.
 *
 * Hai đường này khác nhau ở tận gốc: ảnh đi thẳng vào Blender và export ra ảnh; video được
 * ghép ở client trên một plate và export ra video. Xếp cả hai cạnh nhau trên cùng một màn
 * hình khiến người dùng tưởng có thể dùng đồng thời — trong khi màn hình chỉ có một.
 */

const KINDS: readonly { value: ImportKind; label: string }[] = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
]

export function ImportTab() {
  const kind = useSessionStore((state) => state.importKind)
  const setKind = useSessionStore((state) => state.setImportKind)

  return (
    <div className="grid">
      <Segmented label="Import type" options={KINDS} value={kind} onChange={setKind} />
      {kind === 'image' ? <ScreenPanel /> : <VideoPanel />}
    </div>
  )
}
