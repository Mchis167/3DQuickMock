import { create } from 'zustand'

import {
  lastFrame,
  moveKeyframe as moveKeyframeIn,
  moveKeyframeGroup as moveKeyframeGroupIn,
  removeKeyframe as removeKeyframeIn,
  removeKeyframeGroup as removeKeyframeGroupIn,
  setInterpolationGroup as setInterpolationGroupIn,
  setKeyframe as setKeyframeIn,
  setKeyframeInterpolation,
  type ChannelFrame,
  type Timeline,
} from '@/entities/animation'
import { deviceById, fitFrameFill, IPHONE_17_PRO_MAX } from '@/entities/device'
import type { ChannelKey, Easing, Interpolation } from '@schema/channels'

import { channelOf, readChannel, writeChannel, type ChannelGroup } from './channel-binding'
import { createDocument, DEFAULT_CAMERA, DEFAULT_POSE, type MockupDocument } from './document'
import {
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo,
  seal,
  undo,
  type History,
} from './history'

/**
 * `documentStore` — state ĐƯỢC undo. Cặp đôi của nó là `uiStore` (không undo).
 *
 * Tất cả thay đổi đi qua `commit()` nên không có đường nào sửa tài liệu mà lịch sử
 * không biết. `coalesce` để kéo slider chỉ thành một bước undo.
 */
export interface DocumentStore {
  history: History<MockupDocument>
  document: MockupDocument
  canUndo: boolean
  canRedo: boolean
  /**
   * Frame để auto-key, hoặc `null` ở chế độ tĩnh. Do UI đổ vào từ playhead.
   *
   * KHÔNG nằm trong `document` nên không vào lịch sử undo — playhead là state của UI.
   */
  autoKeyFrame: number | null

  patch(label: string, recipe: (draft: MockupDocument) => void, coalesce?: boolean): void
  setCamera(values: Partial<MockupDocument['camera']>, coalesce?: boolean): void
  setPose(values: Partial<MockupDocument['pose']>, coalesce?: boolean): void
  setWorld(values: Partial<MockupDocument['world']>, coalesce?: boolean): void
  /** Đổi preset môi trường — PHẢI lấy cả `strength` đã hiệu chuẩn, xem chú thích dưới. */
  selectEnvironment(preset: {
    id: string
    hdri: string
    strength: number
    rotation: number
  }): void
  /** Đặt ảnh màn hình đã khớp tỉ lệ, kèm file gốc và chế độ đã dùng. */
  setScreen(values: {
    screen: string
    source?: string | null
    mode?: MockupDocument['fitMode']
  }): void
  resetCamera(): void
  resetPose(): void

  // ------------------------------------------------------------------ animation
  setAutoKeyFrame(frame: number | null): void
  setMode(mode: MockupDocument['mode']): void
  setTimeline(values: Partial<Timeline>, coalesce?: boolean): void
  /** Chốt keyframe tại `frame` bằng giá trị ĐANG hiển thị của kênh đó. */
  keyChannel(key: ChannelKey, frame: number): void
  /** Chốt keyframe cho mọi kênh của một layer cùng lúc — nút "key all" của layer. */
  keyChannels(keys: readonly ChannelKey[], frame: number): void
  moveKeyframe(key: ChannelKey, from: number, to: number, coalesce?: boolean): void
  /**
   * Dời keyframe của NHIỀU kênh cùng lúc, trong một bước undo.
   *
   * Kéo trên dòng gộp của một layer là kéo cả cụm key ở frame đó. Làm từng kênh một sẽ
   * cho ba bước undo cho một cú kéo, và undo giữa chừng để lại cụm key bị xé lẻ.
   */
  moveKeyframes(keys: readonly ChannelKey[], from: number, to: number, coalesce?: boolean): void
  /**
   * Dời cả một NHÓM keyframe đã chọn (marquee) bằng một ĐỘ LỆCH, giữ nguyên khoảng cách
   * tương đối giữa chúng. Trả về vị trí mới của từng key — UI cần nó để vùng chọn "bám"
   * theo cụm đang kéo thay vì đứng yên tại toạ độ cũ.
   */
  moveKeyframeGroup(refs: readonly ChannelFrame[], delta: number, coalesce?: boolean): ChannelFrame[]
  removeKeyframe(key: ChannelKey, frame: number): void
  removeKeyframes(keys: readonly ChannelKey[], frame: number): void
  /** Xoá cả một nhóm keyframe đã chọn trong một bước undo. */
  removeKeyframeGroup(refs: readonly ChannelFrame[]): void
  /** Áp cùng một kiểu nội suy cho cả nhóm — đổi easing/curve hàng loạt. */
  setInterpolationGroup(
    refs: readonly ChannelFrame[],
    interpolation: Interpolation,
    easing: Easing,
  ): void
  /**
   * Sửa GIÁ TRỊ của keyframe tại `frame`.
   *
   * Kênh đã có animation thì slider không còn sửa được giá trị nền nữa — nó sửa cái
   * keyframe đang đứng. Cho slider ghi thẳng vào `camera`/`pose` khi đã có đường cong là
   * để người dùng kéo một thứ không có tác dụng gì lên kết quả render.
   */
  setKeyframeValue(key: ChannelKey, frame: number, value: number, coalesce?: boolean): void
  setInterpolation(
    key: ChannelKey,
    frame: number,
    interpolation: Interpolation,
    easing: Easing,
  ): void
  /**
   * Dời clip màn hình trên timeline.
   *
   * `coalesce` để cả cú kéo thanh clip chỉ thành MỘT bước undo, giống kéo slider.
   */
  setScreenClipStart(start: number, coalesce?: boolean): void
  clearAnimation(): void
  /**
   * Kết thúc một cụm thao tác gộp (thả chuột, rời ô nhập).
   *
   * Không có nó thì hai lần kéo cùng một keyframe, cách nhau bao lâu cũng vậy, gộp
   * chung một bước undo — vì `coalesce` nhận diện cụm bằng nhãn.
   */
  endGesture(): void

