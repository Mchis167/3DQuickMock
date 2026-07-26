/**
 * Sinh ảnh kích thích cho phép kiểm fidelity của Pha 5 -> assets/test/stimulus.png
 *
 *   node scripts/make-stimulus.mjs
 *
 * Vì sao kích thích phải như thế này: chọn công thức ghép ở Pha 5a bằng ảnh đen-trắng đã cho
 * kết luận SAI. Đen và trắng là hai đầu mút, nơi mọi phép nội suy đúng theo định nghĩa. Bộ này
 * bắt buộc có ba mức xám GIỮA dải và ba màu bão hoà, cộng một gradient hai chiều phủ liên tục.
 * Xem PRD §7, "đo sai kích thích".
 *
 * Vì sao sinh ở Node chứ không trong Blender: `img.pixels = ...` rồi `img.save()` ghi ra file
 * ĐEN mà không báo lỗi (đã đo: mean 0.0 trên toàn ảnh).
 *
 * 8-bit là đủ: phép đo đọc lại chính giá trị Blender thấy làm chuẩn, nên lượng tử hoá không
 * lọt vào sai số. KHÔNG dùng `raw: { depth: 'ushort' }` — bản sharp hiện tại bỏ qua nó và đọc
 * buffer 16-bit như 8-bit, ảnh ra rác mà vẫn ghi thành công; dấu hiệu là R == B ở mọi pixel.
 */
import sharp from 'sharp'

const WIDTH = 128
const HEIGHT = 256
const BANDS = [
  [64, 64, 64], // ba mức xám giữa dải
  [128, 128, 128],
  [191, 191, 191],
  [230, 38, 8], // ba màu bão hoà
  [13, 179, 51],
  [26, 51, 217],
]

const pixels = Buffer.alloc(WIDTH * HEIGHT * 3)
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const band = BANDS[Math.min(BANDS.length - 1, Math.floor((y * BANDS.length) / HEIGHT))]
    const ramp = Math.round((x / (WIDTH / 2 - 1)) * (y / (HEIGHT - 1)) * 255)
    const colour = x < WIDTH / 2 ? band : [ramp, ramp, ramp]
    for (let k = 0; k < 3; k++) pixels[(y * WIDTH + x) * 3 + k] = colour[k]
  }
}

const out = 'assets/test/stimulus.png'
await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
  .png()
  .toFile(out)

// Script sinh dữ liệu cũng phải có rào chắn của nó: đọc lại và đối chiếu ba ô đã biết.
const back = await sharp(out).raw().toBuffer()
const at = (x, y) => [0, 1, 2].map((k) => back[(y * WIDTH + x) * 3 + k])
for (const [x, y, want] of [
  [10, 20, BANDS[0]],
  [10, 105, BANDS[2]],
  [10, 233, BANDS[5]],
]) {
  const got = at(x, y)
  if (got.join() !== want.join()) throw new Error(`(${x},${y}): ${got} khác ${want}`)
}
console.log(`${out} ${WIDTH}×${HEIGHT} — ba ô mẫu khớp`)
