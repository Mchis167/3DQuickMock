"""Ánh xạ keyframe giữa config JSON và F-Curve của Blender.

Nguyên tắc: mọi kênh animation phải là THUỘC TÍNH BLENDER THẬT, không phải giá trị
tính toán. Chỉ khi đó tay cầm bezier mới round-trip được — nếu config lưu tay cầm ở
một không gian khác với F-Curve thì UI kéo tay cầm sẽ ra kết quả khác lúc render.

Tay cầm bezier lưu trong config ở đúng không gian (frame, value) như Blender, chỉ
khác đơn vị: config dùng độ, Blender dùng radian. Phép đổi là nhân vô hướng nên tay
cầm biến đổi đúng, kể cả khi hệ số âm (azimuth).
"""

import math

import bpy

DEG = math.pi / 180.0


class Channel:
    """Một kênh animation: tên logic ↔ đường dẫn dữ liệu Blender.

    scale: hệ số nhân từ đơn vị config sang đơn vị Blender. Âm nghĩa là đảo chiều
    (azimuth: rig xoay ngược so với quy ước cũ để giữ preset góc không đổi).
    """

    def __init__(self, key, owner, data_path, index=-1, scale=1.0, unit=""):
        self.key = key
        self.owner = owner  # 'orbit_az' | 'orbit_el' | 'cam' | 'cam_data' | 'world'
        self.data_path = data_path
        self.index = index
        self.scale = scale
        self.unit = unit

    def to_blender(self, v):
        return v * self.scale

    def to_config(self, v):
        return v / self.scale


CHANNELS = {
    c.key: c
    for c in [
        Channel("camera.azimuth", "orbit_az", "rotation_euler", 2, -DEG, "deg"),
        Channel("camera.elevation", "orbit_el", "rotation_euler", 0, DEG, "deg"),
        Channel("camera.distance", "cam", "location", 1, 1.0, "m"),
        Channel("camera.focal", "cam_data", "lens", -1, 1.0, "mm"),
        Channel("device.spin_x", "pivot", "rotation_euler", 0, DEG, "deg"),
        Channel("device.spin_y", "pivot", "rotation_euler", 1, DEG, "deg"),
        Channel("device.spin_z", "pivot", "rotation_euler", 2, DEG, "deg"),
        Channel(
            "world.hdri_rotation",
            "world",
            'nodes["EnvMapping"].inputs[2].default_value',
            2,
            DEG,
            "deg",
        ),
        Channel(
            "world.strength",
            "world",
            'nodes["EnvBackground"].inputs[1].default_value',
            -1,
            1.0,
            "",
        ),
    ]
}


def _id_owner(s, owner):
    """Trả về datablock mang animation_data cho kênh này."""
    if owner == "cam_data":
        return s["cam"].data
    if owner == "world":
        return bpy.context.scene.world.node_tree
    return s[owner]


def _get_action(idblock):
    """Action đã GẮN SLOT, sẵn sàng để Blender đánh giá.

    Từ Blender 4.4 action có "slot": một action chưa gắn slot thì **không được đánh giá**,
    nhưng `action.fcurves` vẫn đọc/ghi được bình thường. Đó là một cái bẫy im lặng hoàn
    hảo — và dự án đã sập vào nó:

      - `sample` đọc thẳng fcurve nên trả về đúng đường cong;
      - UI vẽ đúng, tua đúng, mọi con số đều hợp lý;
      - còn render animation thì ra 150 frame **giống hệt nhau** ở pose nền.

    Action mới tạo có `slots` RỖNG, nên bản trước kiểm `if act.slots:` rồi lặng lẽ bỏ qua.
    Phải TỰ TẠO slot, và tạo TRƯỚC khi thêm fcurve để channelbag gắn vào đúng slot.
    """
    if idblock.animation_data is None:
        idblock.animation_data_create()
    ad = idblock.animation_data
    if ad.action is None:
        ad.action = bpy.data.actions.new(f"Act_{idblock.name}")

    act = ad.action
    # API cũ (Blender < 4.4) không có slot; ở đó action gắn thẳng và vẫn chạy.
    if hasattr(ad, "action_slot") and ad.action_slot is None:
        slot = act.slots[0] if act.slots else act.slots.new(
            id_type=idblock.id_type, name=idblock.name
        )
        ad.action_slot = slot
    return act


