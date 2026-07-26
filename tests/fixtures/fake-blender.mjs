/**
 * Blender giả cho test render-queue: in ra tiến trình kiểu Cycles rồi ghi một PNG.
 *
 * Tồn tại vì những tình huống cần kiểm — huỷ giữa lúc render, thoát mã khác 0, in log
 * rác — rất chậm và khó dựng lại bằng Blender thật.
 *
 *   node fake-blender.mjs --out <file.png> [--samples N] [--step-ms N] [--fail] [--hang]
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

const out = arg('--out', '/tmp/fake.png')
const samples = Number(arg('--samples', '8'))
const stepMs = Number(arg('--step-ms', '10'))
const shouldFail = argv.includes('--fail')
const shouldHang = argv.includes('--hang')

// Log rác giống Blender thật, để chắc chắn bộ đọc tiến trình không ăn phải dòng khác.
process.stdout.write('Blender 4.5.1 LTS (hash b0a72b245dcf)\nFra:1 Mem:63.64M\n')

let sample = 0
const tick = () => {
  sample += 1
  process.stdout.write(
    `Fra:1 Mem:120.00M (Peak 130.00M) | Time:00:0${sample}.00 | Remaining:00:01.00 | ` +
      `Scene, ViewLayer | Sample ${sample}/${samples}\n`,
  )
  if (sample < samples) {
    setTimeout(tick, stepMs)
    return
  }
  if (shouldHang) return // không bao giờ thoát: để test huỷ
  if (shouldFail) {
    process.stderr.write('### lỗi giả: config sai\n')
    process.exit(1)
  }
  // PNG 1×1 trong suốt, đủ để kiểm "file có ra không".
  writeFileSync(
    out,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAABzenr0AAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
      'base64',
    ),
  )
  process.exit(0)
}

setTimeout(tick, stepMs)
