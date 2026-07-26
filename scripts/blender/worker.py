"""Tiến trình Blender thường trực cho live preview.

Chạy:
  Blender -b --factory-startup -P scripts/blender/worker.py

Giao thức: mỗi dòng stdin là một lệnh JSON, mỗi dòng stdout bắt đầu bằng `@@` là một
phản hồi JSON. Tiền tố `@@` để tách khỏi log ồn ào của Blender.

Vì sao thường trực: khởi động Blender tốn ~1.4 s còn dựng lại scene chỉ 0.07 s. Giữ
tiến trình sống thì mỗi lần cập nhật chỉ còn ~0.25 s thay vì 1.9 s.

Lệnh:
  {"cmd":"ping"}
  {"cmd":"scene",  "engine":"eevee", "res":[480,640], "samples":16}   # dựng lại scene
  {"cmd":"still",  "out":"/tmp/p.png", "camera":{...}, "pose":{...}, "world":{...}, "screen":"..."}
  {"cmd":"plate",  "out_dir":"/tmp/plate", ...}   # beauty + UV pass để ghép video ở client
  {"cmd":"strip",  "out_dir":"/tmp/strip", "n":72, ...}   # precompute dải góc xoay
  {"cmd":"anim",   "out_dir":"/tmp/anim", "channels":{...}, "frames":120, "fps":30}
  {"cmd":"quit"}

Ảnh màn hình: gửi `"screen": "/abs/one.png"` cho một ảnh tĩnh, HOẶC
`"screen_sequence": {"first": "/abs/scr_0001.png", "frames": 90, "start": 40}` để dán một
dải ảnh chạy theo frame timeline — đó là cách phát video trên màn hình trong lúc device
animate, không cần plate.
"""

import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import plate  # noqa: E402
import scene_lib  # noqa: E402

STATE = {"s": None}


def reply(obj):
    sys.stdout.write("@@" + json.dumps(obj) + "\n")
    sys.stdout.flush()


def ensure_scene(engine="eevee", res=(480, 640), samples=16, reflector_strength=0.0):
    if STATE["s"] is None:
        STATE["s"] = scene_lib.build_once(
            engine=engine, res=tuple(res), samples=samples,
            reflector_strength=reflector_strength,
        )
        bpy.context.scene.render.use_persistent_data = True
    return STATE["s"]


def apply_config(s, cmd):
    """Áp phần cấu hình chung cho cả still / strip / anim."""
    # `screen_sequence` thắng `screen`: nó là đường "video phát trên màn hình trong lúc
    # device animate" (xem scene_lib.set_screen_sequence). Nhận cả hai cùng lúc là mâu thuẫn
    # — phía gọi chỉ được gửi một trong hai cho mỗi lượt render.
    seq = cmd.get("screen_sequence")
    if seq:
        if "screen" in cmd:
            raise ValueError("chỉ được gửi MỘT trong `screen` hoặc `screen_sequence`")
        scene_lib.set_screen_sequence(
            s, seq["first"], seq["frames"], seq.get("start", 1)
        )
    elif "screen" in cmd:
        scene_lib.set_screen_image(s, cmd["screen"])
    w = cmd.get("world") or {}
    if "hdri" in w:
        scene_lib.set_hdri(s, w["hdri"])
    scene_lib.set_world(s, strength=w.get("strength"), rotation=w.get("rotation"))
    q = cmd.get("quality") or {}
    if q:
        scene_lib.set_quality(
            s, engine=q.get("engine"),
            res=tuple(q["res"]) if "res" in q else None,
            samples=q.get("samples"),
        )
    # Pose phải áp TRƯỚC camera: nó trả về độ nâng mà camera cần bù, và nếu đặt camera
    # trước thì target vẫn ở tâm cũ -> máy trôi lên khỏi giữa khung khi nghiêng.
    p = cmd.get("pose") or {}
    lift = scene_lib.set_device_pose(
        s,
        p.get("spin_x", 0.0),
        p.get("spin_y", 0.0),
        p.get("spin_z", 0.0),
        p.get("ground", True),
    )

    c = cmd.get("camera") or {}
    if "focal" in c:
        s["cam"].data.lens = c["focal"]
    scene_lib.place_camera(
        s,
        c.get("azimuth", 0.0),
        c.get("elevation", 10.0),
        c.get("frame_fill", 0.72),
        c.get("target_z_offset", 0.0) + lift,
    )


def cmd_still(cmd):
    s = ensure_scene()
    scene_lib.clear_animation(s)
    apply_config(s, cmd)
    out = cmd["out"]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    bpy.context.scene.render.filepath = out
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return {
        "ok": True, "out": out, "ms": round((time.time() - t) * 1000),
        "lift_mm": round(s["lift"] * 1000, 3),
        "bottom_gap_mm": round((scene_lib.device_bottom_z(s) - s["plane_z"]) * 1000, 3),
    }


