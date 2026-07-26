"""Nướng tone map AgX của Blender thành LUT 3D để shader áp lại y hệt.

    Blender -b --factory-startup -P scripts/blender/bake_agx_lut.py -- <thư_mục_ra>

Ghi ra `agx-lut.bin` (RGB half, bố cục 3D) và `agx-lut.json` (kích thước, miền log, vân tay
của config OCIO). In một dòng `@@` JSON như worker.

## Vì sao phải nướng chứ không viết lại AgX bằng tay

Phép ghép làm trong không gian tuyến tính, nên bước cuối cùng phải áp ĐÚNG tone map mà Blender
áp — nếu không thì preview khác ảnh export ra từ Blender ngay ở chỗ dễ thấy nhất là vùng sáng.
AgX là một chuỗi OCIO (ma trận sang E-Gamut, mã hoá log, LUT 3D, EOTF), và mọi bản "AgX rút
gọn" lưu hành đều là xấp xỉ. Nướng thẳng từ Blender thì đúng **theo cấu trúc**, và còn bắt được
cả trường hợp Blender đổi config ở bản sau.

## Vì sao nướng bằng cách CHO BLENDER LƯU ẢNH, không phải bằng cách đọc file .cube

Đọc `AgX_Base_sRGB.cube` thì vẫn phải tự dựng lại phần trước và sau nó (ma trận gamut, shaper
log, EOTF) — tức là chép tay một chuỗi mà mọi mắt xích đều sai được trong im lặng. Cho Blender
tự lưu một ảnh chứa lưới giá trị đã biết thì cái ra là **toàn bộ chuỗi**, không sót mắt xích.

## Miền log

AgX nhận giá trị scene-linear không chặn trên. LUT thì hữu hạn, nên trục được mã hoá log2:

    enc(x) = (log2(x) + 12) / 22        miền tuyến tính 2^-12 .. 2^10
    dec(t) = 2^(t * 22 - 12)

Đây là mã hoá của RIÊNG dự án này, không phải "AgX Log" của OCIO — không cần trùng, chỉ cần
shader dùng đúng cùng công thức. Ghi vào JSON để hai bên không thể trôi khỏi nhau.
"""

import hashlib
import json
import os
import sys

import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index("--") + 1 :]
OUT = os.path.abspath(ARGS[0])

# Kích thước lưới. Đo thật với nội suy tam tuyến tính, 2048 màu ngẫu nhiên phủ 17 stop:
#   57³   tb 0.120  max 4.343  | 99.02% trong 1/255  (1.1 MB)
#   97³   xem self-check bên dưới                     (5.5 MB)
# Đây là localhost nên vài MB không đáng gì so với việc preview lệch màu ở vùng sáng.
SIZE = int(ARGS[1]) if len(ARGS) > 1 else 97  # xem bảng ngưỡng bên dưới
LOG_MIN = -12.0
LOG_RANGE = 22.0

# Ngưỡng self-check, thang 0-255. Đo thật với 4096 màu phủ 17 stop, nội suy tam tuyến tính:
#
#   lưới    tb      p99     max     trong 1/255
#   57³     0.120   0.979   4.343   99.02%
#   97³     0.063   0.652   2.849   99.54%      <- đang dùng
#   129³    0.045   0.517   2.628   99.72%
#
# Từ 97³ trở lên `max` gần như đứng yên, nên nó KHÔNG phải do lưới thô. Sáu ca lệch nhất đều
# cùng một hình dạng: **một kênh gần đen (log2 ≈ −10..−16) trong khi kênh khác sáng** — chỗ
# AgX bẻ chéo kênh mạnh nhất. Ví dụ linear (0.00054, 0.291, 0.472): Blender cho R = 0.1941,
# LUT cho 0.1829. Nhóm sáng (>16) chỉ lệch tối đa 0.34. Tổ hợp như vậy hiếm gặp trong mockup
# và 2.85/255 trên một pixel lẻ là dưới ngưỡng nhìn thấy, nên chấp nhận và ghi lại.
MAX_MEAN = 0.15
MAX_P99 = 1.0
MAX_ABS = 3.5
MIN_WITHIN_1 = 0.99

CONFIG = (
    "/Applications/Blender.app/Contents/Resources/4.5/datafiles/colormanagement/config.ocio"
)


