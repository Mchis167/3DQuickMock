"""Dựng scene mockup: shading, HDRI, camera, shadow catcher, nền alpha.

Dùng chung cho render ảnh tĩnh và render turntable. Không tự chạy gì khi import.
"""

import math
import os

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(ROOT, "assets/raw/iphone-17-pro-max/model.glb")

FOCAL_MM = 85.0
SENSOR_MM = 24.0  # chiều dọc; sensor_fit phải là VERTICAL để khớp công thức FOV
TITANIUM = (0.76, 0.755, 0.74)

# Mặt trước của model này nằm về phía +Y (đã xác minh bằng render ID pass).
FRONT_SIGN = 1.0


# --------------------------------------------------------------------------- shading


def _fresh(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return nt, nt.nodes.new("ShaderNodeOutputMaterial")


def _principled(mat, base, metallic, rough, coat=0.0, ior=1.5, anisotropic=0.0):
    """anisotropic: vân chải một hướng cho brushed metal. Không có tham số grain:
    vi cấu trúc thật của titanium/kính nhám nhỏ hơn một pixel ở khoảng cách này nên
    không hiện thành gồ ghề nhìn thấy được - roughness đã mô hình hoá nó rồi. Đẩy
    noise vào Normal ở cỡ mm chỉ tạo ra hạt sạn giả (đã thử, tệ hơn bản phẳng).
    """
    nt, out = _fresh(mat)
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (*base, 1.0)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    p.inputs["IOR"].default_value = ior
    if "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = coat
    if anisotropic and "Anisotropic" in p.inputs:
        p.inputs["Anisotropic"].default_value = anisotropic
    nt.links.new(p.outputs["BSDF"], out.inputs["Surface"])


def _cover_glass(mat, rough=0.02):
    """Kính mỏng: Glossy pha Transparent theo fresnel.

    Không dùng Transmission vì trên mesh mỏng nó sinh khúc xạ sai và tốn sample.
    """
    nt, out = _fresh(mat)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.12
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = rough
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lw.outputs["Fresnel"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(gl.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    mat.blend_method = "BLEND"
    mat.use_backface_culling = True


def _emissive_screen(mat, path, strength=1.6):
    """Trả về node ảnh để setter đổi ảnh sau mà không phải dựng lại material."""
    nt, out = _fresh(mat)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "ScreenTex"
    if path:
        tex.image = bpy.data.images.load(path)
        tex.image.colorspace_settings.name = "sRGB"
    tex.extension = "EXTEND"
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (0, 0, 0, 1)
    p.inputs["Roughness"].default_value = 0.08
    p.inputs["Emission Strength"].default_value = strength
    nt.links.new(tex.outputs["Color"], p.inputs["Emission Color"])
    nt.links.new(p.outputs["BSDF"], out.inputs["Surface"])
    return tex


def _shade_all(screen_img):
    """Trả về node ảnh màn hình."""
    screen_tex = None
    for mat in bpy.data.materials:
        n = mat.name.replace("17ProMax_", "")
        if n == "Screen":
            screen_tex = _emissive_screen(mat, screen_img)
        elif n == "color3":
            _cover_glass(mat, rough=0.02)  # kính mặt trước
        elif n == "color":
            # brushed titanium: anisotropy làm highlight kéo dài theo một hướng thay
            # vì tụ thành đốm tròn - đây là thứ phân biệt kim loại chải với gương
            _principled(mat, TITANIUM, 1.0, 0.30, anisotropic=0.6)
        elif n == "color2":
            # kính mờ mặt sau: base tối hơn hẳn để coat còn chỗ tạo chuyển sáng.
            # base 0.80 + rough 0.42 làm tấm lưng bệt thành mảng trắng phẳng.
            _principled(mat, (0.58, 0.58, 0.60), 0.0, 0.22, coat=1.0)
        elif n == "Logo":
            # inlay đánh bóng như gương, phải tương phản rõ với tấm lưng mờ
            _principled(mat, (0.92, 0.92, 0.93), 1.0, 0.05)
        elif n == "Lens":
            _principled(mat, (0.04, 0.04, 0.045), 0.6, 0.18)  # ống kính mặt sau
        elif n == "Lens2":
            # ống kính camera trước: kính tối, ánh xanh lục nhạt, phải có glint sắc
            _principled(mat, (0.012, 0.020, 0.024), 0.0, 0.03, coat=1.0)
        elif n == "Black2":
            # Đây là thứ nhìn thấy qua khe Dynamic Island. Phải đen sâu hơn cả pixel
            # tắt của màn hình. metallic + roughness cao làm nó phản chiếu HDRI thành
            # mảng xám nhạt, khiến pill sáng hơn màn hình và trông như hình dán.
            _principled(mat, (0.004, 0.004, 0.005), 0.0, 0.07)
        elif n == "2112":
            # viền pill + vòng camera: dày 0mm nên chỉ đọc được nhờ highlight sắc
            _principled(mat, (0.010, 0.010, 0.012), 0.0, 0.08)
        elif n == "21":
            _principled(mat, (0.008, 0.008, 0.010), 0.0, 0.15)  # gờ quanh camera
        elif n in ("22", "G", "1111"):
            _principled(mat, (0.006, 0.006, 0.007), 0.0, 0.55)  # khe loa, mic
        elif n == "glass":
            _cover_glass(mat, rough=0.01)
        else:
            _principled(mat, (0.030, 0.030, 0.034), 0.0, 0.40)
    return screen_tex


def _add_inlay_thickness(ob, thickness_mm=0.12, bevel_mm=0.045, segments=3):
    """Cho mesh phẳng 0mm một độ dày thật kèm mép vát.

    Logo Apple và viền Dynamic Island trong model này đều dày đúng 0mm. Mặt gương
    phẳng tuyệt đối phản chiếu mọi điểm về cùng một hướng -> trả về một màu đồng
    nhất, đọc ra như hình dán bất kể môi trường có cấu trúc hay không. Chỉ ĐỘ CONG
    mới quét phản chiếu qua các vùng sáng tối và tạo ra gradient.

    Mép vát dù chỉ vài phần trăm mm cũng đủ bắt một vệt sáng viền quanh chi tiết -
    đó là thứ làm mắt đọc ra "khối kim loại khảm" thay vì "mảng màu".
    """
    solid = ob.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness = thickness_mm / 1000.0
    solid.offset = 1.0  # nhô ra ngoài, không đâm vào thân máy
    bevel = ob.modifiers.new("Bevel", "BEVEL")
    bevel.width = bevel_mm / 1000.0
    bevel.segments = segments
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(30)
    bevel.harden_normals = True
    ob.data.shade_smooth()


# --------------------------------------------------------------------------- lighting


def _add_reflection_cards(center, height, strength=1.0):
    """Tấm hắt CHỈ hiện trong phản chiếu, không đổ sáng vào scene.

    Kim loại đọc ra là kim loại nhờ độ TƯƠNG PHẢN của thứ nó phản chiếu. HDRI studio
    sáng đều nên gương (logo, viền) chỉ trả về một mảng trắng phẳng - đó là lý do
    chất liệu trông giả, không phải do thiếu vi cấu trúc bề mặt.

    Dùng area light cho việc này là sai: đèn vừa tạo phản chiếu vừa đổ sáng nên làm
    cháy trắng cả máy và phá nền alpha (đã thử). Thay bằng mặt phẳng emission với
    ray visibility bị cắt: tắt camera (không lọt vào nền alpha), tắt diffuse (không
    đổi độ phơi sáng tổng thể), tắt shadow (không đổ bóng lên shadow catcher) - chỉ
    còn glossy, tức chỉ xuất hiện trong phản chiếu.

    Tấm không gắn vào pivot, nên khi máy xoay các vệt sáng quét dọc thân máy.
    """
    h = height
    specs = [
        # (tên, vị trí theo bội số h, kích thước (x, y), độ sáng emission)
        ("CardKey", (-1.9, 2.2, 1.5), (3.0 * h, 3.8 * h), 5.0),
        ("CardTop", (0.2, 1.2, 3.0), (2.6 * h, 2.6 * h), 3.5),
        # dải hẹp cao: vệt sáng dọc sắc nét chạy trên viền titanium
        ("CardEdge", (-2.5, 0.7, 0.2), (0.14 * h, 4.2 * h), 14.0),
        # tấm tối: tạo vùng tối tương phản, thứ làm kim loại "có khối"
        ("CardDark", (2.7, 1.2, 0.1), (3.2 * h, 4.2 * h), 0.0),
    ]
    target = bpy.data.objects.new("CardTarget", None)
    bpy.context.collection.objects.link(target)
    target.location = center

    cards = []
    for name, mult, size, emission in specs:
        mesh = bpy.data.meshes.new(name)
        ob = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(ob)
        sx, sy = size[0] / 2.0, size[1] / 2.0
        mesh.from_pydata(
            [(-sx, -sy, 0), (sx, -sy, 0), (sx, sy, 0), (-sx, sy, 0)], [], [(0, 1, 2, 3)]
        )
        mesh.update()

        mat = bpy.data.materials.new(f"{name}Mat")
        nt, out = _fresh(mat)
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Color"].default_value = (1, 1, 1, 1)
        e.inputs["Strength"].default_value = emission * strength
        nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
        mesh.materials.append(mat)

        ob.location = center + Vector((mult[0] * h, mult[1] * h, mult[2] * h))
        con = ob.constraints.new("TRACK_TO")
        con.target = target
        con.track_axis = "TRACK_NEGATIVE_Z"
        con.up_axis = "UP_Y"

        ob.visible_camera = False
        ob.visible_diffuse = False
        ob.visible_shadow = False
        ob.visible_glossy = True
        cards.append(ob)
    return cards


# --------------------------------------------------------------------------- scene


def build(hdri, screen_img, engine="cycles", res=(1080, 1440), samples=None,
          world_strength=1.0, reflector_strength=0.0, hdri_rotation=0.0):
    """Dựng scene một lần rồi áp cấu hình — lớp bọc tương thích ngược.

    Với worker thường trực, gọi build_once() một lần rồi dùng các setter thay vì gọi
    lại hàm này: dựng lại scene tốn 0.07 s nhưng khởi động Blender tốn ~1.4 s.
    """
    s = build_once(engine=engine, res=res, samples=samples,
                   reflector_strength=reflector_strength)
    set_screen_image(s, screen_img)
    set_hdri(s, hdri)
    set_world(s, strength=world_strength, rotation=hdri_rotation)
    return s


# --------------------------------------------------------------------------- setters


def set_screen_image(s, path):
    """Đổi ảnh app trên màn hình. Ảnh đã nạp được tái sử dụng."""
    cache = s["_img_cache"]
    if path not in cache:
        cache[path] = bpy.data.images.load(path)
        cache[path].colorspace_settings.name = "sRGB"
    s["screen_tex"].image = cache[path]
    return s


def set_screen_sequence(s, first_path, frames, start=1):
    """Dán một DẢI ảnh lên màn hình: khung đầu rơi vào frame timeline `start`.

    Đây là cách "vừa animate device vừa phát video trên màn hình" mà KHÔNG cần plate. Plate
    khoá cứng vào một góc camera nên nó vô dụng khi device đang xoay; còn lúc device xoay thì
    ta đã trả tiền một lần render mỗi frame rồi, nên đổi ảnh màn hình theo frame là miễn phí
    (đo được: 97 ms/frame với dải vs 105 ms/frame với ảnh tĩnh — xem bench_screen_sequence.py).

    Hai điều ĐÃ ĐO về hành vi ngoài phạm vi dải (probe_clip_range.py):
      - sau khi hết dải, Blender giữ khung CUỐI — đúng ý muốn, không phải làm gì;
      - TRƯỚC `start`, Blender hiện màu magenta "thiếu texture", KHÔNG giữ khung đầu.
    Nên phần trước `start` phải render bằng một ảnh tĩnh; phía gọi lo việc chia lượt
    (`renderChunks` ở TS). Hàm này chỉ dùng cho phần từ `start` trở đi.

    `first_path` phải là khung ĐẦU TIÊN của dải; Blender suy ra các khung sau theo số thứ tự
    trong tên file.
    """
    if not os.path.exists(first_path):
        raise FileNotFoundError(f"thiếu khung đầu của dải màn hình: {first_path}")

    # KHÔNG dùng `_img_cache`: một datablock `SEQUENCE` mang theo trạng thái frame, còn cache
    # kia dành cho ảnh tĩnh chia sẻ được. Trộn hai loại là để một lần dùng ảnh tĩnh làm hỏng
    # cấu hình dải, hoặc ngược lại.
    key = ("__seq__", first_path)
    cache = s["_img_cache"]
    if key not in cache:
        image = bpy.data.images.load(first_path)
        image.source = "SEQUENCE"
        image.colorspace_settings.name = "sRGB"
        cache[key] = image
    image = cache[key]
    s["screen_tex"].image = image

    user = s["screen_tex"].image_user
    user.frame_duration = int(frames)
    user.frame_start = int(start)
    user.frame_offset = 0
    # Không lặp: hết video thì giữ khung cuối. Mặc định của Blender đổi giữa các phiên bản
    # nên phải đặt tường minh.
    user.use_cyclic = False
    user.use_auto_refresh = True

    _assert_sequence_usable(s, first_path, int(start), int(frames))
    return s


def _sequence_file(first_path, index):
    """Tên file thứ `index` (1-based) của dải, suy từ số thứ tự trong tên khung đầu.

    Blender suy các khung sau theo đúng quy ước này, nên dùng lại nó để KIỂM sự tồn tại của
    file là kiểm đúng thứ Blender sẽ đi tìm.
    """
    directory, name = os.path.split(first_path)
    stem, ext = os.path.splitext(name)
    digits = ""
    while stem and stem[-1].isdigit():
        digits = stem[-1] + digits
        stem = stem[:-1]
    if not digits:
        raise ValueError(f"tên khung đầu không có số thứ tự: {first_path}")
    base = int(digits) + (index - 1)
    return os.path.join(directory, f"{stem}{base:0{len(digits)}d}{ext}")


def _assert_sequence_usable(s, first_path, start, frames):
    """Dải phải có ĐỦ file và `frame_duration` phải đúng như vừa đặt.

    Vì sao cần rào chắn: dự án vừa mất ba vòng cho một bẫy cùng loại (action thiếu slot ở
    Blender 4.4+, xem `anim.py`) — cấu hình *trông như* đã áp mà render ra sai, không một
    dòng lỗi. Ở đây hai thứ dễ sai lặng lẽ là `frame_duration = 0` (Blender dán một khung
    duy nhất cho cả clip) và dải bị TRÍCH THIẾU file (Blender dán màu magenta "thiếu
    texture" — đã đo ở probe_clip_range.py).

    KHÔNG dùng `Image.filepath_from_user()` để kiểm dải có nhích theo frame hay không: trong
    chế độ `-b` nó trả cùng một đường dẫn cho mọi frame (đo được: frame 3 và 4 đều ra
    `scr_0000.png`) trong khi render thực tế lại đúng. Đó là dụng cụ đo sai, không phải lỗi.
    Việc dải có nhích thật hay không do test integration đọc PIXEL chứng minh.
    """
    user = s["screen_tex"].image_user
    if user.frame_duration != frames:
        raise RuntimeError(
            f"frame_duration không nhận giá trị vừa đặt: {user.frame_duration} thay vì {frames}"
        )
    if frames < 1:
        raise ValueError(f"dải màn hình phải có ít nhất một khung, nhận {frames}")

    last = _sequence_file(first_path, frames)
    if not os.path.exists(last):
        raise FileNotFoundError(
            f"dải màn hình thiếu khung cuối: {last} (khai {frames} khung, bắt đầu "
            f"{first_path}). Blender sẽ dán màu magenta 'thiếu texture' cho phần thiếu."
        )
    # `start` chỉ ghi lại để thông báo lỗi có ngữ cảnh; nó không ràng buộc gì ở đây.
    return start


def set_hdri(s, path):
    """Đổi HDRI. Blender nạp lazy nên bộ nhớ đệm chỉ tiết kiệm chút ít."""
    cache = s["_img_cache"]
    if path not in cache:
        cache[path] = bpy.data.images.load(path)
    s["world_nodes"]["env"].image = cache[path]
    return s


def set_world(s, strength=None, rotation=None):
    """Cường độ và góc xoay môi trường."""
    if strength is not None:
        s["world_nodes"]["background"].inputs["Strength"].default_value = strength
    if rotation is not None:
        s["world_nodes"]["mapping"].inputs["Rotation"].default_value[2] = math.radians(rotation)
    return s


def set_quality(s, engine=None, res=None, samples=None):
    """Đổi engine / độ phân giải / samples mà không dựng lại scene."""
    sc = bpy.context.scene
    if res is not None:
        sc.render.resolution_x, sc.render.resolution_y = res
    if engine is not None:
        _apply_engine(sc, engine, samples)
        # EEVEE không có shadow catcher -> ẩn tấm này, nếu không nó thành mặt xám đặc
        s["plane"].hide_render = engine != "cycles"
        s["engine"] = engine
    elif samples is not None:
        _apply_engine(sc, s["engine"], samples)
    return s


def _apply_engine(sc, engine, samples):
    if engine == "cycles":
        sc.render.engine = "CYCLES"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        sc.cycles.device = "GPU"
        sc.cycles.samples = samples or 128
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    else:
        sc.render.engine = "BLENDER_EEVEE_NEXT"  # định danh của Blender 4.2+
        sc.eevee.taa_render_samples = samples or 64
        sc.eevee.use_raytracing = True
        sc.eevee.ray_tracing_options.resolution_scale = "1"


def device_bottom_z(s):
    """Điểm thấp nhất của thiết bị trong toạ độ thế giới, mét.

    Dùng 8 góc bound_box của từng object: bound_box là hộp CỤC BỘ nên sau khi xoay,
    min over 8 góc là bao ngoài của mesh — có thể cao hơn mesh thật một chút, nên máy
    sẽ hở khỏi mặt phẳng chứ không bao giờ cắm xuống. Sai theo chiều an toàn.
    """
    bpy.context.view_layer.update()
    return min(
        (ob.matrix_world @ Vector(corner)).z
        for ob in s["device_objs"]
        for corner in ob.bound_box
    )


def set_device_pose(s, spin_x=0.0, spin_y=0.0, spin_z=0.0, ground=True):
    """Xoay thiết bị quanh tâm; `ground=True` thì hạ nó xuống đúng chạm mặt phẳng.

    Trả về độ nâng (mét) đã áp. Người gọi phải cộng số này vào target_z_offset của
    camera, nếu không thiết bị trôi lên khỏi giữa khung khi nghiêng.

    Vì sao phải bù: pivot ở TÂM máy, nên nghiêng quanh x/y làm góc máy chọc xuống dưới
    mặt phẳng. Không bù thì ở chế độ "đứng trên mặt phẳng" máy cắm xuyên sàn — đúng
    thứ dễ lọt vì ở EEVEE mặt phẳng bị ẩn, mắt không thấy gì sai cho tới bản Cycles.
    """
    pivot = s["pivot"]
    pivot.rotation_euler = (
        math.radians(spin_x),
        math.radians(spin_y),
        math.radians(spin_z),
    )
    pivot.location = s["center"]
    lift = 0.0
    if ground:
        lift = s["plane_z"] - device_bottom_z(s)
        pivot.location.z = s["center"].z + lift
        bpy.context.view_layer.update()
    s["lift"] = lift
    return lift


def clear_animation(s):
    """Xoá mọi F-Curve — worker phải gọi trước khi áp animation mới."""
    for owner in ("pivot", "orbit_az", "orbit_el", "cam"):
        ob = s[owner]
        if ob.animation_data:
            ob.animation_data_clear()
    if s["cam"].data.animation_data:
        s["cam"].data.animation_data_clear()
    nt = bpy.context.scene.world.node_tree
    if nt.animation_data:
        nt.animation_data_clear()
    return s


# --------------------------------------------------------------------------- build


def build_once(engine="cycles", res=(1080, 1440), samples=None, reflector_strength=0.0):
    """Dựng toàn bộ scene. Ảnh màn hình và HDRI đặt sau bằng setter."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)

    # model có nhiều UV layer rác đã collapse -> phải chỉ định tường minh
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data.uv_layers:
            uv = ob.data.uv_layers.get("UVMap") or ob.data.uv_layers[0]
            uv.active_render = True
            ob.data.uv_layers.active = uv

    screen_tex = _shade_all(None)

    # _add_inlay_thickness() có sẵn nhưng KHÔNG áp mặc định: dập nổi logo lên làm nó
    # trông như logo nổi thay vì khảm phẳng với kính. Bật lại nếu cần.

    device_objs = [ob for ob in bpy.data.objects if ob.type == "MESH"]
    pts = [ob.matrix_world @ Vector(v) for ob in device_objs for v in ob.bound_box]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    center = (lo + hi) / 2
    height = hi.z - lo.z

    # pivot ở tâm máy: xoay object chứ không xoay camera, để phản chiếu HDRI đổi đúng.
    # glTF import dựng sẵn cây empty -> phải gắn các node GỐC vào pivot, không phải
    # từng mesh (mesh đều đã có parent nên vòng lặp theo mesh sẽ không gắn được gì).
    roots = [ob for ob in bpy.data.objects if ob.parent is None]
    pivot = bpy.data.objects.new("Pivot", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = center
    # tính thẳng bằng Matrix.Translation: pivot.matrix_world lúc này chưa được
    # depsgraph cập nhật, đọc nó sẽ ra ma trận đơn vị và làm lệch cả model
    for ob in roots:
        ob.parent = pivot
        ob.matrix_parent_inverse = Matrix.Translation(-center)

    # shadow catcher không được parent vào pivot, nếu không nó xoay theo
    bpy.ops.mesh.primitive_plane_add(size=height * 8, location=(center.x, center.y, lo.z))
    plane = bpy.context.active_object
    plane.name = "ShadowCatcher"
    # EEVEE Next không hỗ trợ shadow catcher: nó render tấm này thành mặt xám đặc
    # và phá nền alpha, nên ẩn hẳn ở tầng draft. Bóng đổ chỉ có ở bản Cycles.
    plane.is_shadow_catcher = True
    plane.hide_render = engine != "cycles"

    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    wnt = world.node_tree
    wnt.nodes.clear()
    env = wnt.nodes.new("ShaderNodeTexEnvironment")
    env.name = "EnvTex"
    # Xoay HDRI quanh Z: quyết định vùng nào của môi trường rơi vào hướng phản chiếu
    # của các mặt gương (logo, viền). Mặt gương chỉ lấy mẫu MỘT hướng, nên nếu hướng
    # đó trúng vùng trắng trơn thì nó trả về xám phẳng bất kể vật liệu đặt thế nào.
    texco = wnt.nodes.new("ShaderNodeTexCoord")
    mapping = wnt.nodes.new("ShaderNodeMapping")
    mapping.name = "EnvMapping"
    mapping.inputs["Rotation"].default_value[2] = 0.0
    wnt.links.new(texco.outputs["Generated"], mapping.inputs["Vector"])
    wnt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    bg = wnt.nodes.new("ShaderNodeBackground")
    bg.name = "EnvBackground"
    bg.inputs["Strength"].default_value = 1.0
    wout = wnt.nodes.new("ShaderNodeOutputWorld")
    wnt.links.new(env.outputs["Color"], bg.inputs["Color"])
    wnt.links.new(bg.outputs["Background"], wout.inputs["Surface"])

    if reflector_strength > 0:
        _add_reflection_cards(center, height, reflector_strength)

    target = bpy.data.objects.new("Target", None)
    bpy.context.collection.objects.link(target)
    target.location = center

    # Rig quỹ đạo: azimuth / elevation / distance trở thành THUỘC TÍNH THẬT của
    # object, nhờ đó keyframe được với đầy đủ F-Curve (bezier, easing, modifier).
    # Rig cho kết quả trùng khít công thức cũ (đã đo: lệch 0.000 mm).
    orbit_az = bpy.data.objects.new("OrbitAzimuth", None)
    bpy.context.collection.objects.link(orbit_az)
    orbit_az.location = center
    orbit_el = bpy.data.objects.new("OrbitElevation", None)
    bpy.context.collection.objects.link(orbit_el)
    orbit_el.parent = orbit_az

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = FOCAL_MM
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = SENSOR_MM
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.parent = orbit_el  # vị trí cục bộ (0, distance, 0) trong rig
    bpy.context.scene.camera = cam
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    _apply_engine(sc, engine, samples)

    return {
        "engine": engine,
        "screen_tex": screen_tex,
        "_img_cache": {},
        "pivot": pivot,
        "cam": cam,
        "orbit_az": orbit_az,
        "orbit_el": orbit_el,
        "target": target,
        "world_nodes": {"env": env, "mapping": mapping, "background": bg},
        "center": center,
        "height": height,
        "dist": None,
        "plane": plane,
        "plane_z": lo.z,
        "device_objs": device_objs,
        "lift": 0.0,
    }


def distance_for_frame_fill(s, frame_fill):
    """frame_fill (phần chiều dọc khung hình mà máy chiếm) -> khoảng cách camera, mét."""
    return (s["height"] / frame_fill) * FOCAL_MM / SENSOR_MM


def frame_fill_for_distance(s, dist):
    """Nghịch đảo của distance_for_frame_fill()."""
    return (s["height"] * FOCAL_MM) / (dist * SENSOR_MM)


def place_camera(s, azimuth_deg, elevation_deg, frame_fill=0.72, target_z_offset=0.0):
    """Đặt camera tĩnh qua rig quỹ đạo.

    Giữ nguyên chữ ký cũ để các script hiện có không phải sửa. Giờ chỉ là đặt giá
    trị cho ba kênh của rig thay vì tính thẳng toạ độ.
    """
    dist = distance_for_frame_fill(s, frame_fill)
    focus = s["center"] + Vector((0.0, 0.0, target_z_offset))
    s["target"].location = focus
    s["orbit_az"].location = focus
    # dấu âm: rig xoay ngược chiều so với quy ước azimuth cũ, giữ cho các preset góc
    # (front:0, tq:32, back:180...) vẫn ra đúng hình như trước
    s["orbit_az"].rotation_euler[2] = math.radians(-azimuth_deg)
    s["orbit_el"].rotation_euler[0] = math.radians(elevation_deg)
    s["cam"].location = (0.0, dist, 0.0)
    bpy.context.view_layer.update()
    s["dist"] = dist
    return dist
