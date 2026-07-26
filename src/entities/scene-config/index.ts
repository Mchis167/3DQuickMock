/**
 * Lõi test được: schema là nguồn sự thật, cộng các phép biến đổi THUẦN.
 *
 * Schema thật nằm ở `schema/` (ngoài `src/`) vì bước sinh JSON Schema cho Python đọc
 * từ đó. Ở đây chỉ tái xuất để tầng UI có một cửa duy nhất.
 */

export {
  SCHEMA_VERSION,
  sceneConfigSchema,
  cameraSchema,
  poseSchema,
  channelSchema,
  keyframeSchema,
  renderSchema,
  worldSchema,
  migrateConfig,
  parseSceneConfig,
  safeParseSceneConfig,
} from '@schema/scene-config'

export type {
  SceneConfig,
  SceneConfigInput,
  Keyframe,
  ChannelSpec,
  CameraSettings,
  PoseSettings,
  RenderSettings,
  WorldSettings,
} from '@schema/scene-config'

export {
  CHANNELS,
  CHANNEL_KEYS,
  EASINGS,
  HANDLE_TYPES,
  INTERPOLATIONS,
  MODIFIER_TYPES,
} from '@schema/channels'

export type {
  ChannelKey,
  ChannelMeta,
  Easing,
  HandleType,
  Interpolation,
  ModifierType,
} from '@schema/channels'

export { frameCount } from './timing'
