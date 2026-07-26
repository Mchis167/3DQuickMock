import { useDocumentStore } from '@/entities/scene-config/store'
import { apiUrl } from '@/shared/api/trpc'
import { cn } from '@/shared/lib/cn'
import { PanelSection } from '@/shared/ui/panel-section'
import { SliderRow } from '@/shared/ui/slider-row'

import { useEnvironments } from './use-environments'

/**
 * Bảng chọn môi trường + xoay/cường độ.
 *
 * Chọn preset lấy luôn `strength` đã hiệu chuẩn trong `presets.json`, nên đổi môi trường
 * KHÔNG nhảy độ phơi sáng (biên độ đo được: 1.6% trên 8 preset). Slider cường độ vẫn cho
 * lệch khỏi số đã hiệu chuẩn — đó là chủ ý người dùng, khác hẳn với mặc định sai.
 */
export function EnvironmentPanel() {
  const { presets, error } = useEnvironments()
  const document = useDocumentStore((state) => state.document)
  const setWorld = useDocumentStore((state) => state.setWorld)
  const selectEnvironment = useDocumentStore((state) => state.selectEnvironment)

  const current = presets?.find((preset) => preset.id === document.environmentId)

  return (
    <PanelSection title="Environment">
      {error ? (
        <p role="alert" className="text-helper text-destructive px-2">
          Failed to load presets.json: {error}
        </p>
      ) : null}

      {/* 20 preset trên 5 cột: ô vuông sát nhau, không khe hở — dạng lưới của công cụ. */}
      <div className="bg-border grid grid-cols-5 gap-px">
        {(presets ?? []).map((preset) => {
          const active = preset.id === document.environmentId
          return (
            <button
              key={preset.id}
              type="button"
              aria-label={preset.label}
              aria-pressed={active}
              title={`${preset.label} — ${preset.description}`}
              onClick={() => selectEnvironment(preset)}
              className={cn(
                'relative aspect-square overflow-hidden transition-opacity',
                active
                  ? 'ring-primary opacity-100 ring-2 ring-inset'
                  : 'opacity-60 hover:opacity-100',
              )}
            >
              <img
                src={apiUrl(preset.thumbnailUrl)}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          )
        })}
      </div>

      <SliderRow
        label="Rotation"
        unit="°"
        value={document.world.rotation}
        min={-180}
        max={180}
        defaultValue={0}
        onChange={(rotation) => setWorld({ rotation }, true)}
      />
      <SliderRow
        label="Strength"
        value={document.world.strength}
        min={0}
        max={4}
        step={0.05}
        // Double-click về đúng số đã hiệu chuẩn của preset đang chọn, không phải về 1.0 —
        // về 1.0 là làm đúng cái việc mà hiệu chuẩn sinh ra để tránh.
        {...(current ? { defaultValue: current.strength } : {})}
        onChange={(strength) => setWorld({ strength }, true)}
      />
    </PanelSection>
  )
}
