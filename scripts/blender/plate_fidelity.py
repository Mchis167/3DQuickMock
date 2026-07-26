"""Đo plate ghép ra có bằng render Blender đầy đủ không — phép kiểm quyết định của Pha 5.

    Blender -b --factory-startup -P scripts/blender/plate_fidelity.py -- <thư_mục_ra> [az] [el]

In ra một dòng JSON có tiền tố `@@` (cùng quy ước với worker.py) chứa sai số tách theo vùng.
`src/server/plate-fidelity.integration.test.ts` chạy script này và kiểm ngưỡng.

## Đo cái gì, và vì sao tách vùng

Câu hỏi là: `base + T × S(u,v)` có bằng render Blender với đúng ảnh `S` trên màn hình không.
Một con số trung bình trên toàn ảnh KHÔNG trả lời được — vành 2px quanh mép màn hình từng
gánh 99.2% tổng sai số mà vẫn bị pha loãng thành một con số trông chấp nhận được. Đây là lần
"đo sai vùng" thứ năm của dự án (PRD §7), nên bốn vùng dưới đây là bắt buộc:

    lòng màn hình       phần chắc chắn nhìn thẳng vào màn hình — nơi mô hình phải gần như đúng
    vành mép màn hình   nơi mặt nạ nhị phân gặp ảnh khử răng cưa; `push_uv` chữa chỗ này
    thân máy            nơi ánh sáng màn hình hắt ra — số hạng xấp xỉ duy nhất
    silhouette          mép ngoài có alpha lẻ; kiểm phép chia alpha trước tone map

## Điều kiện đo

`denoise = False`: OpenImageDenoise là phi tuyến nên nó phá cộng tính. Tắt đi thì đo được sai
số MÔ HÌNH thật, không lẫn phi tuyến của bộ khử nhiễu.

Sai số còn lại tập trung ở chỗ ảnh có mép sắc: Blender lấy 128 mẫu mỗi pixel và lọc texture,
còn phép ghép chỉ lấy một mẫu song tuyến tính. Đây là sai số LẤY MẪU, và nó giống hệt nhau ở
preview lẫn export — nên nó không phải "preview nói dối", chỉ là khoảng cách tới Blender.
"""

import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plate  # noqa: E402
import scene_lib  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(ARGS[0])
AZIMUTH = float(ARGS[1]) if len(ARGS) > 1 else 20.0
ELEVATION = float(ARGS[2]) if len(ARGS) > 2 else 12.0

RES = (240, 320)
SAMPLES = 128
STIMULUS = os.path.abspath("assets/test/stimulus.png")
HDRI = os.path.abspath("assets/hdri/studio_small_03.hdr")


