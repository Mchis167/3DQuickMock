import { keyframeAt, layerOf } from '@/entities/animation'
import type { Easing, Interpolation } from '@/entities/scene-config'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { Button } from '@/shared/ui/button'
import { PanelSection } from '@/shared/ui/panel-section'

import { CurvePreview } from './curve-preview'
import { EasingPicker, InterpolationPicker } from './interpolation-picker'

const NO_EASING: readonly Interpolation[] = ['CONSTANT', 'LINEAR']

/**
 * Thuộc tính của keyframe ĐANG CHỌN: đường cong thật, kiểu nội suy, hướng easing.
 *
 * Trước đây chỉ có hai dropdown chữ ("BOUNCE" trông thế nào?) — giờ có hình minh hoạ cho
 * TỪNG lựa chọn (`InterpolationPicker`/`EasingPicker`) và đường cong THẬT của kênh đang
 * chọn (`CurvePreview`, lấy từ mẫu worker) để thấy ngay tác động của lựa chọn đó.
 *
 * Panel này KHÔNG nằm trong tab Control — nó là một khối riêng ở cuối cột inspector, chỉ
 * App mới quyết định gắn nó vào DOM khi có `selectedKeyframe`. Tách vậy vì Keyframe không
 * thuộc layer nào (Device/Camera/Lighting) và cũng không thuộc bất kỳ tab nào — nó thuộc
 * về THAO TÁC "đang chọn một keyframe", một mental model khác hẳn "đang mở tab gì".
 *
 * Cảnh báo loop KHÔNG lặp lại ở đây — đã hiện sẵn trên header của `TimelinePanel`, và panel
 * này chỉ tồn tại khi có keyframe được chọn nên không phải chỗ đáng tin để luôn thấy nó.
 */
export function KeyframeInspector() {
  const document = useDocumentStore((state) => state.document)
  const setInterpolation = useDocumentStore((state) => state.setInterpolation)
  const removeKeyframe = useDocumentStore((state) => state.removeKeyframe)
  const selected = useSessionStore((state) => state.selectedKeyframe)
  const selectKeyframe = useSessionStore((state) => state.selectKeyframe)
  const setPlayhead = useSessionStore((state) => state.setPlayhead)

  const keyframe = selected
    ? keyframeAt(document.channels, selected.channel, selected.frame)
    : undefined

  return (
    <PanelSection title="Keyframe">
      {selected && keyframe ? (
        <>
          <div className="text-helper text-muted-foreground bg-input h-row flex items-center gap-2 px-2">
            <span className="truncate font-mono">
              {layerOf(selected.channel).label} · {selected.channel.split('.')[1]}
            </span>
            <span className="ml-auto font-mono">
              f{keyframe.frame} = {keyframe.value.toFixed(2)}
            </span>
          </div>

          <CurvePreview channel={selected.channel} />

          <InterpolationPicker
            value={keyframe.interpolation}
            easing={keyframe.easing}
            onChange={(interpolation: Interpolation) =>
              setInterpolation(selected.channel, selected.frame, interpolation, keyframe.easing)
            }
          />

          <EasingPicker
            value={keyframe.easing}
            interpolation={keyframe.interpolation}
            disabled={NO_EASING.includes(keyframe.interpolation)}
            onChange={(easing: Easing) =>
              setInterpolation(selected.channel, selected.frame, keyframe.interpolation, easing)
            }
          />

          <div className="flex gap-px">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setPlayhead(keyframe.frame)}
              title="Đưa playhead về đúng keyframe này"
            >
              Go to frame
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                removeKeyframe(selected.channel, selected.frame)
                selectKeyframe(null)
              }}
            >
              Delete
            </Button>
          </div>
        </>
      ) : (
        <p className="text-helper text-muted-foreground px-2 py-2">
          Chọn một keyframe trên timeline để đổi kiểu nội suy.
        </p>
      )}
    </PanelSection>
  )
}
