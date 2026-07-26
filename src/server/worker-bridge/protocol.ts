/**
 * Giao thức dòng lệnh với scripts/blender/worker.py.
 *
 * Mỗi dòng stdin là một lệnh JSON; mỗi dòng stdout bắt đầu bằng `@@` là một phản hồi
 * JSON. Tiền tố tồn tại vì Blender in rất nhiều log ra cùng stdout — không có nó thì
 * không tách được đâu là câu trả lời.
 */

export const REPLY_PREFIX = '@@'

export interface WorkerReply {
  ok: boolean
  error?: string
  trace?: string
  [key: string]: unknown
}

/** Phần cấu hình chung mà `apply_config()` của worker.py đọc, dùng lại cho mọi lệnh render. */
/** Dải ảnh dán lên màn hình theo frame timeline — xem scene_lib.set_screen_sequence. */
export interface ScreenSequenceField {
  /** Đường dẫn TUYỆT ĐỐI tới khung đầu; Blender suy các khung sau theo số thứ tự. */
  first: string
  frames: number
  /** Frame timeline mà khung đầu rơi vào. */
  start: number
}

export interface ConfigFields {
  screen?: string
  camera?: Record<string, number>
  pose?: Record<string, number | boolean>
  world?: { hdri?: string; strength?: number; rotation?: number }
  quality?: { engine?: 'eevee' | 'cycles'; res?: [number, number]; samples?: number }
  /** Loại trừ nhau với `screen`: worker ném lỗi nếu nhận cả hai. */
  screen_sequence?: ScreenSequenceField
}

export interface StillCommand extends ConfigFields {
  cmd: 'still'
  out: string
}

/** Bộ ảnh để client ghép video bằng WebGL — xem scripts/blender/plate.py. */
export interface PlateCommand extends ConfigFields {
  cmd: 'plate'
  out_dir: string
}

export interface SceneCommand {
  cmd: 'scene'
  engine?: 'eevee' | 'cycles'
  res?: [number, number]
  samples?: number
  reflector_strength?: number
}

export interface SampleCommand {
  cmd: 'sample'
  channels: Record<string, unknown>
  frames_list?: number[]
  frames?: number
}

/** Render cả dải frame theo keyframe — dùng cho phát lại (RAM preview) và render final. */
export interface AnimCommand extends ConfigFields {
  cmd: 'anim'
  out_dir: string
  channels: Record<string, unknown>
  fps?: number
  frames?: number
  /** Khoảng frame của lượt này, 1-based, bao gồm cả hai đầu. Mặc định là toàn dải. */
  from?: number
  to?: number
}

export interface StripCommand extends ConfigFields {
  cmd: 'strip'
  out_dir: string
  n?: number
}

export type WorkerCommand =
  | StillCommand
  | PlateCommand
  | SceneCommand
  | SampleCommand
  | StripCommand
  | AnimCommand
  | { cmd: 'ping' }
  | { cmd: 'meta' }
  | { cmd: 'quit' }

/**
 * Tách các dòng phản hồi ra khỏi log của Blender.
 *
 * Trả về cả phần dư vì stdout tới theo từng mẩu, không theo từng dòng — một phản hồi
 * JSON hoàn toàn có thể bị cắt đôi giữa hai lần `data`. Ghép sai chỗ này thì lỗi chỉ
 * hiện ra ngẫu nhiên khi ảnh nặng, rất khó tìm.
 */
export function extractReplies(buffer: string): { replies: WorkerReply[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const replies: WorkerReply[] = []

  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (!trimmed.startsWith(REPLY_PREFIX)) continue
    try {
      replies.push(JSON.parse(trimmed.slice(REPLY_PREFIX.length)) as WorkerReply)
    } catch {
      // Dòng có tiền tố mà không parse được nghĩa là giao thức đã hỏng, không phải
      // log thường. Báo thành lỗi thay vì bỏ qua.
      replies.push({
        ok: false,
        error: `phản hồi không phải JSON hợp lệ: ${trimmed.slice(0, 200)}`,
      })
    }
  }

  return { replies, rest }
}
