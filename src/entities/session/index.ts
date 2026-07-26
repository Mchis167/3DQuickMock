import { create } from 'zustand'

import { layerOf, type TimelineLayer } from '@/entities/animation/layers'
import type { PlateManifest } from '@/entities/composite'
import type { ChannelKey } from '@schema/channels'

/**
 * `uiStore` — state KHÔNG được undo (Architecture.md §6).
 *
 * URL preview, đang render hay không, panel nào mở. Trộn vào documentStore thì Ctrl+Z
 * sẽ đóng panel thay vì hoàn tác thao tác — lỗi kinh điển mà thiết kế này tránh.
 */
export type AngleSet = 'device' | 'camera'

/**
 * Tab đang mở trong inspector — theo đúng thứ tự workflow.
 *
 * `video` chỉ xuất hiện ở chế độ video (fps/thời lượng/tỉ lệ khung) — TÁCH RIÊNG khỏi
 * `control`. Hai thứ này KHÔNG cùng một mental model: `control` đổi theo layer đang chọn
 * (Device/Camera/Lighting), còn cấu hình video là một cục toàn cục không thuộc layer nào.
 * Nhét chung một chỗ khiến người dùng tưởng đổi layer sẽ đổi luôn cấu hình video — sai.
 */
export type InspectorTab = 'import' | 'control' | 'video' | 'export'

/**
 * Tab con của Import. Ảnh và video là HAI ĐƯỜNG khác nhau ở tận gốc — ảnh đi thẳng vào
 * Blender, video thì ghép ở client trên một plate — nên gộp chúng vào một màn hình chỉ khiến
 * người dùng tưởng có thể dùng cả hai cùng lúc.
 */
export type ImportKind = 'image' | 'video'

/**
 * Hai chế độ xem canvas, không hơn.
 *
 * `fit` — ảnh luôn vừa khung, không tương tác. `zoom` — tự do phóng/kéo bằng chuột và bàn
 * phím. Ba mức cố định 100%/200% như trước vừa thiếu (muốn 400% để soi mép kính) vừa thừa
 * (đã có zoom tự do thì không cần mức đặt sẵn).
 */
export type Zoom = 'fit' | 'zoom'

/**
 * Độ nét của preview. KHÔNG thuộc tài liệu: đây là lựa chọn về máy đang dùng mạnh hay yếu,
 * không phải thuộc tính của mockup — nên nó không được vào undo và không được lưu vào project.
 */
export type PreviewQualityLevel = 'low' | 'med' | 'high' | 'max'

export interface PreviewResult {
  url: string
  /** Thời gian Blender render, ms — do worker báo về, không phải UI tự đo. */
  ms: number
  /** Độ nâng do chế độ đứng trên mặt phẳng, mm. */
  liftMm: number
  /** Khoảng hở giữa đáy máy và mặt phẳng, mm. Âm = đang cắm xuống. */
  bottomGapMm: number
}

/**
 * Nguồn màn hình đang dùng. Ảnh tĩnh đi thẳng vào Blender; video thì KHÔNG — nó được ghép ở
 * client bằng WebGL trên một plate mà Blender render sẵn (Pha 5). Nên hai đường này khác nhau
 * ở tận gốc, và trộn chung một field là cách nhanh nhất để nhầm.
 */
export interface VideoSource {
  /** URL tương đối dưới `/cache/uploads/`. */
  url: string
  width: number
  height: number
}

/**
 * Keyframe đang chọn trên timeline. `null` = không chọn gì.
 *
 * Ở uiStore chứ không ở tài liệu: chọn một keyframe không làm thay đổi sản phẩm, và
 * Ctrl+Z mà nhảy vùng chọn thì người dùng mất dấu chỗ mình đang làm.
 */
export interface KeyframeRef {
  channel: ChannelKey
  frame: number
}

/**
 * Dải ảnh đã render sẵn để phát lại ở đúng fps.
 *
 * `signature` là vân tay của cấu hình lúc dựng. Không có nó thì người dùng xoay máy xong
 * bấm phát và thấy một đoạn phim của cấu hình CŨ — mượt, đúng nhịp, và sai hoàn toàn. Đúng
 * cái bẫy mà plate của Pha 5 đã sập một lần.
 */
export interface PlaybackCache {
  signature: string
  urls: readonly string[]
  fps: number
}

/**
 * Dải PNG trích từ video, để Blender dán lên màn hình theo từng frame.
 *
 * Ở uiStore vì nó DẪN XUẤT hoàn toàn từ (video, fps) — server cache nó theo đúng hai thứ đó
 * nên dựng lại là rẻ, và nó không phải một quyết định của người dùng để mà undo.
 */