  fitToFrame(target?: number): void
  undo(): void
  redo(): void
}

/**
 * AUTO-KEY: một thay đổi trên kênh đã có animation phải thành keyframe tại frame đang
 * đứng, không phải ghi vào giá trị nền.
 *
 * Vì sao bắt buộc: kênh có đường cong thì giá trị nền không còn ảnh hưởng gì tới hình
 * render ra. Cho slider ghi vào đó là để người dùng xoay chán chê mà preview đứng im —
 * họ tưởng công cụ hỏng, trong khi nó đang làm đúng thứ được bảo.
 *
 * `autoKeyFrame` là frame đang đứng, do UI đổ vào. Nó KHÔNG ở trong `document` nên không
 * vào lịch sử undo — playhead là state của UI.
 *
 * `null` (chế độ tĩnh) thì mọi thứ ghi vào giá trị nền như cũ.
 */
function writeGroup(
  get: () => DocumentStore,
  group: ChannelGroup,
  values: Record<string, unknown>,
  coalesce: boolean,
) {
  const state = get()
  const frame = state.autoKeyFrame
  const { channels } = state.document

  state.patch(
    group,
    (draft) => {
      for (const [field, value] of Object.entries(values)) {
        const key = channelOf(group, field)
        const animated = key !== undefined && channels[key] !== undefined

        if (animated && frame !== null && typeof value === 'number') {
          setKeyframeIn(draft.channels, key, frame, value)
        }
        // Giá trị nền đi theo cả khi đã auto-key: xoá hết keyframe của kênh thì cái còn
        // lại phải là con số người dùng vừa nhìn thấy.
        Object.assign(draft[group], { [field]: value })
      }
    },
    coalesce,
  )
}

