import { useDocumentStore } from '@/entities/scene-config/store'
import { PanelSection } from '@/shared/ui/panel-section'
import { Segmented } from '@/shared/ui/segmented'

const MODES = [
  { value: 'ground' as const, label: 'On floor' },
  { value: 'float' as const, label: 'Floating' },
]

/**
 * Công tắc đặt máy: đứng trên mặt phẳng hay lơ lửng.
 *
 * Khoảng hở đáy máy hiện ở **status bar**, không ở đây: ở draft EEVEE mặt phẳng bị ẩn
 * (EEVEE Next không có shadow catcher) nên mắt KHÔNG thấy được máy có cắm xuống sàn hay
 * không, và con số đó cần ở chỗ luôn nhìn thấy chứ không nằm trong một tab có thể đang đóng.
 */
export function GroundPanel() {
  const ground = useDocumentStore((state) => state.document.pose.ground)
  const setPose = useDocumentStore((state) => state.setPose)

  return (
    <PanelSection title="Floor">
      <div className="bg-input p-1">
        <Segmented
          label="Placement mode"
          options={MODES}
          value={ground ? 'ground' : 'float'}
          onChange={(mode) => setPose({ ground: mode === 'ground' })}
        />
      </div>
      <p className="text-helper text-muted-foreground px-2 py-1">
        Contact shadows are only available in final render (Cycles), not in draft.
      </p>
    </PanelSection>
  )
}