export interface ScreenSequenceInfo {
  /** Thư mục tương đối so với gốc repo. */
  dir: string
  /** Số khung THẬT trên đĩa — độ dài của clip trên timeline. */
  frames: number
}

export interface SessionStore {
  activeAngleSet: AngleSet
  tab: InspectorTab
  importKind: ImportKind
  zoom: Zoom
  previewQuality: PreviewQualityLevel
  preview: PreviewResult | null
  /** Plate cho đường video. `null` khi chưa dựng hoặc khi góc vừa đổi. */
  plate: PlateManifest | null
  /**
   * Vân tay của cấu hình lúc plate được dựng.
   *
   * Plate gắn chặt vào MỘT bộ camera/pose/HDRI/màn hình. Không có vân tay thì người dùng xoay
   * máy xong vẫn thấy video phát mượt trên một tấm ảnh SAI GÓC, và không có gì báo.
   */
  plateSignature: string | null
  video: VideoSource | null
  /** Đang có yêu cầu render bay trên đường. */
  rendering: boolean
  /** Lỗi gần nhất, hiện thẳng lên UI thay vì im lặng (xem Pha 10). */
  error: string | null

  /** Frame đang đứng trên timeline, 1-based. */
  playhead: number
  /** Keyframe "chính" — cái panel Keyframe hiển thị thông số. `refs[0]` của nhóm bên dưới. */
  selectedKeyframe: KeyframeRef | null
  /**
   * Cả nhóm đang chọn (marquee kéo qua nhiều viên, hoặc một viên bấm thường = nhóm 1).
   *
   * Tách khỏi `selectedKeyframe` vì hai việc khác nhau: cái kia là "hiển thị thông số của
   * AI", cái này là "kéo/xoá/đổi nội suy CÁI GÌ cùng lúc". Luôn giữ bất biến
   * `selectedKeyframe === selectedKeyframes[0] ?? null` — cập nhật qua `selectKeyframes`,
   * không gán tay hai field riêng lẻ.
   */
  selectedKeyframes: readonly KeyframeRef[]
  playing: boolean
  playbackCache: PlaybackCache | null
  /** Đang render dải ảnh phát lại. Chặn bấm phát lần hai và cho status bar có gì mà nói. */
  playbackBuilding: boolean
  /** Tiến độ dựng dải, 0..1. `null` khi không dựng. Có thật vì render chia theo lượt. */
  playbackProgress: number | null
  /**
   * Giá trị đường cong đã LẤY MẪU, theo frame, do worker Blender tính.
   *
   * Ở uiStore vì đây là state DẪN XUẤT: nguồn sự thật là `channels` trong tài liệu, còn
   * đây chỉ là bộ nhớ đệm. `null` = chưa lấy mẫu xong.
   *
   * Vì sao không tự nội suy trong TS: đường cong Blender có 13 kiểu nội suy, easing hai
   * chiều và tay cầm bezier. Tự tính là UI nói một chuyện, render ra một chuyện khác, và
   * người dùng chỉ biết sau khi export. Architecture.md §9.
   */
  curveSamples: Partial<Record<ChannelKey, readonly number[]>> | null
  /** Dải PNG của video. `null` khi chưa trích hoặc không có video. */
  screenSequence: ScreenSequenceInfo | null

  /**
   * Layer đang chỉnh trong Control tab ở chế độ video: Device / Camera / Lighting.
   *
   * Đây là chỗ chốt để panel Control KHÔNG nhồi cả sáu section cùng lúc — chỉ panel của
   * layer đang chọn hiện ra. Chọn một keyframe trên timeline tự đổi layer theo kênh đó
   * (xem `selectKeyframe`), vì người dùng chọn keyframe của Device thì đang muốn sửa
   * Device, không phải tự đi tìm đúng panel.
   */
  videoLayer: TimelineLayer['id']

  setActiveAngleSet(set: AngleSet): void
  setTab(tab: InspectorTab): void
  setImportKind(kind: ImportKind): void
  setZoom(zoom: Zoom): void
  setPreviewQuality(level: PreviewQualityLevel): void
  setRendering(rendering: boolean): void
  setPreview(preview: PreviewResult): void
  setPlate(plate: PlateManifest | null, signature?: string): void
  setVideo(video: VideoSource | null): void
  setError(error: string | null): void
  setPlayhead(frame: number): void
  setPlaying(playing: boolean): void
  setPlaybackCache(cache: PlaybackCache | null): void
  setPlaybackBuilding(building: boolean): void
  setPlaybackProgress(progress: number | null): void
  setCurveSamples(samples: Partial<Record<ChannelKey, readonly number[]>> | null): void
  setScreenSequence(sequence: ScreenSequenceInfo | null): void
  setVideoLayer(layer: TimelineLayer['id']): void
  selectKeyframe(ref: KeyframeRef | null): void
  /** Chọn cả một nhóm cùng lúc (kết quả marquee, hoặc kéo một cụm đang chọn). */
  selectKeyframes(refs: readonly KeyframeRef[]): void
}

