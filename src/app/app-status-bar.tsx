import { useEffect, useState } from 'react'

import { deviceById, IPHONE_17_PRO_MAX, projectedHeightRatio } from '@/entities/device'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { trpc } from '@/shared/api/trpc'
import { PREVIEW_QUALITIES } from '@/features/static-mockup'
import { StatusBar, StatusDivider, StatusItem } from '@/shared/ui/status-bar'

/**
 * Toàn bộ số liệu của phiên làm việc, gom vào một dòng.
 *
 * Trước Pha 4.5 những số này là các dòng chữ nhỏ rải trong từng section panel, nên vừa làm
 * panel cao vừa lẫn giữa "thứ điều khiển được" và "thứ chỉ để đọc". Ở đây chúng luôn nhìn
 * thấy được, kể cả khi tab chứa control tương ứng đang đóng — điều đó quan trọng với
 * `gap` (máy có cắm xuống sàn không), vì ở draft EEVEE mắt không thấy được mặt phẳng.
 */
export function AppStatusBar() {
  const document = useDocumentStore((state) => state.document)
  const preview = useSessionStore((state) => state.preview)
  const rendering = useSessionStore((state) => state.rendering)
  const error = useSessionStore((state) => state.error)
  const quality = useSessionStore((state) => state.previewQuality)
  const [blender, setBlender] = useState<{ workerRunning: boolean; workerPid: number | null }>()

  useEffect(() => {
    // Chỉ hỏi một lần khi mở app: đường dẫn Blender và pid worker không đổi trong phiên.
    trpc.health.query().then(setBlender, () => setBlender(undefined))
  }, [])

  const dims = (deviceById(document.device) ?? IPHONE_17_PRO_MAX).dimsMm
  // `frame_fill` được Blender tính theo chiều cao lúc CHƯA xoay, nên nghiêng máy đi là
  // phần chiếm khung thật khác hẳn con số trên slider.
  const occupied =
    document.camera.frame_fill * projectedHeightRatio(dims, document.pose, document.camera)

  const gap = preview?.bottomGapMm ?? 0
  const sinking = document.pose.ground && gap < -0.01

  return (
    <StatusBar>
      <StatusItem
        label="worker"
        value={blender?.workerRunning ? `pid ${blender.workerPid}` : 'not running'}
        tone={blender?.workerRunning ? 'normal' : 'warn'}
      />
      <StatusDivider />
      <StatusItem
        label="draft"
        value={`${PREVIEW_QUALITIES[quality].res.join('×')} · ${PREVIEW_QUALITIES[quality].samples} spp`}
      />
      <StatusDivider />
      <StatusItem
        label=""
        value={rendering ? 'rendering…' : preview ? `${preview.ms} ms` : '—'}
        tone={rendering ? 'warn' : 'normal'}
      />
      <StatusDivider />
      <StatusItem
        label="fill"
        value={`${(occupied * 100).toFixed(0)}%`}
        title="Actual frame height percentage occupied by the device, accounting for tilt"
      />
      <StatusDivider />
      <StatusItem
        label="lift"
        value={`${(preview?.liftMm ?? 0).toFixed(1)} mm`}
        title="Elevation offset due to snap-to-floor mode"
      />
      <StatusItem
        label="gap"
        value={`${gap.toFixed(2)} mm`}
        tone={sinking ? 'error' : 'normal'}
        title="Distance between the device bottom and the floor. Negative means clipping through floor."
      />
      {sinking ? <StatusItem value="device clipping floor" tone="error" /> : null}

      {error ? (
        <>
          <StatusDivider />
          <StatusItem value={error} tone="error" />
        </>
      ) : null}
    </StatusBar>
  )
}
