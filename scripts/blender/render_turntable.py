"""Render turntable 360 độ ra PNG sequence có alpha.

Chạy:
  Blender -b --factory-startup -P scripts/blender/render_turntable.py -- \
      --hdri assets/hdri/brown_photostudio_02.hdr \
      --screen path/to/app.png \
      --out renders/turntable \
      [--engine cycles|eevee] [--fps 30] [--duration 5] [--samples 128]
      [--res 1080x1440] [--elevation 10] [--start-az 0] [--ease]

Mặc định xoay tuyến tính để clip loop liền mạch. --ease dùng ease-in-out, đẹp cho
clip có điểm đầu/cuối rõ ràng nhưng KHÔNG loop được.
"""

import argparse
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene_lib  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :]
ap = argparse.ArgumentParser()
ap.add_argument("--hdri", required=True)
ap.add_argument("--screen", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--engine", default="cycles", choices=["cycles", "eevee"])
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--duration", type=float, default=5.0)
ap.add_argument("--samples", type=int, default=None)
ap.add_argument("--res", default="1080x1440")
ap.add_argument("--elevation", type=float, default=10.0)
ap.add_argument("--start-az", type=float, default=0.0)
ap.add_argument("--frame-fill", type=float, default=0.72)
ap.add_argument("--world-strength", type=float, default=1.0)
ap.add_argument("--hdri-rotation", type=float, default=0.0, help="xoay HDRI quanh Z, độ")
ap.add_argument("--reflector-strength", type=float, default=0.0, help="tấm hắt chỉ hiện trong phản chiếu; 0 = tắt")
ap.add_argument("--ease", action="store_true")
args = ap.parse_args(argv)

res = tuple(int(x) for x in args.res.lower().split("x"))
n_frames = max(1, round(args.fps * args.duration))

s = scene_lib.build(
    hdri=os.path.abspath(args.hdri),
    screen_img=os.path.abspath(args.screen),
    engine=args.engine,
    res=res,
    samples=args.samples,
    world_strength=args.world_strength,
    reflector_strength=args.reflector_strength,
    hdri_rotation=args.hdri_rotation,
)
scene_lib.place_camera(s, args.start_az, args.elevation, args.frame_fill)

sc = bpy.context.scene
sc.render.fps = args.fps
sc.frame_start, sc.frame_end = 1, n_frames

# Keyframe 360 độ đặt ở frame n+1 chứ không phải n: frame n+1 trùng frame 1, nên
# render 1..n cho ra vòng xoay khép kín không lặp frame.
pivot = s["pivot"]
pivot.rotation_mode = "XYZ"
pivot.rotation_euler = (0, 0, 0)
pivot.keyframe_insert("rotation_euler", frame=1)
pivot.rotation_euler = (0, 0, math.radians(360))
pivot.keyframe_insert("rotation_euler", frame=n_frames + 1)

for fc in pivot.animation_data.action.fcurves:
    for kp in fc.keyframe_points:
        if args.ease:
            kp.interpolation = "BEZIER"
            kp.easing = "EASE_IN_OUT"
        else:
            kp.interpolation = "LINEAR"

out_dir = os.path.abspath(args.out)
os.makedirs(out_dir, exist_ok=True)
sc.render.filepath = os.path.join(out_dir, "frame_")

print(f"\n### engine={sc.render.engine} res={res[0]}x{res[1]} frames={n_frames} @ {args.fps}fps")
print(f"### interpolation={'ease-in-out' if args.ease else 'linear (loopable)'}")
print(f"### cam dist={s['dist']*1000:.0f}mm elevation={args.elevation}deg")
print(f"### out={out_dir}/frame_####.png")

bpy.ops.render.render(animation=True)
print("### done")
