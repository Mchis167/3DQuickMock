"""Đo: dán DẢI ảnh lên màn hình có đắt hơn dán MỘT ảnh tĩnh không?

    Blender -b --factory-startup -P scripts/blender/bench_screen_sequence.py

Câu hỏi quyết định kiến trúc: nếu dải ảnh đắt xấp xỉ ảnh tĩnh thì "vừa animate device vừa
phát video trên màn hình" là MIỄN PHÍ so với animate device đơn thuần — vì ta đã trả tiền
một lần render mỗi frame rồi. Nếu nó đắt hơn nhiều thì phải nghĩ lại.
"""

import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import scene_lib  # noqa: E402

SEQ_DIR = os.path.join(os.getcwd(), "cache/probe-seq")
OUT = "/tmp/bench_screen_sequence"
FRAMES = 24
# Đúng độ nét của dải phát lại (xem PLAYBACK_SAMPLES / playbackResolution trong TS).
RES = (360, 480)
SAMPLES = 4

CHANNELS = {
    "device.spin_z": {
        "keyframes": [
            {"frame": 1, "value": 0.0, "interpolation": "LINEAR", "easing": "AUTO"},
            {"frame": FRAMES, "value": 20.0, "interpolation": "LINEAR", "easing": "AUTO"},
        ],
        "extrapolation": "CONSTANT",
        "modifiers": [],
    }
}


def render_range(label, s):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES
    out_dir = os.path.join(OUT, label)
    os.makedirs(out_dir, exist_ok=True)
    sc.render.filepath = os.path.join(out_dir, "f_")
    t = time.time()
    bpy.ops.render.render(animation=True)
    ms = (time.time() - t) * 1000
    print(f"@@BENCH {label}: {ms / FRAMES:.0f} ms/frame ({ms / 1000:.1f}s cho {FRAMES} frame)")
    return ms / FRAMES


def main():
    s = scene_lib.build_once(engine="eevee", res=RES, samples=SAMPLES)
    bpy.context.scene.render.use_persistent_data = True
    scene_lib.clear_animation(s)
    scene_lib.place_camera(s, 0.0, 12.0, 0.9)
    anim.apply_animation(s, CHANNELS)

    # 1) màn hình là MỘT ảnh tĩnh — đường hiện tại của dải phát lại
    static_file = os.path.join(SEQ_DIR, "scr_0001.png")
    scene_lib.set_screen_image(s, static_file)
    still_ms = render_range("screen_static", s)

    # 2) màn hình là DẢI ảnh, lặp lại để phủ hết 24 frame
    image = bpy.data.images.load(static_file)
    image.source = "SEQUENCE"
    image.colorspace_settings.name = "sRGB"
    s["screen_tex"].image = image
    user = s["screen_tex"].image_user
    user.frame_duration = 4
    user.frame_start = 1
    user.frame_offset = 0
    # Lặp để 24 frame timeline đều có ảnh — bench này đo CHI PHÍ, không đo cách nối dải.
    user.use_cyclic = True
    user.use_auto_refresh = True
    seq_ms = render_range("screen_sequence", s)

    delta = (seq_ms - still_ms) / still_ms * 100
    print(f"@@BENCH chênh lệch: {delta:+.1f}% ({seq_ms - still_ms:+.0f} ms/frame)")


main()
