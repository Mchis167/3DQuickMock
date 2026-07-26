import { RotateCcw } from 'lucide-react'

import { DEFAULT_CAMERA, DEFAULT_POSE } from '@/entities/scene-config/document'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { Button } from '@/shared/ui/button'
import { PanelSection } from '@/shared/ui/panel-section'
import { Segmented } from '@/shared/ui/segmented'
import { SliderRow } from '@/shared/ui/slider-row'

const SETS = [
  { value: 'camera' as const, label: 'Camera' },
  { value: 'device' as const, label: 'Device' },
]

/**
 * Panel góc: một công tắc chọn bộ đang chỉnh, cộng **số của bộ đang ẩn ở dạng thu gọn**.
 *
 * Vì sao phải hiện số của bộ ẩn: cùng một hình có thể đến từ "xoay camera" hay "xoay
 * máy", và không thấy bộ kia thì người dùng chỉnh mãi một bộ mà không hiểu vì sao hình
 * không về được như cũ. Nút reset cũng RIÊNG từng bộ vì lý do đó.
 *
 * `lockedSet`: dùng khi đứng bên ngoài đã biết chắc đang sửa bộ nào (video editor chọn
 * theo layer trên timeline) — ẩn công tắc để khỏi có hai chỗ cùng quyết định một việc,
 * nhưng vẫn giữ dòng số thu gọn của bộ kia để không mất ngữ cảnh.
 */
export function AnglePanel({ lockedSet }: { lockedSet?: 'camera' | 'device' } = {}) {
  const document = useDocumentStore((state) => state.document)
  const setCamera = useDocumentStore((state) => state.setCamera)
  const setPose = useDocumentStore((state) => state.setPose)
  const resetCamera = useDocumentStore((state) => state.resetCamera)
  const resetPose = useDocumentStore((state) => state.resetPose)
  const storedSet = useSessionStore((state) => state.activeAngleSet)
  const setActiveSet = useSessionStore((state) => state.setActiveAngleSet)

  const { camera, pose } = document
  const activeSet = lockedSet ?? storedSet
  const onCamera = activeSet === 'camera'

  return (
    <PanelSection
      title="Angle"
      actions={
        <div className="flex items-center gap-1">
          {lockedSet ? null : (
            <Segmented
              options={SETS}
              value={activeSet}
              onChange={setActiveSet}
              label="Angle set"
              className="w-32"
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={onCamera ? 'Reset camera' : 'Reset device'}
            title="Reset active set only"
            onClick={onCamera ? resetCamera : resetPose}
          >
            <RotateCcw className="size-3" />
          </Button>
        </div>
      }
    >
      {onCamera ? (
        <>
          <SliderRow
            label="Azimuth"
            unit="°"
            value={camera.azimuth}
            min={-180}
            max={180}
            defaultValue={DEFAULT_CAMERA.azimuth}
            onChange={(azimuth) => setCamera({ azimuth }, true)}
          />
          <SliderRow
            label="Elevation"
            unit="°"
            value={camera.elevation}
            // Schema chặn ở ±89: quá đó thì rig TRACK_TO mất trục tham chiếu và camera lật.
            min={-89}
            max={89}
            defaultValue={DEFAULT_CAMERA.elevation}
            onChange={(elevation) => setCamera({ elevation }, true)}
          />
        </>
      ) : (
        <>
          <SliderRow
            label="Spin X"
            unit="°"
            value={pose.spin_x}
            min={-180}
            max={180}
            defaultValue={DEFAULT_POSE.spin_x}
            onChange={(spin_x) => setPose({ spin_x }, true)}
          />
          <SliderRow
            label="Spin Y"
            unit="°"
            value={pose.spin_y}
            min={-180}
            max={180}
            defaultValue={DEFAULT_POSE.spin_y}
            onChange={(spin_y) => setPose({ spin_y }, true)}
          />
          <SliderRow
            label="Spin Z"
            unit="°"
            value={pose.spin_z}
            min={-180}
            max={180}
            defaultValue={DEFAULT_POSE.spin_z}
            onChange={(spin_z) => setPose({ spin_z }, true)}
          />
        </>
      )}

      <p
        className="h-row text-value tabular text-muted-foreground flex items-center gap-2 px-2"
        data-testid="angle-collapsed"
      >
        {onCamera
          ? `device  ${deg(pose.spin_x)} ${deg(pose.spin_y)} ${deg(pose.spin_z)}`
          : `camera  ${deg(camera.azimuth)} ${deg(camera.elevation)}`}
      </p>
    </PanelSection>
  )
}

function deg(value: number): string {
  return `${Math.round(value)}°`
}