def sample_bilinear(texture, u, v):
    """Lấy mẫu song tuyến tính — đúng thứ `texture()` của GPU làm ở mức mip 0."""
    height, width = texture.shape[:2]
    x = np.clip(u * width - 0.5, 0, width - 1)
    y = np.clip((1 - v) * height - 0.5, 0, height - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    tx = (x - x0)[..., None]
    ty = (y - y0)[..., None]
    top = texture[y0, x0] * (1 - tx) + texture[y0, x1] * tx
    bottom = texture[y1, x0] * (1 - tx) + texture[y1, x1] * tx
    return top * (1 - ty) + bottom * ty


def erode(mask, iterations):
    out = mask.copy()
    for _ in range(iterations):
        shrunk = np.zeros_like(out)
        shrunk[1:-1, 1:-1] = (
            out[1:-1, 1:-1] & out[:-2, 1:-1] & out[2:, 1:-1] & out[1:-1, :-2] & out[1:-1, 2:]
        )
        out = shrunk
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    s = scene_lib.build_once(engine="cycles", res=RES, samples=SAMPLES)
    scene_lib.set_hdri(s, HDRI)
    bpy.context.scene.cycles.use_denoising = False
    scene_lib.place_camera(s, AZIMUTH, ELEVATION, 0.72)

    # MỘT datablock duy nhất cho cả việc đọc pixel lẫn việc làm texture màn hình. Nạp hai lần
    # thì Blender tạo thêm "stimulus.png.001", và đặt colorspace lên cái sai là đường im lặng:
    # texture vẫn là sRGB trong khi phép đo tưởng nó là Non-Color.
    scene_lib.set_screen_image(s, STIMULUS)
    image = s["screen_tex"].image
    image.colorspace_settings.name = "Non-Color"  # giá trị lưu = giá trị tuyến tính
    tex_w, tex_h = image.size
    stimulus = np.array(image.pixels[:], dtype=np.float32).reshape(tex_h, tex_w, 4)[::-1, :, :3]

    result = plate.render_plate(s, os.path.join(OUT, "plate"), denoise=False)
    width, height = result["res"]

    def read(name, channels, dtype):
        path = os.path.join(OUT, "plate", name)
        return np.fromfile(path, dtype=dtype).reshape(height, width, channels).astype(np.float32)

    base = read("base.bin", 3, np.float16)
    transmission = read("t.bin", 3, np.float16)
    alpha = read("alpha.bin", 1, np.float16)
    uv = read("uv.bin", 3, np.float32)

    # Tham chiếu: render ĐẦY ĐỦ với đúng ảnh đó trên màn hình, xuất EXR tuyến tính.
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = os.path.join(OUT, "reference.exr")
    bpy.ops.render.render(write_still=True)
    reference = plate._load_pixels(os.path.join(OUT, "reference.exr"))[:, :, :3]

    valid = uv[:, :, 2] > 0.5
    mean_colour = stimulus.reshape(-1, 3).mean(axis=0)
    screen = sample_bilinear(stimulus, uv[:, :, 0], uv[:, :, 1])
    # Ngoài vùng có UV thì dùng màu trung bình: ánh sáng hắt phụ thuộc TOÀN BỘ ảnh màn hình
    # chứ không phải một texel, nên xấp xỉ hạng 1 bằng màu trung bình là đúng bản chất.
    composed = base + transmission * np.where(valid[..., None], screen, mean_colour)

    # Quy về thang hiển thị để con số có nghĩa với mắt người. Chia alpha TRƯỚC: buffer là
    # premultiplied, bỏ bước này thì riêng silhouette lệch gấp ~50 lần.
    def display(x):
        return np.clip(x / np.maximum(alpha, 1e-6), 0, None) ** (1 / 2.2) * 255

    delta = np.abs(display(composed) - display(reference))

    core = erode(valid, 3)
    solid = alpha[:, :, 0] > 0.999
    regions = {
        "screen_core": core,
        "screen_edge": valid & ~core,
        "body": solid & ~valid,
        "silhouette": (alpha[:, :, 0] > 0.01) & ~solid,
    }
    stats = {}
    for name, region in regions.items():
        if not region.any():
            stats[name] = {"px": 0}
            continue
        errors = delta[region]
        stats[name] = {
            "px": int(region.sum()),
            "mean": round(float(errors.mean()), 4),
            "p99": round(float(np.percentile(errors, 99)), 3),
            "max": round(float(errors.max()), 3),
        }

    # Đối chứng: mô hình của Pha 5a (nội suy trong không gian hiển thị, trên byte đã qua tone
    # map). Giữ lại trong phép đo để con số "tốt" của bản mới luôn có cái để so.
    def encode(x):
        return np.clip(np.clip(x / np.maximum(alpha, 1e-6), 0, None) ** (1 / 2.2), 0, 1) * 255

    dark, bright = encode(base), encode(base + transmission)
    legacy = dark + (bright - dark) * np.where(valid[..., None], screen, mean_colour)
    stats["legacy_srgb_lerp_screen_core"] = {
        "px": int(core.sum()),
        "mean": round(float(np.abs(legacy - display(reference))[core].mean()), 4),
    }

    # Rào chắn đặt lên chính BỘ KÍCH THÍCH, không phải lên kết quả: một bộ chỉ có 0 và 255 sẽ
    # cho mọi mô hình điểm gần như nhau, và đó đúng là cách 5a chọn nhầm.
    levels = np.unique(np.round(stimulus * 255).astype(int))
    mid = [v for v in levels if 32 <= v <= 223]
    saturated = int((stimulus.max(axis=2) - stimulus.min(axis=2) > 0.2).sum())
    stats["stimulus"] = {
        "levels": int(levels.size),
        "mid_levels": len(mid),
        "saturated_px": saturated,
    }
    print("@@" + json.dumps({"ok": True, "azimuth": AZIMUTH, "elevation": ELEVATION, **stats}))


main()
