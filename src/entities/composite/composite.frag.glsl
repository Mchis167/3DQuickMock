#version 300 es
// PHÉP GHÉP — nguồn sự thật DUY NHẤT của Pha 5.
//
// File này chạy y hệt ở preview (Chrome có cửa sổ) lẫn ở export (Chrome headless). Đó là lý
// do sự lệch preview↔export bằng 0 **do cấu trúc**, chứ không phải nhờ đo thấy hai bên gần
// nhau. Kế hoạch cũ định ghép lại lần nữa bằng ffmpeg ở server; ffmpeg không tra cứu UV đúng
// được (`remap` chỉ nearest và âm thầm ép float xuống 16-bit nguyên), và so hai bản qua hai bộ
// giải mã video khác nhau thì lệch 2.3-9.5/255 — lớn hơn mọi sai số đang tối ưu.
//
// KHÔNG được có file .glsl thứ hai chứa phép ghép. `tests/single-source.test.ts` cưỡng chế.
//
// ## Phép tính
//
//     lin = base + T × S           trong không gian TUYẾN TÍNH
//     ra  = agx(lin / alpha)       chia alpha TRƯỚC tone map
//
// `base` (máy khi màn hình tắt) và `T` (đóng góp của màn hình khi nó trắng) do Blender render
// một lần bằng light group của Cycles. Ánh sáng cộng tính — nhưng chỉ trong không gian tuyến
// tính, nên tone map phải là phép cuối cùng. Đo so với render Blender đầy đủ: lòng màn hình
// 1.70/255, vành mép 0.16, thân máy 0.41, silhouette 0.03. Mô hình cũ của Pha 5a (nội suy trên
// byte đã qua tone map): 60.8/255.

precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 outColour;

uniform sampler2D uBase;   // RGB16F, scene-linear, premultiplied
uniform sampler2D uT;      // RGB16F, scene-linear
uniform sampler2D uAlpha;  // R16F
uniform sampler2D uUv;     // RGB32F: (u, v, cờ hợp lệ)
uniform sampler2D uVideo;  // SRGB8_ALPHA8 — GPU tự giải sRGB nên mẫu lấy ra đã tuyến tính
uniform sampler3D uAgx;    // LUT AgX, trục mã hoá log2

// Màu trung bình TUYẾN TÍNH của frame video. Ánh sáng màn hình hắt ra thân máy phụ thuộc TOÀN
// BỘ ảnh chứ không phải một texel, nên nó được xấp xỉ hạng 1 bằng màu trung bình. Đây là số
// hạng xấp xỉ duy nhất trong cả phép ghép; bỏ nó đi thì thân máy lệch 2.9 -> 7.4/255.
uniform vec3 uMeanColour;

/**
 * Khớp tỉ lệ nội dung màn hình — ba chế độ fill / fit / stretch.
 *
 * Ảnh tĩnh được khớp ở server bằng cách cắt/đệm PIXEL trước khi vào Blender. Video thì lấy mẫu
 * thẳng ở đây, nên phép khớp phải là biến đổi TOẠ ĐỘ: `st = (uv - 0.5) * uContentScale + 0.5`.
 * Không có nó thì mọi video đều bị kéo giãn — màn hình 19.5:9 mà nội dung 16:9 thì méo rất rõ.
 *
 * `uLetterbox = 1` (chế độ fit) thì phần nằm ngoài [0,1] là dải đen, không phải mép bị kéo.
 */
uniform vec2 uContentScale;
uniform float uLetterbox;

uniform float uAgxSize;      // cạnh LUT (97)
uniform float uAgxLogMin;    // -12.0
uniform float uAgxLogRange;  // 22.0

/**
 * Áp AgX bằng LUT 3D nướng từ chính Blender (`scripts/blender/bake_agx_lut.py`).
 *
 * Dùng nội suy tam tuyến tính của PHẦN CỨNG, không tự viết nội suy tứ diện: bản tứ diện tự
 * viết đo ra TỆ HƠN (87.35% pixel trong 1/255, so với 99.02% của tam tuyến tính) — cài đặt
 * sai chứ không phải lý thuyết sai. Bù lại bằng lưới dày 97³: tb 0.063/255, 99.54% trong 1/255.
 *
 * Nửa texel ở hai đầu là bắt buộc: `texture()` lấy mẫu ở TÂM texel, nên toạ độ 0 và 1 rơi ra
 * ngoài nút đầu/cuối và bị kẹp — vùng tối sâu và vùng cháy sáng sẽ lệch mà không ai để ý.
 */
vec3 agx(vec3 linear) {
  vec3 t = clamp((log2(max(linear, vec3(1e-12))) - uAgxLogMin) / uAgxLogRange, 0.0, 1.0);
  vec3 coord = (t * (uAgxSize - 1.0) + 0.5) / uAgxSize;
  return texture(uAgx, coord).rgb;
}

void main() {
  vec3 uv = texture(uUv, vUv).xyz;

  // Đạo hàm lấy từ chính toạ độ đã tra: `push_uv` ở phía Blender đã nới UV ra ngoài mép mặt
  // nạ nên đạo hàm LIÊN TỤC qua mép. Không nới thì UV nhảy vọt ở mép, đạo hàm hoá lớn, GPU
  // chọn mip nhỏ nhất và cho ra một vành mờ tịt quanh màn hình.
  vec2 content = (uv.xy - 0.5) * uContentScale + 0.5;
  // Đạo hàm lấy trên toạ độ ĐÃ khớp: lấy trên toạ độ gốc thì mức mip sai theo đúng tỉ lệ
  // phóng, và vùng bị thu nhỏ sẽ hiện răng cưa.
  vec2 ddx = dFdx(content);
  vec2 ddy = dFdy(content);
  vec3 sampled = textureGrad(uVideo, clamp(content, 0.0, 1.0), ddx, ddy).rgb;
  // Dải đen của chế độ fit: kẹp toạ độ rồi mới tô đen, chứ không dựa vào WRAP — kẹp cho mép
  // sạch, còn CLAMP_TO_EDGE một mình sẽ KÉO DÀI hàng pixel biên ra thành vệt.
  bool outside = any(lessThan(content, vec2(0.0))) || any(greaterThan(content, vec2(1.0)));
  if (uLetterbox > 0.5 && outside) sampled = vec3(0.0);
  vec3 screen = uv.z > 0.5 ? sampled : uMeanColour;

  vec3 base = texture(uBase, vUv).rgb;
  vec3 transmission = texture(uT, vUv).rgb;
  float alpha = texture(uAlpha, vUv).r;

  vec3 linear = base + transmission * screen;

  // Chia alpha TRƯỚC tone map. Buffer của Blender là premultiplied; tone map một giá trị đã
  // nhân alpha là tone map sai độ sáng, và sai nặng nhất đúng ở vành silhouette nơi alpha nhỏ.
  vec3 display = agx(linear / max(alpha, 1e-6));

  // Trả premultiplied cho canvas: context dựng với `premultipliedAlpha: true`, và hai bên
  // không khớp quy ước thì mép mockup có viền tối mà shader không sai dòng nào.
  outColour = vec4(display * alpha, alpha);
}
