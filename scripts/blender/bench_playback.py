"""Đo chi phí render dải frame cho PHÁT LẠI, theo bốn cách.

    Blender -b --factory-startup -P scripts/blender/bench_playback.py

Câu hỏi cần trả lời bằng số, không bằng phỏng đoán: 150 frame ở 235 ms/frame là 36 giây
chờ trước khi được xem chuyển động. Cách nào rẻ hơn, và rẻ hơn bao nhiêu lần?

Đo trên CÙNG một scene sống, cùng một animation, chỉ đổi cách render. In ra ms/frame để
so trực tiếp với con số 235 ms/frame của preview hiện tại (EEVEE 480×640/16spp).
"""

import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import scene_lib  # noqa: E402

OUT = "/tmp/bench_playback"
FRAMES = 24

CHANNELS = {
    "device.spin_z": {
        "keyframes": [
            {"frame": 1, "value": 0.0, "interpolation": "LINEAR", "easing": "AUTO"},
            {"frame": FRAMES, "value": 180.0, "interpolation": "LINEAR", "easing": "AUTO"},
        ],
        "extrapolation": "CONSTANT",
        "modifiers": [],
    }
}


def bench(label, s, res, samples, opengl=False):
    """Render FRAMES frame và trả về ms/frame, cộng số ảnh KHÁC nhau thật sự."""
    scene_lib.set_quality(s, engine="eevee", res=res, samples=samples)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES
    out_dir = os.path.join(OUT, label)
    os.makedirs(out_dir, exist_ok=True)
    sc.render.filepath = os.path.join(out_dir, "f_")

    t = time.time()
    try:
        if opengl:
            # Render viewport thay vì render đầy đủ. Trong chế độ -b thường KHÔNG có
            # ngữ cảnh GL — nếu vậy thì báo rõ chứ không im lặng cho qua.
            bpy.ops.render.opengl(animation=True)
        else:
            bpy.ops.render.render(animation=True)
    except Exception as exc:  # noqa: BLE001
        print(f"@@BENCH {label}: KHÔNG CHẠY ĐƯỢC — {type(exc).__name__}: {exc}")
        return

    ms = (time.time() - t) * 1000

    # Đếm ảnh khác nhau: một dải nhanh mà toàn ảnh giống nhau thì vô dụng, và đó đúng
    # là kiểu lỗi im lặng dự án này đã gặp nhiều lần.
    import hashlib

    digests = set()
    written = 0
    for i in range(1, FRAMES + 1):
        path = os.path.join(out_dir, f"f_{i:04d}.png")
        if not os.path.exists(path):
            continue
        written += 1
        with open(path, "rb") as fh:
            digests.add(hashlib.sha256(fh.read()).hexdigest())

    print(
        f"@@BENCH {label}: {ms / FRAMES:.0f} ms/frame "
        f"({ms / 1000:.1f}s cho {FRAMES} frame) · file {written} · ảnh khác nhau {len(digests)}"
    )


def main():
    s = scene_lib.build_once(engine="eevee", res=(480, 640), samples=16)
    bpy.context.scene.render.use_persistent_data = True
    anim.apply_animation(s, CHANNELS)

    bench("eevee_480_16", s, (480, 640), 16)
    bench("eevee_480_4", s, (480, 640), 4)
    bench("eevee_320_4", s, (320, 426), 4)
    bench("eevee_240_2", s, (240, 320), 2)
    bench("opengl_480", s, (480, 640), 16, opengl=True)


main()
