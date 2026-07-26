/**
 * Lõi animation: thao tác keyframe thuần + định nghĩa layer timeline.
 *
 * KHÔNG chứa phép nội suy. Giá trị giữa các keyframe do Blender tính (lệnh `sample` của
 * worker) — nếu UI tự tính thì đường cong trên màn hình sẽ nói dối và người dùng chỉ
 * phát hiện sau khi export xong. Architecture.md §9.
 */
export {
  FIRST_FRAME,
  clampFrame,
  hasAnimation,
  keyedFrames,
  keyframeAt,
  keyframesInRange,
  loopWarnings,
  moveKeyframe,
  moveKeyframeGroup,
  removeKeyframe,
  removeKeyframeGroup,
  setKeyframe,
  setKeyframeInterpolation,
  setInterpolationGroup,
} from './keyframes'

export type { ChannelFrame, Channels, KeyframeInit, LoopWarning } from './keyframes'

export { TIMELINE_LAYERS, layerOf } from './layers'
export type { TimelineLayer } from './layers'

export {
  ASPECT_IDS,
  ASPECT_RES,
  frameToSeconds,
  lastFrame,
  PLAYBACK_LONG_EDGE,
  PLAYBACK_MS_PER_FRAME,
  PLAYBACK_SAMPLES,
  playbackResolution,
  resolutionOf,
  timelineFrames,
  timelineSchema,
} from './timeline'
export type { AspectId, Timeline } from './timeline'

export {
  clipEnd,
  renderChunks,
  screenClipSchema,
  screenFramePath,
  videoFrameAt,
} from './screen-clip'
export type { RenderChunk, ScreenClip } from './screen-clip'
