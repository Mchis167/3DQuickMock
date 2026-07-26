import process from 'node:process'

import { createServer } from './app'
import { BlenderNotFoundError, locateBlender } from './worker-bridge/locate-blender'

const PORT = Number(process.env['PORT'] ?? 5174)
const ROOT = process.cwd()

async function main() {
  try {
    console.log(`Blender: ${locateBlender()}`)
  } catch (error) {
    if (error instanceof BlenderNotFoundError) {
      // Báo rõ và thoát, thay vì chạy tiếp rồi thất bại ở yêu cầu đầu tiên với một
      // thông báo vô nghĩa.
      console.error(`\n${error.message}\n`)
      process.exit(1)
    }
    throw error
  }

  const server = createServer({ root: ROOT })
  const address = await server.listen(PORT)
  console.log(`3DQuickMock server: ${address}`)

  // Không có phần này thì Ctrl-C để lại một tiến trình Blender mồ côi ăn RAM tới lúc
  // reboot. `once` để nhấn Ctrl-C hai lần không chạy hai lần dọn dẹp.
  let shuttingDown = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`\n${signal} — đang dừng worker...`)
      void server.close().then(() => process.exit(0))
    })
  }
}

void main()
