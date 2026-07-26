import { API_BASE } from './trpc'

/**
 * Kênh sự kiện từ server: worker chết, và tiến trình render final.
 *
 * Vì sao WebSocket chứ không polling: một job Cycles chạy tới 28 phút, lâu hơn mọi timeout
 * HTTP hợp lý, và polling mỗi giây suốt 28 phút vừa ồn vừa trễ.
 */
export interface ServerEvent {
  event: string
  payload: unknown
}

export function connectEvents(onEvent: (event: ServerEvent) => void): () => void {
  const url = `${API_BASE.replace(/^http/, 'ws')}/ws`
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const open = () => {
    socket = new WebSocket(url)
    socket.addEventListener('message', (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as ServerEvent)
      } catch {
        // Gói méo thì bỏ qua; giết cả kênh vì một gói lạ thì mất luôn tiến trình render.
      }
    })
    socket.addEventListener('close', () => {
      // Nối lại: dev server restart liên tục, mà mất kênh nghĩa là thanh tiến trình đứng
      // im trong khi Blender vẫn đang chạy.
      if (!closed) retry = setTimeout(open, 1000)
    })
  }

  open()

  return () => {
    closed = true
    if (retry) clearTimeout(retry)
    // React StrictMode chạy effect hai lần lúc dev (mount → cleanup → mount), nên lần
    // dọn đầu tiên gọi tới khi socket còn đang CONNECTING. `close()` lúc đó hợp lệ
    // nhưng in cảnh báo ồn ào trên console; đợi mở xong rồi đóng thì im lặng.
    if (socket?.readyState === WebSocket.CONNECTING) {
      socket.addEventListener('open', () => socket?.close())
    } else {
      socket?.close()
    }
  }
}