def _find_fcurve(action, data_path, index):
    for fc in action.fcurves:
        if fc.data_path == data_path and fc.array_index == index:
            return fc
    return None


# --------------------------------------------------------------------------- apply


def apply_channel(s, key, spec):
    """Ghi một kênh từ config vào F-Curve.

    spec = {
      "keyframes": [
        {"frame": 1, "value": 0,
         "interpolation": "BEZIER",          # 13 kiểu, xem INTERPOLATIONS
         "easing": "AUTO",                   # AUTO | EASE_IN | EASE_OUT | EASE_IN_OUT
         "handle_left":  {"frame": -9, "value": 0,  "type": "AUTO_CLAMPED"},
         "handle_right": {"frame": 11, "value": 30, "type": "AUTO_CLAMPED"}}
      ],
      "extrapolation": "CONSTANT",           # CONSTANT | LINEAR
      "modifiers": [{"type": "CYCLES"}]
    }
    """
    ch = CHANNELS[key]
    idblock = _id_owner(s, ch.owner)
    action = _get_action(idblock)
    idx = ch.index if ch.index >= 0 else 0

    fc = _find_fcurve(action, ch.data_path, idx)
    if fc is not None:
        action.fcurves.remove(fc)
    fc = action.fcurves.new(ch.data_path, index=idx)

    kfs = sorted(spec.get("keyframes", []), key=lambda k: k["frame"])
    fc.keyframe_points.add(count=len(kfs))
    for kp, k in zip(fc.keyframe_points, kfs):
        kp.co = (k["frame"], ch.to_blender(k["value"]))
        kp.interpolation = k.get("interpolation", "BEZIER")
        kp.easing = k.get("easing", "AUTO")
        hl, hr = k.get("handle_left"), k.get("handle_right")
        if hl:
            kp.handle_left_type = hl.get("type", "ALIGNED")
            kp.handle_left = (hl["frame"], ch.to_blender(hl["value"]))
        else:
            kp.handle_left_type = "AUTO_CLAMPED"
        if hr:
            kp.handle_right_type = hr.get("type", "ALIGNED")
            kp.handle_right = (hr["frame"], ch.to_blender(hr["value"]))
        else:
            kp.handle_right_type = "AUTO_CLAMPED"

    fc.extrapolation = spec.get("extrapolation", "CONSTANT")
    for m in spec.get("modifiers", []):
        fc.modifiers.new(m["type"])
    fc.update()
    return fc


def apply_animation(s, channels_cfg):
    """Ghi toàn bộ khối `channels` của config vào scene, rồi KIỂM là nó có tác dụng."""
    applied = []
    for key, spec in channels_cfg.items():
        if key not in CHANNELS:
            raise KeyError(f"kênh không hợp lệ: {key} (có: {sorted(CHANNELS)})")
        apply_channel(s, key, spec)
        applied.append(key)
    _assert_animation_evaluates(s, applied)
    return applied


def _read_property(idblock, ch):
    value = idblock.path_resolve(ch.data_path)
    return value[ch.index] if ch.index >= 0 else value


def _assert_animation_evaluates(s, keys):
    """Đặt frame và ĐỌC LẠI thuộc tính thật: animation phải thực sự lái được nó.

    Vì sao phải có rào chắn này thay vì tin vào việc đã ghi fcurve: viết fcurve và
    fcurve ĐƯỢC ĐÁNH GIÁ là hai chuyện khác nhau. Từ Blender 4.4, action chưa gắn slot
    thì bị bỏ qua hoàn toàn khi render, mà `action.fcurves` vẫn đọc/ghi bình thường và
    `fcurve.evaluate()` vẫn trả đúng số. Dự án đã sập đúng vào đó: UI vẽ đúng, `sample`
    trả đúng, còn dải render ra 150 frame giống hệt nhau — không một dòng lỗi nào.

    Rào chắn so giá trị THẬT của thuộc tính với `fcurve.evaluate()` tại hai frame khác
    nhau. Lệch là ném lỗi ngay tại đây, chứ không để nó thành một clip đứng im.
    """
    scene = bpy.context.scene
    original = scene.frame_current
    try:
        for key in keys:
            ch = CHANNELS[key]
            idblock = _id_owner(s, ch.owner)
            idx = ch.index if ch.index >= 0 else 0
            fc = _find_fcurve(idblock.animation_data.action, ch.data_path, idx)
            if fc is None or len(fc.keyframe_points) < 2:
                continue

            first = int(fc.keyframe_points[0].co[0])
            last = int(fc.keyframe_points[-1].co[0])
            for frame in (first, last):
                scene.frame_set(frame)
                expected = fc.evaluate(frame)
                actual = _read_property(idblock, ch)
                # Ngưỡng nới theo biên độ: góc lưu bằng radian nên 1e-4 là quá chặt cho
                # kênh chạy hàng chục radian, còn quá lỏng thì rào chắn không cắn.
                tolerance = max(1e-4, abs(expected) * 1e-4)
                if abs(actual - expected) > tolerance:
                    raise RuntimeError(
                        f"animation không được đánh giá: kênh {key} tại frame {frame} "
                        f"đọc ra {actual:.6f} nhưng fcurve nói {expected:.6f}. "
                        "Thường là action chưa gắn slot (Blender 4.4+) — xem _get_action."
                    )
    finally:
        scene.frame_set(original)


