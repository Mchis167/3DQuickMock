import { deviceById, IPHONE_17_PRO_MAX } from '@/entities/device'
import { DEFAULT_CAMERA } from '@/entities/scene-config/document'
import { useDocumentStore } from '@/entities/scene-config/store'
import { Button } from '@/shared/ui/button'
import { PanelSection } from '@/shared/ui/panel-section'
import { SliderRow } from '@/shared/ui/slider-row'

/** Phần chiều cao khung hình mà "Fit" nhắm tới — chừa lề để máy không sát mép. */
export const FIT_TARGET = 0.9

export function FramingPanel() {
  const document = useDocumentStore((state) => state.document)
  const setCamera = useDocumentStore((state) => state.setCamera)
  const fitToFrame = useDocumentStore((state) => state.fitToFrame)

  // Chỉ dùng để kiểm tra thiết bị có thật; phần trăm chiếm khung hiển thị ở status bar.
  const device = deviceById(document.device) ?? IPHONE_17_PRO_MAX

  return (
    <PanelSection
      title="Framing"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => fitToFrame(FIT_TARGET)}
          title={`Set frame fill so ${device.label} occupies ${FIT_TARGET * 100}% of the frame height`}
        >
          Fit
        </Button>
      }
    >
      <SliderRow
        label="Focal"
        unit="mm"
        value={document.camera.focal}
        min={14}
        max={200}
        defaultValue={DEFAULT_CAMERA.focal}
        onChange={(focal) => setCamera({ focal }, true)}
      />
      <SliderRow
        label="Frame fill"
        value={document.camera.frame_fill}
        // Schema: lớn hơn 0 và không quá 1. Bước 0.01 vì mắt không thấy nhỏ hơn thế.
        min={0.05}
        max={1}
        step={0.01}
        defaultValue={DEFAULT_CAMERA.frame_fill}
        onChange={(frame_fill) => setCamera({ frame_fill }, true)}
      />
    </PanelSection>
  )
}