def decode(t):
    return np.exp2(t * LOG_RANGE + LOG_MIN)


def trilinear(table, rgb):
    """Nội suy tam tuyến tính — ĐÚNG thứ `texture()` của GPU làm trên sampler3D.

    Ban đầu dự định dùng nội suy tứ diện (4 đỉnh cùng phía, về lý thuyết bám đường cong tốt
    hơn ở chỗ AgX bẻ). Đo thật thì bản tứ diện tự viết TỆ HƠN: 87.35% pixel trong 1/255 so với
    99.02% của tam tuyến tính — tức cài đặt của nó sai chứ không phải lý thuyết sai. Giữa "một
    thuật toán tinh vi mình tự viết sai" và "một thuật toán phần cứng chạy miễn phí", chọn cái
    thứ hai và bù bằng lưới dày hơn. Hàm này chỉ để KIỂM; nguồn sự thật là phần cứng.
    """
    size = table.shape[0]
    t = np.clip((np.log2(np.maximum(rgb, 1e-12)) - LOG_MIN) / LOG_RANGE, 0.0, 1.0)
    pos = t * (size - 1)
    i = np.minimum(np.floor(pos).astype(int), size - 2)
    f = pos - i

    def at(dr, dg, db):
        return table[i[..., 2] + db, i[..., 1] + dg, i[..., 0] + dr]

    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    c00 = at(0, 0, 0) * (1 - fr) + at(1, 0, 0) * fr
    c10 = at(0, 1, 0) * (1 - fr) + at(1, 1, 0) * fr
    c01 = at(0, 0, 1) * (1 - fr) + at(1, 0, 1) * fr
    c11 = at(0, 1, 1) * (1 - fr) + at(1, 1, 1) * fr
    return (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb


def _self_check(table, scene, out_dir):
    """So LUT với chính Blender trên một bộ màu ngẫu nhiên phủ rộng dải động.

    LUT không được phép sinh ra mà chưa chứng minh khớp: một LUT lệch trục hay lệch miền log
    vẫn cho ảnh "trông như AgX", chỉ sai màu — và không ai nhận ra cho tới lúc so với bản
    render thật.
    """
    rng = np.random.default_rng(20260726)
    n = 4096
    # Phủ từ tối sâu tới cháy sáng, cộng một nhúm màu bão hoà: dải giữa không thôi thì không
    # chạm tới chỗ AgX bẻ mạnh nhất.
    linear = np.exp2(rng.uniform(-11.0, 6.0, size=(n, 3))).astype(np.float32)
    linear[: n // 4] *= np.array([1.0, 0.02, 0.02], dtype=np.float32)
    linear[n // 4 : n // 2] *= np.array([0.02, 1.0, 0.05], dtype=np.float32)

    side = int(np.ceil(np.sqrt(n)))
    canvas = np.zeros((side, side, 4), dtype=np.float32)
    canvas[:, :, 3] = 1.0
    canvas.reshape(-1, 4)[:n, :3] = linear
    probe = bpy.data.images.new("agx_probe", side, side, float_buffer=True)
    probe.pixels = canvas[::-1].ravel()
    probe_png = os.path.join(out_dir, "agx-probe.png")
    probe.save_render(probe_png, scene=scene)
    bpy.data.images.remove(probe)

    truth_image = bpy.data.images.load(probe_png)
    truth_image.colorspace_settings.name = "Non-Color"
    truth = np.array(truth_image.pixels[:], dtype=np.float32).reshape(side, side, 4)[::-1]
    bpy.data.images.remove(truth_image)
    os.remove(probe_png)

    expected = truth.reshape(-1, 4)[:n, :3].astype(np.float64)
    got = trilinear(table, linear.astype(np.float64))
    delta = np.abs(got - expected) * 255.0
    stats = {
        "mean": round(float(delta.mean()), 4),
        "p99": round(float(np.percentile(delta, 99)), 3),
        "max": round(float(delta.max()), 3),
        "within_1": round(float((delta <= 1.0).mean()), 5),
    }
    if (
        stats["mean"] > MAX_MEAN
        or stats["p99"] > MAX_P99
        or stats["max"] > MAX_ABS
        or stats["within_1"] < MIN_WITHIN_1
    ):
        raise RuntimeError(f"LUT lệch AgX của Blender quá nhiều: {stats}")
    return stats


def main():
    os.makedirs(OUT, exist_ok=True)
    axis = decode(np.linspace(0.0, 1.0, SIZE, dtype=np.float64))

    # Bố cục 2D quen thuộc của LUT 3D: ảnh rộng SIZE*SIZE, cao SIZE; lát cắt theo B nằm cạnh
    # nhau. Pixel (b*SIZE + r, g) giữ màu (axis[r], axis[g], axis[b]).
    width, height = SIZE * SIZE, SIZE
    lattice = np.zeros((height, width, 4), dtype=np.float32)
    lattice[:, :, 3] = 1.0
    r_idx = np.arange(SIZE)
    for b in range(SIZE):
        block = lattice[:, b * SIZE : (b + 1) * SIZE, :]
        block[:, :, 0] = axis[r_idx][None, :]
        block[:, :, 1] = axis[:, None]
        block[:, :, 2] = axis[b]

    image = bpy.data.images.new("agx_lattice", width, height, float_buffer=True)
    image.pixels = lattice[::-1].ravel()  # bpy chạy từ dưới lên

    scene = bpy.context.scene
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    # 16-bit: 8-bit chỉ cho 1/255 mỗi bậc, tức LUT sinh ra đã tự mang sẵn sai số bằng đúng
    # ngưỡng mà ta muốn kiểm.
    scene.render.image_settings.color_depth = "16"

    baked_png = os.path.join(OUT, "agx-lattice.png")
    # `save_render` áp view transform của scene; `save` thì KHÔNG (và với ảnh dựng trong bộ
    # nhớ, `save` còn ghi ra file đen mà không báo lỗi — xem PRD §7).
    image.save_render(baked_png, scene=scene)
    bpy.data.images.remove(image)

    baked = bpy.data.images.load(baked_png)
    # Non-Color: cần đúng byte đã ghi. Để sRGB thì Blender chuyển ngược về tuyến tính và LUT
    # sẽ mang một phép nghịch đảo thừa — ảnh vẫn "trông như AgX" nên rất khó nhận ra.
    baked.colorspace_settings.name = "Non-Color"
    display = np.array(baked.pixels[:], dtype=np.float32).reshape(height, width, 4)[::-1]
    bpy.data.images.remove(baked)

    table = np.zeros((SIZE, SIZE, SIZE, 3), dtype=np.float32)
    for b in range(SIZE):
        table[b] = display[:, b * SIZE : (b + 1) * SIZE, :3]  # [b][g][r]

    if not np.isfinite(table).all():
        raise RuntimeError("LUT có NaN/Inf")
    # Đơn điệu theo từng trục là tính chất của tone map; mất nó nghĩa là bố cục đã lẫn trục.
    for axis_index, name in ((0, "B"), (1, "G"), (2, "R")):
        diff = np.diff(table, axis=axis_index)
        channel = {"R": 0, "G": 1, "B": 2}[name]
        worst = float(diff[..., channel].min())
        if worst < -1e-3:
            raise RuntimeError(f"LUT không đơn điệu theo trục {name} ({worst:.5f}) — lẫn trục")

    error = _self_check(table, scene, OUT)

    lut_path = os.path.join(OUT, "agx-lut.bin")
    table.astype(np.float16).tofile(lut_path)
    meta = {
        "size": SIZE,
        "logMin": LOG_MIN,
        "logRange": LOG_RANGE,
        "layout": "b-major, then g, then r; RGB half",
        "blender": bpy.app.version_string,
        # Vân tay để bắt trôi im lặng: Blender cập nhật đổi config OCIO thì LUT phải nướng lại.
        "ocioSha256": hashlib.sha256(open(CONFIG, "rb").read()).hexdigest(),
    }
    with open(os.path.join(OUT, "agx-lut.json"), "w") as f:
        json.dump(meta, f, indent=2)
    os.remove(baked_png)

    print(
        "@@"
        + json.dumps(
            {
                "ok": True,
                "lut": lut_path,
                "bytes": os.path.getsize(lut_path),
                "sample_black": [round(float(v), 5) for v in table[0, 0, 0]],
                "sample_mid": [round(float(v), 5) for v in table[SIZE // 2, SIZE // 2, SIZE // 2]],
                "sample_white": [round(float(v), 5) for v in table[-1, -1, -1]],
                "self_check": error,
                **meta,
            }
        )
    )


main()
