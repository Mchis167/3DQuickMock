"""Render ảnh tĩnh ở một hoặc nhiều góc.

Chạy:
  Blender -b --factory-startup -P scripts/blender/render_still.py -- \
      --hdri assets/hdri/brown_photostudio_02.hdr \
      --screen path/to/app.png \
      --out renders/still \
      [--engine cycles|eevee] [--samples 48] [--res 900x1200]
      [--views front:0,2 tq:32,10 back:180,10]   # tên:phương_vị,độ_cao
"""

import argparse
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
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--res", default="900x1200")
ap.add_argument("--frame-fill", type=float, default=0.72)
ap.add_argument("--world-strength", type=float, default=1.0)
ap.add_argument("--hdri-rotation", type=float, default=0.0, help="xoay HDRI quanh Z, độ")
ap.add_argument("--reflector-strength", type=float, default=0.0, help="tấm hắt chỉ hiện trong phản chiếu; 0 = tắt")
ap.add_argument("--target-z-offset", type=float, default=0.0, help="dịch điểm ngắm theo trục Z, đơn vị mét")
ap.add_argument("--views", nargs="+", default=["front:0,2", "tq:32,10", "back:180,10"])
args = ap.parse_args(argv)

res = tuple(int(x) for x in args.res.lower().split("x"))

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
sc = bpy.context.scene
sc.render.use_persistent_data = True

print(f"\n### engine={sc.render.engine} res={res[0]}x{res[1]} samples={args.samples}")

for spec in args.views:
    name, angles = spec.split(":")
    az, el = (float(v) for v in angles.split(","))
    scene_lib.place_camera(s, az, el, args.frame_fill, args.target_z_offset)
    sc.render.filepath = f"{os.path.abspath(args.out)}_{name}.png"
    bpy.ops.render.render(write_still=True)
    print(f"### {name}: az={az} el={el} -> {sc.render.filepath}")