export const useSessionStore = create<SessionStore>((set) => ({
  activeAngleSet: 'camera',
  tab: 'control',
  importKind: 'image',
  zoom: 'fit',
  previewQuality: 'med',
  preview: null,
  plate: null,
  plateSignature: null,
  video: null,
  rendering: false,
  error: null,
  playhead: 1,
  selectedKeyframe: null,
  selectedKeyframes: [],
  playing: false,
  playbackCache: null,
  playbackBuilding: false,
  playbackProgress: null,
  curveSamples: null,
  screenSequence: null,
  videoLayer: 'device',

  setActiveAngleSet: (activeAngleSet) => set({ activeAngleSet }),
  setTab: (tab) => set({ tab }),
  setImportKind: (importKind) => set({ importKind }),
  setZoom: (zoom) => set({ zoom }),
  setPreviewQuality: (previewQuality) => set({ previewQuality }),
  setRendering: (rendering) => set({ rendering }),
  // Có ảnh mới thì lỗi cũ không còn đúng nữa.
  setPreview: (preview) => set({ preview, error: null }),
  // Đổi góc là plate cũ hết hiệu lực: nó gắn chặt vào MỘT bộ camera/pose/HDRI. Giữ lại thì
  // video vẫn phát mượt trên một tấm ảnh sai góc, và không có gì báo cho người dùng biết.
  setPlate: (plate, signature) =>
    set({ plate, plateSignature: plate ? (signature ?? null) : null }),
  // Đổi video là dải PNG cũ hết hiệu lực cùng với plate: nó được trích từ đúng video đó.
  setVideo: (video) => set({ video, plate: null, plateSignature: null, screenSequence: null }),
  setError: (error) => set({ error }),
  setPlayhead: (playhead) => set({ playhead: Math.max(1, Math.round(playhead)) }),
  setPlaying: (playing) => set({ playing }),
  setPlaybackCache: (playbackCache) => set({ playbackCache }),
  setPlaybackBuilding: (playbackBuilding) => set({ playbackBuilding }),
  setPlaybackProgress: (playbackProgress) => set({ playbackProgress }),
  setCurveSamples: (curveSamples) => set({ curveSamples }),
  setScreenSequence: (screenSequence) => set({ screenSequence }),
  setVideoLayer: (videoLayer) => set({ videoLayer }),
  // Chọn một keyframe = chọn nhóm gồm đúng một cái. Giữ hàm riêng vì phần lớn nơi gọi
  // (bấm một viên, tua timeline để deselect) chỉ nói tới một cái, không phải một nhóm.
  selectKeyframe: (ref) =>
    set((state) => selectRefs(state, ref ? [ref] : [])),
  // Chọn keyframe (hay cả nhóm) của kênh nào thì chuyển LUÔN sang layer đó — người dùng
  // bấm vào keyframe của Device đang muốn sửa Device, không phải tự tìm đúng panel. Với
  // Device/Camera cũng đồng bộ `activeAngleSet` để AnglePanel mở đúng bộ số. Dùng
  // `refs[0]` làm đại diện cho cả nhóm — marquee chỉ chọn key trong CÙNG một dòng layer,
  // nên mọi ref trong nhóm vốn đã cùng layer với nhau.
  selectKeyframes: (refs) => set((state) => selectRefs(state, refs)),
}))

function selectRefs(
  state: SessionStore,
  refs: readonly KeyframeRef[],
): Pick<SessionStore, 'selectedKeyframe' | 'selectedKeyframes' | 'videoLayer' | 'activeAngleSet'> {
  const primary = refs[0] ?? null
  if (!primary) {
    return {
      selectedKeyframe: null,
      selectedKeyframes: [],
      videoLayer: state.videoLayer,
      activeAngleSet: state.activeAngleSet,
    }
  }
  const layer = layerOf(primary.channel).id
  return {
    selectedKeyframe: primary,
    selectedKeyframes: refs,
    videoLayer: layer,
    activeAngleSet:
      layer === 'camera' ? 'camera' : layer === 'device' ? 'device' : state.activeAngleSet,
  }
}
