"""Gán mỗi material một màu rực riêng rồi render, để biết material nào là bộ phận nào."""
import os, sys, math, colorsys
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(sys.argv[sys.argv.index("--")+1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,"assets/raw/iphone-17-pro-max/model.glb"))

names = sorted(m.name for m in bpy.data.materials)
print("\n### legend (hue order)")
for i, n in enumerate(names):
    r,g,b = colorsys.hsv_to_rgb(i/len(names), 0.95, 1.0)
    mat = bpy.data.materials[n]
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs["Color"].default_value=(r,g,b,1)
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    print(f" {n:24} rgb=({r:.2f},{g:.2f},{b:.2f})  polys={sum(len(ob.data.polygons) for ob in bpy.data.objects if ob.type=='MESH' and any(s.material and s.material.name==n for s in ob.material_slots))}")

pts=[ob.matrix_world @ Vector(v) for ob in bpy.data.objects if ob.type=='MESH' for v in ob.bound_box]
lo=Vector((min(p[i] for p in pts) for i in range(3))); hi=Vector((max(p[i] for p in pts) for i in range(3)))
center=(lo+hi)/2; height=hi.z-lo.z

t=bpy.data.objects.new("T",None); bpy.context.collection.objects.link(t); t.location=center
cd=bpy.data.cameras.new("C"); cd.lens=85; cd.sensor_fit='VERTICAL'; cd.sensor_height=24
cam=bpy.data.objects.new("C",cd); bpy.context.collection.objects.link(cam); bpy.context.scene.camera=cam
con=cam.constraints.new('TRACK_TO'); con.target=t; con.track_axis='TRACK_NEGATIVE_Z'; con.up_axis='UP_Y'
dist=(height/0.72)*85/24

sc=bpy.context.scene
sc.render.engine='BLENDER_EEVEE_NEXT'
sc.render.resolution_x, sc.render.resolution_y = 900,1200
sc.render.film_transparent=True
sc.view_settings.view_transform='Standard'   # ID pass: không tone map
sc.eevee.taa_render_samples=16

# +Y là mặt trước (đã xác định ở lượt trước) -> back view là -Y
for name,(az,el) in {"front":(20,8),"back":(200,8),"bottom":(0,-55)}.items():
    a=math.radians(az); e=math.radians(el)
    cam.location=center+Vector((math.sin(a)*math.cos(e)*dist, math.cos(a)*math.cos(e)*dist, math.sin(e)*dist))
    sc.render.filepath=f"{OUT}_{name}.png"
    bpy.ops.render.render(write_still=True)
