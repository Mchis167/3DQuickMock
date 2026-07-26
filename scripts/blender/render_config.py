"""Render từ một file config JSON — điểm vào chính của pipeline.

  Blender -b --factory-startup -P scripts/blender/render_config.py -- config.json [--out DIR]
                                                                    [--engine eevee] [--draft]

`--draft` ép EEVEE, hạ độ phân giải và samples để xem nhanh. Framing giữ nguyên
tuyệt đối so với bản final (đã đo: IoU 99.91%), chỉ khác ánh sáng và không có
contact shadow.
"""

import argparse
import atexit
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import scene_lib  # noqa: E402
import validate_config  # noqa: E402

# Blender thoát mã 0 KỂ CẢ khi script `-P` raise: nó tự bắt exception, in traceback, rồi
# thoát bình thường. Không tự đặt mã thoát thì mọi lỗi render — thiếu file ảnh, config sai,
# hết bộ nhớ — đều thành "thành công" im lặng, và phía gọi sẽ đưa cho người dùng một link
# tải file không tồn tại. Đã kiểm chứng 2026-07-25 (Blender 4.5.1).
_FINISHED = {"ok": False}


def _enforce_exit_code():
    if not _FINISHED["ok"]:
        sys.stderr.write("### THẤT BẠI: script không chạy tới cuối\n")
        sys.stderr.flush()
        os._exit(1)


atexit.register(_enforce_exit_code)

argv = sys.argv[sys.argv.index("--") + 1 :]
ap = argparse.ArgumentParser()
ap.add_argument("config")
ap.add_argument("--out", default=None, help="ghi đè output.dir trong config")
ap.add_argument("--engine", default=None, choices=["cycles", "eevee"])
ap.add_argument("--draft", action="store_true", help="EEVEE, 1/2 độ phân giải, ít samples")
args = ap.parse_args(argv)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def rel(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


with open(rel(args.config)) as f:
    cfg = json.load(f)

# Validate TRƯỚC khi dựng scene. Render sai mất tới 28 phút mới lộ ra; ở đây tốn 5ms.
try:
    validate_config.validate_or_raise(cfg)
except validate_config.ConfigError as e:
    sys.stderr.write(f"\n### {args.config}\n{e}\n\n")
    sys.exit(1)

r = cfg.get("render", {})
w = cfg.get("world", {})
c = cfg.get("camera", {})
channels = cfg.get("channels", {})

engine = args.engine or ("eevee" if args.draft else r.get("engine", "cycles"))
res = list(r.get("res", [1080, 1440]))
samples = r.get("samples")
if args.draft:
    res = [max(2, res[0] // 2), max(2, res[1] // 2)]
    samples = 16

s = scene_lib.build(
    hdri=rel(w.get("hdri", "assets/hdri/studio_small_03.hdr")),
    screen_img=rel(cfg.get("screen", "assets/test/uv_test.png")),
    engine=engine,
    res=tuple(res),
    samples=samples,
    world_strength=w.get("strength", 1.0),
    reflector_strength=w.get("reflector_strength", 0.0),
    hdri_rotation=w.get("rotation", 0.0),
)

# Giá trị tĩnh là nền; kênh animation ghi đè lên trên nếu có.
if "focal" in c:
    s["cam"].data.lens = c["focal"]

# Pose trước camera: nó trả về độ nâng mà target camera phải bù (xem set_device_pose).
pose = cfg.get("pose", {})
lift = scene_lib.set_device_pose(
    s,
    pose.get("spin_x", 0.0),
    pose.get("spin_y", 0.0),
    pose.get("spin_z", 0.0),
    pose.get("ground", True),
)

scene_lib.place_camera(
    s,
    c.get("azimuth", 0.0),
    c.get("elevation", 10.0),
    c.get("frame_fill", 0.72),
    c.get("target_z_offset", 0.0) + lift,
)

sc = bpy.context.scene
sc.render.fps = r.get("fps", 30)
sc.render.use_persistent_data = True
if "view_transform" in r:
    sc.view_settings.view_transform = r["view_transform"]

out_dir = rel(args.out or cfg.get("output", {}).get("dir", "renders/out"))
os.makedirs(out_dir, exist_ok=True)

print(f"\n### engine={sc.render.engine} res={res[0]}x{res[1]} samples={samples}")

if channels:
    applied = anim.apply_animation(s, channels)
    n_frames = r.get("frames") or round(sc.render.fps * r.get("duration", 5.0))
    sc.frame_start, sc.frame_end = 1, n_frames
    sc.render.filepath = os.path.join(out_dir, "frame_")
    print(f"### kênh animation: {', '.join(applied)}")
    print(f"### {n_frames} frame @ {sc.render.fps}fps -> {out_dir}/frame_####.png")
    bpy.ops.render.render(animation=True)
else:
    sc.render.filepath = os.path.join(out_dir, cfg.get("output", {}).get("name", "still") + ".png")
    print(f"### ảnh tĩnh -> {sc.render.filepath}")
    bpy.ops.render.render(write_still=True)

print("### done")

# Chỉ tới đây mới coi là thành công. Mọi đường thoát khác đều để _FINISHED sai và
# atexit sẽ đặt mã thoát 1.
if not os.path.exists(sc.render.filepath) and not channels:
    sys.stderr.write(f"### THẤT BẠI: không thấy file ra {sc.render.filepath}\n")
    sys.exit(1)
_FINISHED["ok"] = True