export const useDocumentStore = create<DocumentStore>((set, get) => {
  const apply = (next: History<MockupDocument>) =>
    set({
      history: next,
      document: next.present,
      canUndo: canUndo(next),
      canRedo: canRedo(next),
    })

  return {
    history: initHistory(createDocument()),
    document: createDocument(),
    canUndo: false,
    canRedo: false,
    autoKeyFrame: null,

    patch(label, recipe, coalesce = false) {
      apply(commit(get().history, label, recipe, { coalesce }))
    },

    setCamera(values, coalesce = false) {
      writeGroup(get, 'camera', values, coalesce)
    },

    setPose(values, coalesce = false) {
      writeGroup(get, 'pose', values, coalesce)
    },

    setWorld(values, coalesce = false) {
      writeGroup(get, 'world', values, coalesce)
    },

    setAutoKeyFrame(autoKeyFrame) {
      set({ autoKeyFrame })
    },

    selectEnvironment(preset) {
      get().patch('environment', (draft) => {
        draft.environmentId = preset.id
        draft.world.hdri = preset.hdri
        // `strength` của preset đã hiệu chuẩn để mọi môi trường cho độ phơi sáng tương
        // đương. Bỏ dòng này (hay đặt 1.0) là đổi môi trường sẽ nhảy sáng — một tiêu
        // chí "xong" của Pha 3 mất luôn.
        draft.world.strength = preset.strength
        draft.world.rotation = preset.rotation
      })
    },

    setScreen({ screen, source, mode }) {
      get().patch('screen', (draft) => {
        draft.screen = screen
        if (source !== undefined) draft.screenSource = source
        if (mode !== undefined) draft.fitMode = mode
      })
    },

    resetCamera() {
      get().patch('reset camera', (draft) => {
        draft.camera = { ...DEFAULT_CAMERA }
      })
    },

    resetPose() {
      get().patch('reset pose', (draft) => {
        draft.pose = { ...DEFAULT_POSE }
      })
    },

    fitToFrame(target = 0.9) {
      const { document } = get()
      const dims = (deviceById(document.device) ?? IPHONE_17_PRO_MAX).dimsMm
      const fill = fitFrameFill(dims, document.pose, document.camera, target)
      get().patch('fit to frame', (draft) => {
        draft.camera.frame_fill = fill
      })
    },

    setMode(mode) {
      get().patch('mode', (draft) => {
        draft.mode = mode
      })
    },

    setTimeline(values, coalesce = false) {
      get().patch(
        'timeline',
        (draft) => {
          Object.assign(draft.timeline, values)
        },
        coalesce,
      )
    },

    keyChannel(key, frame) {
      get().keyChannels([key], frame)
    },

    keyChannels(keys, frame) {
      const { document } = get()
      const end = lastFrame(document.timeline)
      get().patch('keyframe', (draft) => {
        for (const key of keys) {
          setKeyframeIn(draft.channels, key, Math.min(frame, end), readChannel(document, key))
        }
      })
    },

    moveKeyframe(key, from, to, coalesce = false) {
      get().moveKeyframes([key], from, to, coalesce)
    },

    moveKeyframes(keys, from, to, coalesce = false) {
      const end = lastFrame(get().document.timeline)
      get().patch(
        `move ${keys.join(',')}`,
        (draft) => {
          for (const key of keys) moveKeyframeIn(draft.channels, key, from, to, end)
        },
        coalesce,
      )
    },

    moveKeyframeGroup(refs, delta, coalesce = false) {
      const end = lastFrame(get().document.timeline)
      let moved: ChannelFrame[] = refs.map((ref) => ({ ...ref }))
      get().patch(
        `move ${refs.length} keyframes`,
        (draft) => {
          moved = moveKeyframeGroupIn(draft.channels, refs, delta, end)
        },
        coalesce,
      )
      return moved
    },

    removeKeyframe(key, frame) {
      get().removeKeyframes([key], frame)
    },

    removeKeyframes(keys, frame) {
      get().patch('remove keyframe', (draft) => {
        for (const key of keys) removeKeyframeIn(draft.channels, key, frame)
      })
    },

    removeKeyframeGroup(refs) {
      get().patch('remove keyframes', (draft) => {
        removeKeyframeGroupIn(draft.channels, refs)
      })
    },

    setInterpolationGroup(refs, interpolation, easing) {
      get().patch('interpolation', (draft) => {
        setInterpolationGroupIn(draft.channels, refs, interpolation, easing)
      })
    },

    setKeyframeValue(key, frame, value, coalesce = false) {
      get().patch(
        `value ${key}`,
        (draft) => {
          setKeyframeIn(draft.channels, key, frame, value)
          // Giá trị nền đi theo luôn: khi người dùng bỏ hết keyframe của kênh này, cái
          // còn lại phải là giá trị họ vừa nhìn thấy, không phải giá trị từ trước khi
          // animate.
          writeChannel(draft, key, value)
        },
        coalesce,
      )
    },

    setInterpolation(key, frame, interpolation, easing) {
      get().patch('interpolation', (draft) => {
        setKeyframeInterpolation(draft.channels, key, frame, interpolation, easing)
      })
    },

    setScreenClipStart(start, coalesce = false) {
      get().patch(
        'screen clip',
        (draft) => {
          draft.screenClip.start = Math.round(start)
        },
        coalesce,
      )
    },

    clearAnimation() {
      get().patch('clear animation', (draft) => {
        draft.channels = {}
      })
    },

    endGesture() {
      apply(seal(get().history))
    },

    undo() {
      apply(undo(get().history))
    },

    redo() {
      apply(redo(get().history))
    },
  }
})
