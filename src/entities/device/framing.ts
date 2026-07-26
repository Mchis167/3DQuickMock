/**
 * Toán khớp khung hình — hàm THUẦN, không biết gì về React hay server.
 *
 * Vấn đề: `frame_fill` phía Blender đo theo chiều cao bound_box KHÔNG xoay. Nghiêng máy
 * đi thì bóng của nó trên khung hình cao lên (xoay quanh trục Z làm đường chéo dài hơn)
 * hoặc thấp xuống (gập về phía camera), nên cùng một `frame_fill` cho ra kích thước
 * hiện lên khác nhau. Nút "Fit to frame" phải bù đúng phần đó.
 *
 * Cả file là hình học thuần nên test được không cần Blender; nhưng con số cuối cùng vẫn
 * được đối chiếu với ảnh render thật trong `framing.integration.test.ts` — nếu chỉ tin
 * unit test thì một sai quy ước trục sẽ lọt qua toàn bộ.
 */

export interface FramingPose {
  spin_x: number
  spin_y: number
  spin_z: number
}

export interface FramingCamera {
  azimuth: number
  elevation: number
}

type Vec3 = readonly [number, number, number]

const RAD = Math.PI / 180

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len === 0 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Hướng "lên" của camera trong toạ độ thế giới.
 *
 * Rig dùng constraint TRACK_TO với `up_axis = UP_Y`, nghĩa là trục lên của camera nằm
 * trong mặt phẳng chứa hướng nhìn và trục Z thế giới. Vậy nó chính là phần của +Z
 * vuông góc với hướng nhìn.
 */
export function cameraUpVector(camera: FramingCamera): Vec3 {
  const az = camera.azimuth * RAD
  const el = camera.elevation * RAD
  // Vị trí camera theo rig quỹ đạo (khớp scene_lib.place_camera).
  const position: Vec3 = [
    Math.cos(el) * Math.sin(az),
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
  ]
  const forward = normalize([-position[0], -position[1], -position[2]])
  const worldUp: Vec3 = [0, 0, 1]
  const k = dot(worldUp, forward)
  const up: Vec3 = [
    worldUp[0] - k * forward[0],
    worldUp[1] - k * forward[1],
    worldUp[2] - k * forward[2],
  ]
  // Nhìn thẳng từ trên xuống thì +Z song song hướng nhìn và không còn trục lên xác
  // định. Schema đã chặn |elevation| > 89 nên chỉ là chốt an toàn.
  if (Math.hypot(up[0], up[1], up[2]) < 1e-9) return [0, 1, 0]
  return normalize(up)
}

/** Ba cột của ma trận xoay Euler XYZ (thứ tự của Blender: R = Rz · Ry · Rx). */
function rotationColumns(pose: FramingPose): [Vec3, Vec3, Vec3] {
  const [cx, sx] = [Math.cos(pose.spin_x * RAD), Math.sin(pose.spin_x * RAD)]
  const [cy, sy] = [Math.cos(pose.spin_y * RAD), Math.sin(pose.spin_y * RAD)]
  const [cz, sz] = [Math.cos(pose.spin_z * RAD), Math.sin(pose.spin_z * RAD)]
  return [
    [cy * cz, cy * sz, -sy],
    [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy],
    [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy],
  ]
}

/**
 * Chiều cao hiện lên khung hình sau khi xoay, chia cho chiều cao lúc chưa xoay.
 *
 * 1.0 = không đổi; 1.2 = cao hơn 20% nên phải giảm `frame_fill` đi 20% mới vừa khung.
 * Dùng hàm support của hộp chữ nhật: nửa-bề-rộng theo một hướng là tổng |nửa cạnh ·
 * hướng| của ba trục.
 */
export function projectedHeightRatio(
  dimsMm: { width: number; depth: number; height: number },
  pose: FramingPose,
  camera: FramingCamera,
): number {
  const up = cameraUpVector(camera)
  const half: Vec3 = [dimsMm.width / 2, dimsMm.depth / 2, dimsMm.height / 2]
  const columns = rotationColumns(pose)
  const extent =
    2 *
    (half[0] * Math.abs(dot(columns[0], up)) +
      half[1] * Math.abs(dot(columns[1], up)) +
      half[2] * Math.abs(dot(columns[2], up)))
  return extent / dimsMm.height
}

/**
 * `frame_fill` để thiết bị chiếm đúng `target` phần chiều cao khung hình.
 *
 * Kẹp vào (0, 1] vì schema chặn ở đó; đụng trần nghĩa là muốn to hơn khung thì không
 * còn cách nào ngoài giảm `target`.
 */
export function fitFrameFill(
  dimsMm: { width: number; depth: number; height: number },
  pose: FramingPose,
  camera: FramingCamera,
  target = 0.9,
): number {
  const ratio = projectedHeightRatio(dimsMm, pose, camera)
  const value = target / ratio
  return Math.min(1, Math.max(0.01, value))
}
