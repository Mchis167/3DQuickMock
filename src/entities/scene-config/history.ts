import {
  applyPatches,
  enablePatches,
  produceWithPatches,
  type Objectish,
  type Patch,
} from 'immer'

enablePatches()

/**
 * Undo/redo theo PATCH, không phải snapshot.
 *
 * Vì sao patch: Pha 7 (curve editor) sinh ra hàng trăm thao tác nhỏ trên cùng một tài
 * liệu; snapshot toàn bộ mỗi lần vừa tốn bộ nhớ vừa làm mất khả năng gộp thao tác. Và
 * Architecture.md §6 nói rõ phải thiết kế từ đầu — bổ sung sau là viết lại.
 *
 * Đây là logic THUẦN, không biết React: store chỉ bọc nó lại.
 */
export interface HistoryEntry {
  readonly label: string
  readonly patches: readonly Patch[]
  readonly inverse: readonly Patch[]
  /**
   * Đã đóng: thao tác sau KHÔNG được gộp vào nữa dù cùng nhãn.
   *
   * Cần vì `coalesce` nhận diện cụm bằng nhãn. Không có dấu đóng thì hai lần kéo cùng
   * một keyframe, cách nhau mười phút, vẫn gộp thành một bước undo — và người dùng bấm
   * Ctrl+Z một lần thấy mất cả hai.
   */
  readonly sealed?: boolean
}

export interface History<T> {
  readonly present: T
  readonly past: readonly HistoryEntry[]
  readonly future: readonly HistoryEntry[]
}

export function initHistory<T extends Objectish>(present: T): History<T> {
  return { present, past: [], future: [] }
}

/**
 * Áp một thay đổi và ghi vào lịch sử.
 *
 * `coalesceWith`: kéo slider sinh ra hàng chục thay đổi liên tiếp cùng loại. Nếu mỗi cái
 * thành một bước undo thì Ctrl+Z phải bấm 40 lần mới về được chỗ cũ. Truyền cùng một
 * nhãn thì bước mới gộp vào bước trước — patch nghịch giữ nguyên của lần đầu, nên undo
 * quay về đúng giá trị trước khi bắt đầu kéo.
 */
export function commit<T extends Objectish>(
  history: History<T>,
  label: string,
  recipe: (draft: T) => void,
  options: { coalesce?: boolean } = {},
): History<T> {
  const [next, patches, inverse] = produceWithPatches(history.present, recipe)
  if (patches.length === 0) return history

  const previous = history.past[history.past.length - 1]
  if (options.coalesce && previous?.label === label && !previous.sealed) {
    const merged: HistoryEntry = {
      label,
      patches: [...previous.patches, ...patches],
      // Thứ tự nghịch: patch nghịch của lần sau phải được áp TRƯỚC.
      inverse: [...inverse, ...previous.inverse],
    }
    return {
      present: next,
      past: [...history.past.slice(0, -1), merged],
      future: [],
    }
  }

  // Làm thao tác mới thì nhánh redo cũ không còn ý nghĩa.
  return { present: next, past: [...history.past, { label, patches, inverse }], future: [] }
}

/**
 * Đóng bước hiện tại. Gọi khi thả chuột hay rời ô nhập — tức là khi một cụm thao tác
 * liên tục đã kết thúc.
 */
export function seal<T extends Objectish>(history: History<T>): History<T> {
  const entry = history.past[history.past.length - 1]
  if (!entry || entry.sealed) return history
  return { ...history, past: [...history.past.slice(0, -1), { ...entry, sealed: true }] }
}

export function undo<T extends Objectish>(history: History<T>): History<T> {
  const entry = history.past[history.past.length - 1]
  if (!entry) return history
  return {
    present: applyPatches(history.present, [...entry.inverse]),
    past: history.past.slice(0, -1),
    future: [entry, ...history.future],
  }
}

export function redo<T extends Objectish>(history: History<T>): History<T> {
  const [entry, ...rest] = history.future
  if (!entry) return history
  return {
    present: applyPatches(history.present, [...entry.patches]),
    past: [...history.past, entry],
    future: rest,
  }
}

export function canUndo<T extends Objectish>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T extends Objectish>(history: History<T>): boolean {
  return history.future.length > 0
}