def cmd_plate(cmd):
    """Bộ ảnh để client ghép video bằng WebGL — xem plate.py."""
    s = ensure_scene()
    scene_lib.clear_animation(s)
    apply_config(s, cmd)
    t = time.time()
    out = plate.render_plate(s, cmd["out_dir"])
    out["ok"] = True
    out["ms"] = round((time.time() - t) * 1000)
    return out


def cmd_strip(cmd):
    """Precompute dải góc xoay để UI kéo chuột mượt mà không phải render lại.

    Kéo chuột thì hiển thị frame gần nhất trong dải (tức thì); thả chuột mới render
    đúng góc. Nhờ vậy người dùng không cảm nhận được tốc độ ~4 fps.
    """
    s = ensure_scene()
    scene_lib.clear_animation(s)
    apply_config(s, cmd)
    n = int(cmd.get("n", 72))
    out_dir = cmd["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    c = cmd.get("camera") or {}
    el = c.get("elevation", 10.0)
    ff = c.get("frame_fill", 0.72)
    t = time.time()
    files = []
    for i in range(n):
        az = 360.0 * i / n
        scene_lib.place_camera(s, az, el, ff)
        p = os.path.join(out_dir, f"az_{i:03d}.png")
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        files.append(p)
    return {
        "ok": True, "n": n, "dir": out_dir, "step_deg": 360.0 / n,
        "ms": round((time.time() - t) * 1000), "files": files[:3] + ["..."],
    }


def cmd_anim(cmd):
    """Render một KHOẢNG frame.

    `from`/`to` cho phép chia dải dài thành nhiều lượt gọi. Vì sao cần: một lượt render
    150 frame là ~12–37 giây trong đó UI không biết gì cả — không tiến độ, không huỷ
    được. Chia khoảng thì mỗi lượt trả lời một lần, và phía gọi vừa hiện được tiến độ
    thật vừa dừng được giữa đường.

    Scene vẫn sống giữa các lượt (`use_persistent_data`), nên chia nhỏ gần như không
    tốn thêm — đo được ở `bench_playback.py`.
    """
    s = ensure_scene()
    scene_lib.clear_animation(s)
    apply_config(s, cmd)
    if cmd.get("channels"):
        anim.apply_animation(s, cmd["channels"])
    sc = bpy.context.scene
    sc.render.fps = cmd.get("fps", 30)
    n = int(cmd.get("frames", 120))
    first = max(1, int(cmd.get("from", 1)))
    last = min(n, int(cmd.get("to", n)))
    sc.frame_start, sc.frame_end = first, last
    out_dir = cmd["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    sc.render.filepath = os.path.join(out_dir, "frame_")
    t = time.time()
    bpy.ops.render.render(animation=True)
    return {
        "ok": True,
        "frames": n,
        "from": first,
        "to": last,
        "dir": out_dir,
        "ms": round((time.time() - t) * 1000),
    }


def cmd_sample(cmd):
    """Lấy giá trị kênh theo frame — UI vẽ đường cong khớp đúng với lúc render."""
    s = ensure_scene()
    scene_lib.clear_animation(s)
    if cmd.get("channels"):
        anim.apply_animation(s, cmd["channels"])
    frames = cmd.get("frames_list") or list(range(1, int(cmd.get("frames", 120)) + 1))
    return {
        "ok": True,
        "values": {k: anim.sample_channel(s, k, frames) for k in cmd["channels"]},
        "frames": frames,
    }


HANDLERS = {
    "ping": lambda c: {"ok": True, "blender": bpy.app.version_string},
    "scene": lambda c: (
        STATE.__setitem__("s", None),
        ensure_scene(
            c.get("engine", "eevee"), c.get("res", (480, 640)),
            c.get("samples", 16), c.get("reflector_strength", 0.0),
        ),
        {"ok": True, "engine": c.get("engine", "eevee")},
    )[-1],
    "still": cmd_still,
    "plate": cmd_plate,
    "strip": cmd_strip,
    "anim": cmd_anim,
    "sample": cmd_sample,
    "meta": lambda c: {
        "ok": True,
        "channels": sorted(anim.CHANNELS),
        "interpolations": anim.INTERPOLATIONS,
        "easings": anim.EASINGS,
        "handle_types": anim.HANDLE_TYPES,
    },
}

reply({"ok": True, "ready": True, "pid": os.getpid()})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        cmd = json.loads(line)
    except json.JSONDecodeError as e:
        reply({"ok": False, "error": f"JSON không hợp lệ: {e}"})
        continue
    name = cmd.get("cmd")
    if name == "quit":
        reply({"ok": True, "bye": True})
        break
    fn = HANDLERS.get(name)
    if fn is None:
        reply({"ok": False, "error": f"lệnh lạ: {name}", "known": sorted(HANDLERS)})
        continue
    try:
        reply(fn(cmd))
    except Exception as e:  # noqa: BLE001 - worker không được chết vì một lệnh hỏng
        import traceback

        reply({"ok": False, "error": str(e), "trace": traceback.format_exc()[-800:]})
