import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Diamond,
  Loader2,
  Pause,
  Play,
  Trash2,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import {
  frameToSeconds,
  keyframeAt,
  keyframesInRange,
  lastFrame as lastFrameOf,
  loopWarnings,
  TIMELINE_LAYERS,
  type TimelineLayer,
} from '@/entities/animation'
import { isAnimatable } from '@/entities/scene-config/channel-binding'
import type { ChannelKey } from '@/entities/scene-config'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'

import { hasAnimation, PLAYBACK_MS_PER_FRAME } from '@/entities/animation'

import { KeyframeTrack } from './keyframe-track'
import { ScreenClipBar } from './screen-clip-bar'
import { formatTimecode, frameToX, tickFrames, xToFrame } from './scale'
import { usePlayback } from './use-playback'
import { useTrackWidth } from './use-track-width'

/**
 * Timeline: thước thời gian cộng ba layer cố định.
 *
 * Nằm DƯỚI canvas chứ không trong inspector bên phải: nó cần bề rộng, và nó nói về trục
 * thời gian của cả cảnh chứ không phải thuộc tính của một thứ đang chọn.
 */
export function TimelinePanel() {
  const document = useDocumentStore((state) => state.document)
  const keyChannels = useDocumentStore((state) => state.keyChannels)
  const moveKeyframes = useDocumentStore((state) => state.moveKeyframes)
  const moveKeyframeGroup = useDocumentStore((state) => state.moveKeyframeGroup)
  const removeKeyframes = useDocumentStore((state) => state.removeKeyframes)
  const clearAnimation = useDocumentStore((state) => state.clearAnimation)
  const endGesture = useDocumentStore((state) => state.endGesture)

  const playhead = useSessionStore((state) => state.playhead)
  const setPlayhead = useSessionStore((state) => state.setPlayhead)
  const selected = useSessionStore((state) => state.selectedKeyframe)
  const group = useSessionStore((state) => state.selectedKeyframes)
  const selectKeyframe = useSessionStore((state) => state.selectKeyframe)
  const selectKeyframes = useSessionStore((state) => state.selectKeyframes)
  const screenSequence = useSessionStore((state) => state.screenSequence)
  const setScreenClipStart = useDocumentStore((state) => state.setScreenClipStart)

  const [expanded, setExpanded] = useState<TimelineLayer['id'] | null>(null)
  const { ref, width } = useTrackWidth<HTMLDivElement>()

  const { playing, building, progress, cache, toggle } = usePlayback()

  const { timeline, channels } = document
  const end = lastFrameOf(timeline)
  const warnings = loopWarnings(channels)
  const animated = hasAnimation(channels)

  // Playhead có thể nằm ngoài timeline sau khi rút ngắn thời lượng — kẹp lúc HIỂN THỊ
  // chứ không sửa state, để kéo dài lại là nó về đúng chỗ cũ.
  const frame = Math.min(playhead, end)

  const scrub = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      setPlayhead(xToFrame(event.clientX - rect.left, width, end))
      // Tua bằng thước là tap RA KHỎI keyframe đang chọn — panel Keyframe (giờ nằm ngoài
      // tab Control) phải biến mất theo, không được dính lại chỉ vì người dùng đang xem
      // một chỗ khác của timeline.
      selectKeyframe(null)
    },
    [setPlayhead, end, selectKeyframe, width],
  )

  /** Bấm vào nền của một track (không trúng viên kim cương nào) — cùng lý do như `scrub`. */
  const scrubTrack = useCallback(
    (at: number) => {
      setPlayhead(at)
      selectKeyframe(null)
    },
    [setPlayhead, selectKeyframe],
  )

  /**
   * Kéo một viên kim cương thuộc dòng `keys`, từ `from` đến `to`.
   *
   * Nếu frame đang kéo là một phần của NHÓM đã chọn (marquee trước đó, hoặc đang giữ >1
   * key) thì dời cả nhóm theo cùng một độ lệch, giữ nguyên khoảng cách tương đối — không
   * phải chỉ dời mỗi viên đang cầm mà bỏ lại phần còn lại của nhóm.
   */
  const dragKeyframe = useCallback(
    (keys: readonly ChannelKey[], from: number, to: number) => {
      const delta = to - from
      const inGroup =
        group.length > 1 && group.some((ref) => keys.includes(ref.channel) && ref.frame === from)
      if (inGroup) {
        const moved = moveKeyframeGroup(group, delta, true)
        selectKeyframes(moved)
        return
      }
      moveKeyframes(keys, from, to, true)
      selectKeyframe({ channel: keys.find((key) => keyframeAt(channels, key, to)) ?? keys[0]!, frame: to })
    },
    [group, moveKeyframeGroup, moveKeyframes, selectKeyframe, selectKeyframes, channels],
  )

  /** Thả marquee trên dòng `keys` — mọi key trong [a, b] thành một nhóm chọn mới. */
  const marqueeSelect = useCallback(
    (keys: readonly ChannelKey[], a: number, b: number) => {
      const refs = keyframesInRange(channels, keys, a, b)
      selectKeyframes(refs)
    },
    [channels, selectKeyframes],
  )

  return (
    <section
      aria-label="Timeline"
      className="bg-card grid shrink-0 grid-rows-[auto_auto_1fr] border-t"
    >
      <header className="h-row flex items-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          title={
            building
              ? 'Đang render dải ảnh để phát lại…'
              : animated
                ? `Space — phát lại ở đúng fps. Lần đầu phải render sẵn ${end} frame (~${Math.round((end * PLAYBACK_MS_PER_FRAME) / 1000)}s).`
                : 'Chưa có keyframe nào để phát'
          }
          disabled={!animated}
          onClick={() => void toggle()}
        >
          {building ? (
            <Loader2 className="size-3 animate-spin" />
          ) : playing ? (
            <Pause className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
        </Button>
        <h2 className="text-section font-semibold tracking-wide">Timeline</h2>
        <span className="text-helper text-muted-foreground font-mono">
          {formatTimecode(frame, timeline.fps, frame === end)} · {frame}/{end}f · {timeline.fps}
          fps · {timeline.aspect}
        </span>

        {building ? (
          <span className="text-helper text-muted-foreground tabular">
            building playback · {Math.round((progress ?? 0) * 100)}% ·{' '}
            {Math.round((end * (1 - (progress ?? 0)) * PLAYBACK_MS_PER_FRAME) / 1000)}s left ·
            Space to stop
          </span>
        ) : playing ? (
          <span className="text-helper tabular text-amber-500">playing · loop</span>
        ) : cache ? (
          <span
            className="text-helper text-muted-foreground"
            title="Dải ảnh đã render sẵn; đổi góc hay keyframe là nó bị vứt và phải dựng lại"
          >
            playback cached
          </span>
        ) : null}

        {warnings.length > 0 ? (
          <span
            className="text-helper flex items-center gap-1 text-amber-500"
            title={warnings.map((w) => w.message).join('\n')}
          >
            <AlertTriangle className="size-3" />
            {warnings.length} loop warning{warnings.length > 1 ? 's' : ''}
          </span>
        ) : null}

        <div className="ml-auto">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear animation"
            title="Xoá toàn bộ keyframe (⌘Z hoàn tác được)"
            disabled={Object.keys(channels).length === 0}
            onClick={clearAnimation}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </header>

      {/* Cột nhãn cố định + vùng track co giãn. Mọi dòng dùng CÙNG lưới này nên
          keyframe của các layer thẳng hàng với vạch thước. */}
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] border-b">
        <div className="text-helper text-muted-foreground flex items-center border-r px-2">
          frame
        </div>
        <div
          ref={ref}
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={1}
          aria-valuemax={end}
          aria-valuenow={frame}
          aria-valuetext={`frame ${frame}, ${frameToSeconds(frame, timeline.fps).toFixed(2)}s`}
          className="h-ruler-h bg-timeline-ruler relative cursor-ew-resize pr-1 select-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            scrub(event)
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return
            scrub(event)
          }}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
            if (step === 0) return
            event.preventDefault()
            setPlayhead(Math.min(Math.max(frame + step, 1), end))
          }}
        >
          {tickFrames(width, end, timeline.fps).map((tick) => (
            <div
              key={tick}
              style={{ left: `${frameToX(tick, width, end)}px` }}
              className="absolute top-0 h-full border-l border-muted-foreground/20"
            >
              <span
                className={cn(
                  'text-helper text-muted-foreground absolute top-1 left-0 whitespace-nowrap select-none pointer-events-none',
                  tick === 1
                    ? 'pl-1'
                    : tick === end
                      ? '-translate-x-full pr-1'
                      : '-translate-x-1/2',
                )}
              >
                {formatTimecode(tick, timeline.fps, tick === end)}
              </span>
            </div>
          ))}
          <div
            data-testid="playhead"
            style={{ left: `${frameToX(frame, width, end)}px` }}
            className="bg-timeline-playhead pointer-events-none absolute top-0 h-full w-px"
          />
        </div>
      </div>

      <div className="grid content-start">
        {/* Layer Screen: video trên màn hình, dạng THANH vì nó có độ dài — khác hẳn ba layer
            dưới (keyframe, tức là các mốc rời rạc). Chỉ hiện khi đã trích được dải PNG; không
            có dải thì màn hình đứng ở một ảnh tĩnh và không có gì để đặt trên trục thời gian. */}
        {screenSequence ? (
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] border-b">
            <div
              className="flex items-center gap-1 border-r pr-1 pl-1"
              title="Video trên màn hình. Kéo thanh để chọn frame bắt đầu; trước đó giữ khung đầu, sau khi hết giữ khung cuối."
            >
              <span className="text-label truncate pl-4">Screen</span>
            </div>
            <div className="h-track-h bg-timeline-track relative">
              <ScreenClipBar
                clip={document.screenClip}
                videoFrames={screenSequence.frames}
                width={width}
                lastFrame={end}
                onMove={(start) => setScreenClipStart(start, true)}
                onCommit={endGesture}
              />
            </div>
          </div>
        ) : null}

        {TIMELINE_LAYERS.map((layer) => {
          const keys = layer.channels.filter(isAnimatable)
          const open = expanded === layer.id
          const hasKeyHere = keys.some((key) => keyframeAt(channels, key, frame))

          return (
            <div key={layer.id} className="grid">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] border-b">
                <div className="flex items-center gap-1 border-r pr-1 pl-1" title={layer.hint}>
                  <button
                    type="button"
                    aria-label={`${layer.label} channels`}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : layer.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {open ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                  </button>
                  <span className="text-label truncate">{layer.label}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={hasKeyHere ? `Remove ${layer.label} key` : `Key ${layer.label}`}
                    title={
                      hasKeyHere
                        ? 'Xoá keyframe của layer này tại frame đang đứng'
                        : 'Chốt giá trị hiện tại của layer này thành keyframe'
                    }
                    onClick={() =>
                      hasKeyHere ? removeKeyframes(keys, frame) : keyChannels(keys, frame)
                    }
                  >
                    <Diamond className={cn('size-3', hasKeyHere ? 'fill-current' : '')} />
                  </Button>
                </div>

                <div className="h-track-h bg-timeline-track relative pr-12">
                  <KeyframeTrack
                    channels={channels}
                    keys={keys}
                    width={width}
                    lastFrame={end}
                    label={`${layer.label} track`}
                    selectedFrame={
                      selected && keys.includes(selected.channel as (typeof keys)[number])
                        ? selected.frame
                        : null
                    }
                    groupFrames={group
                      .filter((ref) => keys.includes(ref.channel as (typeof keys)[number]))
                      .map((ref) => ref.frame)}
                    onSelect={(at) =>
                      selectKeyframe({
                        channel: keys.find((key) => keyframeAt(channels, key, at)) ?? keys[0]!,
                        frame: at,
                      })
                    }
                    onMove={(from, to) => dragKeyframe(keys, from, to)}
                    onScrub={scrubTrack}
                    onCommit={endGesture}
                    onMarquee={(a, b) => marqueeSelect(keys, a, b)}
                  />
                </div>
              </div>

              {open
                ? keys.map((key) => (
                  <div key={key} className="grid grid-cols-[7rem_minmax(0,1fr)] border-b">
                    <div className="bg-background flex items-center gap-1 border-r pr-1 pl-6">
                      <span className="text-helper text-muted-foreground truncate">
                        {key.split('.')[1]}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto"
                        aria-label={
                          keyframeAt(channels, key, frame)
                            ? `Remove ${key} key`
                            : `Key ${key}`
                        }
                        onClick={() =>
                          keyframeAt(channels, key, frame)
                            ? removeKeyframes([key], frame)
                            : keyChannels([key], frame)
                        }
                      >
                        <Diamond
                          className={cn(
                            'size-2.5',
                            keyframeAt(channels, key, frame) ? 'fill-current' : '',
                          )}
                        />
                      </Button>
                    </div>
                    <div className="h-track-h bg-background relative pr-12">
                      <KeyframeTrack
                        channels={channels}
                        keys={[key]}
                        width={width}
                        lastFrame={end}
                        label={`${key} track`}
                        selectedFrame={selected?.channel === key ? selected.frame : null}
                        groupFrames={group
                          .filter((ref) => ref.channel === key)
                          .map((ref) => ref.frame)}
                        onSelect={(at) => selectKeyframe({ channel: key, frame: at })}
                        onMove={(from, to) => dragKeyframe([key], from, to)}
                        onScrub={scrubTrack}
                        onCommit={endGesture}
                        onMarquee={(a, b) => marqueeSelect([key], a, b)}
                      />
                    </div>
                  </div>
                ))
                : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
