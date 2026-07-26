import { useState } from 'react'

import { timelineFrames, timelineSchema, type Timeline } from '@/entities/animation'
import { useDocumentStore } from '@/entities/scene-config/store'
import { Button } from '@/shared/ui/button'
import { Dialog } from '@/shared/ui/dialog'

import { TimelineFields } from './video-settings'

/**
 * Hộp thoại bắt đầu một video: fps, thời lượng, tỉ lệ canvas.
 *
 * Ba con số này quyết định mọi keyframe sẽ rơi vào đâu, nên hỏi TRƯỚC khi có timeline thì
 * rẻ hơn nhiều: đổi fps sau khi đã dựng xong là mọi key giữ nguyên số frame nhưng rơi vào
 * thời điểm khác. Vẫn đổi được sau ở panel Video — hộp thoại này chỉ là chỗ hỏi lần đầu,
 * không phải cái khoá.
 *
 * Giá trị sống trong state cục bộ tới khi bấm Create: hộp thoại còn mở mà tài liệu đã đổi
 * thì Cancel không còn nghĩa gì, và mỗi lần chỉnh nháp lại thành một bước undo.
 */
export function NewVideoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setMode = useDocumentStore((state) => state.setMode)
  const setTimeline = useDocumentStore((state) => state.setTimeline)
  const [draft, setDraft] = useState<Timeline>(() => timelineSchema.parse({}))

  const create = () => {
    setTimeline(draft)
    setMode('video')
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="New video"
      description="Đặt trục thời gian trước khi dựng keyframe. Đổi lại được sau ở panel Video."
      onClose={onClose}
    >
      <TimelineFields
        timeline={draft}
        onChange={(values) => setDraft((current) => ({ ...current, ...values }))}
        onCommit={() => {}}
      />
      <p className="text-helper text-muted-foreground px-2 py-1 font-mono">
        {timelineFrames(draft)} frames
      </p>
      <div className="mt-1 flex gap-px">
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={create}>
          Create
        </Button>
      </div>
    </Dialog>
  )
}