# --------------------------------------------------------------------------- extract


def extract_channel(s, key):
    """Đọc ngược F-Curve về dạng config. Dùng để round-trip với UI."""
    ch = CHANNELS[key]
    idblock = _id_owner(s, ch.owner)
    if idblock.animation_data is None or idblock.animation_data.action is None:
        return None
    idx = ch.index if ch.index >= 0 else 0
    fc = _find_fcurve(idblock.animation_data.action, ch.data_path, idx)
    if fc is None:
        return None

    kfs = []
    for kp in fc.keyframe_points:
        kfs.append(
            {
                "frame": round(kp.co[0], 6),
                "value": round(ch.to_config(kp.co[1]), 6),
                "interpolation": kp.interpolation,
                "easing": kp.easing,
                "handle_left": {
                    "frame": round(kp.handle_left[0], 6),
                    "value": round(ch.to_config(kp.handle_left[1]), 6),
                    "type": kp.handle_left_type,
                },
                "handle_right": {
                    "frame": round(kp.handle_right[0], 6),
                    "value": round(ch.to_config(kp.handle_right[1]), 6),
                    "type": kp.handle_right_type,
                },
            }
        )
    return {
        "keyframes": kfs,
        "extrapolation": fc.extrapolation,
        "modifiers": [{"type": m.type} for m in fc.modifiers],
    }


def extract_animation(s):
    out = {}
    for key in CHANNELS:
        spec = extract_channel(s, key)
        if spec:
            out[key] = spec
    return out


# --------------------------------------------------------------------------- tiện ích


INTERPOLATIONS = [
    "CONSTANT", "LINEAR", "BEZIER",
    "SINE", "QUAD", "CUBIC", "QUART", "QUINT", "EXPO", "CIRC",
    "BACK", "BOUNCE", "ELASTIC",
]
EASINGS = ["AUTO", "EASE_IN", "EASE_OUT", "EASE_IN_OUT"]
HANDLE_TYPES = ["FREE", "ALIGNED", "VECTOR", "AUTO", "AUTO_CLAMPED"]


def sample_channel(s, key, frames):
    """Lấy giá trị kênh tại các frame — để UI vẽ đường cong khớp đúng render."""
    ch = CHANNELS[key]
    idblock = _id_owner(s, ch.owner)
    idx = ch.index if ch.index >= 0 else 0
    fc = _find_fcurve(idblock.animation_data.action, ch.data_path, idx)
    return [ch.to_config(fc.evaluate(f)) for f in frames]


def turntable_preset(n_frames, loopable=True):
    """Vòng xoay 360 độ. Tuyến tính thì loop khép kín; easing thì KHÔNG.

    Keyframe cuối đặt ở n_frames+1 vì frame đó trùng frame 1 — render 1..n cho
    vòng khép kín không lặp frame.
    """
    interp = "LINEAR" if loopable else "BEZIER"
    return {
        "device.spin_z": {
            "keyframes": [
                {"frame": 1, "value": 0.0, "interpolation": interp, "easing": "AUTO"},
                {"frame": n_frames + 1, "value": 360.0, "interpolation": interp,
                 "easing": "EASE_IN_OUT" if not loopable else "AUTO"},
            ],
            "extrapolation": "LINEAR" if loopable else "CONSTANT",
        }
    }
