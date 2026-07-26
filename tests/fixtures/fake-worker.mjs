/**
 * Worker giả: nói đúng giao thức của scripts/blender/worker.py nhưng không cần Blender.
 *
 * Cho phép test bridge trong mili-giây thay vì mỗi lần dựng scene tốn ~1.4 giây, và
 * quan trọng hơn — cho phép dựng những tình huống Blender thật rất khó tái tạo: chết
 * giữa chừng, trả lời chậm, in log rác lẫn vào stdout.
 *
 *   node fake-worker.mjs [--noisy] [--delay 10] [--die-after N] [--chunked]
 */

import readline from 'node:readline'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback
}

const noisy = flag('--noisy')
const chunked = flag('--chunked')
const delay = value('--delay', 0)
const dieAfter = value('--die-after', Infinity)

let handled = 0

function write(text) {
  if (!chunked) {
    process.stdout.write(text)
    return
  }
  // Cắt vụn để ép bridge phải ghép lại — một phản hồi JSON hoàn toàn có thể bị chia
  // đôi giữa hai lần `data`.
  for (let i = 0; i < text.length; i += 7) {
    process.stdout.write(text.slice(i, i + 7))
  }
}

function reply(obj) {
  if (noisy) process.stdout.write('Fra:1 Mem:12.34M | Rendering 3 / 64 samples\n')
  write('@@' + JSON.stringify(obj) + '\n')
}

reply({ ok: true, ready: true, pid: process.pid })

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  const text = line.trim()
  if (!text) return

  let cmd
  try {
    cmd = JSON.parse(text)
  } catch (e) {
    reply({ ok: false, error: `JSON không hợp lệ: ${e.message}` })
    return
  }

  if (cmd.cmd === 'quit') {
    reply({ ok: true, bye: true })
    process.exit(0)
  }

  handled += 1
  if (handled > dieAfter) process.exit(3)

  if (delay > 0) await new Promise((r) => setTimeout(r, delay))

  switch (cmd.cmd) {
    case 'ping':
      reply({ ok: true, blender: 'giả 4.5.1' })
      break
    case 'scene':
      reply({ ok: true, engine: cmd.engine ?? 'eevee' })
      break
    case 'still':
      reply({ ok: true, out: cmd.out, ms: 1, echo: cmd })
      break
    case 'meta':
      reply({ ok: true, channels: ['camera.azimuth'], easings: ['AUTO'] })
      break
    case 'boom':
      reply({ ok: false, error: 'lệnh cố tình hỏng', trace: 'Traceback giả' })
      break
    default:
      reply({ ok: false, error: `lệnh lạ: ${cmd.cmd}` })
  }
})
