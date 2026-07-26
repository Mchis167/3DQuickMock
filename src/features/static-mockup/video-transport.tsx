import { Loader2, Pause, Play, RefreshCw } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'

import { useSessionStore } from '@/entities/session'
import { cn } from '@/shared/lib/cn'

/**
 * Thanh điều khiển video, nổi ở đáy canvas.
 *
 * Nó nằm ĐÂY chứ không nằm trong panel bên phải vì nó điều khiển thứ đang xem, và vì nút
 * **Build plate** phải ở ngay cạnh mockup — đó là lúc người dùng vừa chỉnh xong góc và đang
 * nhìn thẳng vào kết quả.
 *
 * Hai trạng thái, và chúng phải nhìn ra được ngay:
 *
 *   chưa có plate  — đang ở chế độ chỉnh: preview tĩnh, xoay/chỉnh thoải mái, chỉ có nút dựng
 *   có plate       — đang phát: video chạy trên plate đã khoá góc
 *
 * Đổi bất cứ thứ gì plate phụ thuộc là plate tự bị vứt (`usePlateInvalidation`) và thanh này
 * quay về trạng thái đầu. Nhờ vậy không bao giờ có chuyện video phát mượt trên một góc đã cũ.
 */

interface Props {
  video: HTMLVideoElement | null
  onBuildPlate: () => void
  building: boolean
}

/**
 * Điều khiển phần tử video nằm ngoài hàm render.
 *
 * `<video>` là đối tượng CÓ TRẠNG THÁI; luật lint của dự án chặn việc sửa nó ngay trong thân
 * component để không ai vô tình đổi DOM giữa lúc React đang dựng cây.
 */
function togglePlay(video: HTMLVideoElement | null): void {
  if (!video) return
  if (video.paused) void video.play().catch(() => undefined)
  else video.pause()
}

function seekTo(video: HTMLVideoElement | null, seconds: number): void {
  if (video) video.currentTime = seconds
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

const EVENTS = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'seeked'] as const

export function VideoTransport({ video, onBuildPlate, building }: Props) {
  const plate = useSessionStore((state) => state.plate)

  // `useSyncExternalStore` chứ không phải `useEffect` + `setState`: `<video>` là một nguồn
  // trạng thái NGOÀI React, và đọc nó bằng effect vừa gây một lượt render thừa vừa để lọt
  // khoảnh khắc giữa lúc gắn và lúc effect chạy — lúc đó thanh này hiện 0:00 cho một video
  // đang phát dở.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!video) return () => undefined
      for (const event of EVENTS) video.addEventListener(event, onChange)
      return () => {
        for (const event of EVENTS) video.removeEventListener(event, onChange)
      }
    },
    [video],
  )
  // Snapshot phải là một giá trị NGUYÊN THUỶ ổn định; trả về object mới mỗi lần gọi sẽ làm
  // React render vô tận.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (video ? `${video.paused ? 0 : 1}|${video.currentTime}|${video.duration}` : '0|0|0'),
    () => '0|0|0',
  )
  const [paused, rawTime, rawDuration] = snapshot.split('|')
  const playing = paused === '1'
  const time = Number(rawTime)
  const duration = Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : 0

  return (
    <div className="bg-card/90 h-control absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 border pl-2 backdrop-blur">
      {plate ? (
        <>
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            className="text-foreground flex size-5 items-center justify-center"
            onClick={() => togglePlay(video)}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>

          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={Math.max(duration, 0.001)}
            step={0.01}
            value={time}
            onChange={(event) => seekTo(video, Number(event.target.value))}
            className="w-40"
          />
          <span className="text-value tabular text-muted-foreground pr-1">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </>
      ) : (
        <span className="text-helper text-muted-foreground">
          {/* Nói rõ đang ở chế độ nào. Không có câu này thì người dùng không hiểu vì sao lúc
              thì kéo góc được, lúc thì không. */}
          adjust the angle freely, then build the plate to play video
        </span>
      )}

      <button
        type="button"
        onClick={onBuildPlate}
        disabled={building}
        className={cn(
          'text-ui flex items-center gap-1 px-2 py-0.5',
          building ? 'text-muted-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        {building ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
        {building ? 'rendering plate…' : plate ? 'Rebuild plate' : 'Build plate'}
      </button>
    </div>
  )
}
