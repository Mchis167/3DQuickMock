"""Kiểm tiêu chí Pha 3: đổi môi trường KHÔNG làm nhảy độ phơi sáng.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/check_env_exposure.py

Đọc `strength` đã hiệu chuẩn trong assets/hdri/presets.json, render từng preset rồi đo
độ sáng trung bình. Nếu hiệu chuẩn còn đúng thì độ lệch giữa các preset phải nhỏ.

Đo ở góc MẶT LƯNG. Đây là bẫy đã sập ba lần (PRD §7): ở góc mặt trước, màn hình phát
sáng chiếm phần lớn khung và độ sáng của nó KHÔNG phụ thuộc HDRI, nên nó neo phép đo lại
và cho kết quả trông hoàn hảo trong khi vật liệu thật vẫn chênh rõ bằng mắt.
"""

import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene_lib  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "out/env_exposure")
# Ngưỡng: hiệu chuẩn nhắm tới sai số vài phần trăm. 15% là chỗ mà mắt bắt đầu thấy
# "đổi môi trường thì sáng hẳn lên", nên vượt qua đó coi như tiêu chí Pha 3 thất bại.
TOLERANCE_PCT = 15.0


def mean_luminance(path):
    """Độ sáng trung bình của vùng CÓ THIẾT BỊ, bỏ nền trong suốt.

    Phải là ĐÚNG phép đo mà scripts/calibrate_env.py dùng, nếu không con số không nói
    được gì về việc hiệu chuẩn còn đúng hay không: trung bình (r+g+b)/3 trên BYTE của
    PNG, alpha > 250.

    `img.pixels` trả về giá trị đã linear hoá, nên phải bọc lại sRGB mới ra byte. Lần đầu
    tôi bỏ bước này và đo trên miền linear: biên độ ra 24% và tôi đã suýt kết luận hiệu
    chuẩn hỏng, trong khi thật ra chỉ là đo sai KHÔNG GIAN màu.
    """
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h * w, 4)
    bpy.data.images.remove(img)
    solid = px[px[:, 3] > 250 / 255]
    rgb = np.clip(solid[:, :3], 0.0, 1.0)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    return float((srgb.mean(axis=1) * 255.0).mean()), len(solid)


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, "assets/hdri/presets.json")) as f:
        library = json.load(f)

    # Camera, ảnh màn hình và độ phân giải phải khớp calibrate_env.py — đổi bất kỳ cái
    # nào thì đang đo một thứ khác, không phải kiểm lại hiệu chuẩn.
    s = scene_lib.build_once(engine="eevee", res=(480, 640), samples=16)
    scene_lib.set_screen_image(
        s,
        os.path.join(ROOT, "assets/raw/iphone-17-pro-max/gltf/textures/17ProMax_Screen_baseColor.jpeg"),
    )
    scene_lib.place_camera(s, azimuth_deg=215, elevation_deg=12, frame_fill=0.78)

    rows = []
    for preset in library["presets"]:
        scene_lib.set_hdri(s, os.path.join(ROOT, preset["hdri"]))
        scene_lib.set_world(s, strength=preset["strength"], rotation=preset["rotation"])
        path = os.path.join(OUT, f"{preset['id']}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        lum, n = mean_luminance(path)
        rows.append((preset["id"], preset["strength"], lum, n))

    values = np.array([r[2] for r in rows])
    mean = values.mean()
    spread = (values.max() - values.min()) / mean * 100.0

    print("\n### độ phơi sáng ở góc mặt lưng (alpha > 0.98)")
    print(f"{'preset':<44}{'strength':>10}{'luminance':>12}{'lệch %':>10}")
    for pid, strength, lum, _ in rows:
        print(f"{pid:<44}{strength:>10.3f}{lum:>12.2f}{(lum - mean) / mean * 100:>9.1f}%")
    print(f"\ntrung bình {mean:.2f}, biên độ {spread:.1f}% (ngưỡng {TOLERANCE_PCT}%)")
    print("KẾT LUẬN:", "ĐẠT" if spread <= TOLERANCE_PCT else "KHÔNG ĐẠT")
    return 0 if spread <= TOLERANCE_PCT else 1


sys.exit(main())
