"""Plate: bộ buffer render MỘT lần để client ghép video vào màn hình bằng WebGL (Pha 5).

Ý tưởng: video 30fps không thể round-trip qua Blender. Nên Blender chỉ render **một** lần ở
góc đang chọn, ra bốn buffer, rồi client (và cả đường export) ghép bằng đúng một shader.

    base.bin    ảnh máy khi màn hình TẮT — đã có phản chiếu kính, bóng đổ. scene-linear, RGB half
    t.bin       TOÁN TỬ TRUYỀN: đóng góp của màn hình khi nó trắng toàn phần. scene-linear, RGB half
    alpha.bin   silhouette có khử răng cưa, kèm contact shadow. half
    uv.bin      toạ độ màn hình (u, v) + cờ hợp lệ. float32

Phép ghép, chạy y hệt ở preview lẫn export:

    lin = base + T × video_tuyến_tính(u, v)
    ra  = agx(lin / alpha)

## Vì sao ghép trong không gian TUYẾN TÍNH

Vận chuyển ánh sáng là tuyến tính theo bức xạ phát ra: ảnh cuối = (nền khi màn hình tắt) +
(toán tử truyền) × (bức xạ màn hình). Đây là phương trình vận chuyển, **là định lý chứ không
phải xấp xỉ** — nhưng nó chỉ đúng trong không gian tuyến tính. Ảnh PNG mà Blender ghi ra đã
qua tone map AgX, và **AgX không nghịch đảo được** (Blender phải bake một LUT nghịch riêng, và
chỉ cho Rec.2020). Nên mọi thiết kế "đưa ảnh AgX về tuyến tính rồi ghép" là đường cụt; phải
lấy dữ liệu tuyến tính từ đầu và áp AgX ở bước cuối cùng.

Đo so với render Blender đầy đủ (thang 0-255):

    ghép tuyến tính (bản này)      0.16 - 0.95    <- dưới nền nhiễu Monte Carlo của Blender
    nội suy sRGB (bản 5a cũ)      12.9  - 46.6

Bản 5a cũ chọn nhầm vì **đo bằng ảnh test đen-trắng**: đen và trắng là hai đầu mút, nơi mọi
phép nội suy đúng theo định nghĩa. Xem PRD §7, "đo sai kích thích".

## Vì sao chỉ cần MỘT render, và chỉ cần màn hình TRẮNG

Light group của Cycles tách được đóng góp của riêng màn hình ra một AOV, nên `base` và `T` ra
cùng một lần render: `base = Image − Combined_screen`, `T = Combined_screen`.

Không cần render R/G/B riêng: toán tử truyền là **đường chéo theo kênh** — màn hình đỏ thuần
cho kênh G, B đúng bằng 0. Ba render trả về đúng ba con số đã nằm sẵn trong một render trắng.

## Giới hạn đã biết, ghi ra để không phải phát hiện lại

- **Light group là tính năng của Cycles.** EEVEE Next không có, dù `lightgroups.add()` vẫn chạy
  trót lọt và socket `Combined_screen` vẫn xuất hiện. Tầng draft EEVEE vì thế là một xấp xỉ
  KHÁC, không phải cùng một thứ chạy nhanh hơn.
- **Phần hắt sáng (spill) là số hạng duy nhất còn xấp xỉ.** Ánh sáng màn hình hắt ra thân máy
  phụ thuộc TOÀN BỘ ảnh màn hình chứ không phải một texel, nên shader xấp xỉ nó bằng màu trung
  bình của frame (hạng 1). Đây là xấp xỉ tần số thấp, sai số đo được ~0.5/255.
- **Kính phủ bị ẩn khi render UV**, nên plate bỏ qua khúc xạ của kính. Đã đo đường có kính:
  thêm 1242 px giả vào mặt nạ và kênh B vọt lên 3.26 — tức khúc xạ làm hỏng giả định "nhìn
  thẳng qua UV là ánh xạ 1-1". Ẩn kính là lựa chọn đúng, không phải cẩu thả.
"""

import os

import bpy
import numpy as np

import buffers

# Tên light group. Gõ nhầm KHÔNG raise (xem `_assert_lightgroup`), nên chỉ được viết ở đây.
LIGHTGROUP = "screen"

# Vật liệu kính phủ: phải ẩn khi render UV, nếu không nó phủ lên và pha màu vào toạ độ.
_GLASS_MATERIALS = ("color3", "glass")


def _material_names(ob):
    return {
        (sl.material.name.replace("17ProMax_", "") if sl.material else "")
        for sl in ob.material_slots
    }


def screen_objects():
    """Mesh có vật liệu màn hình. Đây là mặt duy nhất mang UV mà ta cần."""
    return [
        ob
        for ob in bpy.data.objects
        if ob.type == "MESH" and any(n == "Screen" for n in _material_names(ob))
    ]


def _glass_objects():
    return [
        ob
        for ob in bpy.data.objects
        if ob.type == "MESH" and _material_names(ob) & set(_GLASS_MATERIALS)
    ]


def _screen_shader(s):
    """Node tree và node Principled của vật liệu màn hình."""
    nt = s["screen_tex"].id_data
    return nt, next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")


def _uv_material():
    """Material phát ra chính toạ độ UV thành màu: u -> R, v -> G."""
    mat = bpy.data.materials.get("__UVPass") or bpy.data.materials.new("__UVPass")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    uv = nt.nodes.new("ShaderNodeUVMap")
    # Để trống uv_map -> dùng layer active_render, đúng layer mà ảnh màn hình đang dùng.
    # Gõ tên layer bằng tay ở đây sẽ âm thầm lệch khỏi layer thật.
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(uv.outputs["UV"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


# ------------------------------------------------------------------ đọc ảnh đã render


def _load_pixels(path):
    """Đọc file ảnh về mảng float32 (h, w, 4), dòng đầu là dòng TRÊN.

    Đọc lại từ file chứ không lấy từ 'Render Result': bộ đệm đó không đọc được ở chế độ nền —
    `size` trả về (0, 0) và `pixels` trả về mảng rỗng, **không báo lỗi**.
    """
    img = bpy.data.images.load(path)
    try:
        w, h = img.size
        if w == 0 or h == 0:
            raise RuntimeError(f"{path}: đọc ra ảnh 0×0")
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    finally:
        bpy.data.images.remove(img)
    # `img.pixels` chạy từ DƯỚI lên, file lưu từ TRÊN xuống. Quên lật thì mọi phép đo vẫn ra
    # số đẹp và kết luận sai hoàn toàn — spike Pha 2.5 đã sập đúng chỗ này.
    return px[::-1]


# ------------------------------------------------------------------ pass ánh sáng


def _setup_lightgroup(s):
    """Gán mọi mesh màn hình vào light group, và nối compositor để ghi AOV ra file."""
    view = bpy.context.view_layer
    if LIGHTGROUP not in {lg.name for lg in view.lightgroups}:
        view.lightgroups.add(name=LIGHTGROUP)
    for ob in screen_objects():
        ob.lightgroup = LIGHTGROUP


def _render_light_passes(s, out_dir, denoise=True):
    """Một render Cycles, màn hình ép trắng. Trả về (image, screen) dạng mảng float32."""
    sc = bpy.context.scene
    nt, principled = _screen_shader(s)
    emit_in = principled.inputs["Emission Color"]

    saved = {
        "engine": sc.render.engine,
        "file_format": sc.render.image_settings.file_format,
        "color_depth": sc.render.image_settings.color_depth,
        "color_mode": sc.render.image_settings.color_mode,
        "filepath": sc.render.filepath,
        # `sc.node_tree` chỉ đọc nên không lưu/trả lại được — plate là chỗ DUY NHẤT trong dự
        # án dùng compositor, và nó dựng lại cây từ đầu mỗi lần nên không có gì để giữ.
        "use_nodes": sc.use_nodes,
        "denoising": sc.cycles.use_denoising,
        "emit_link": emit_in.links[0].from_socket if emit_in.links else None,
        "emit_color": list(emit_in.default_value),
    }
    try:
        sc.render.engine = "CYCLES"
        sc.cycles.use_denoising = denoise
        _setup_lightgroup(s)

        # Ép màn hình trắng nhưng GIỮ NGUYÊN `Emission Strength` (1.6): nhờ vậy hệ số đó nằm
        # sẵn trong T, và biến mà shader nhân vào là giá trị video tuyến tính thuần trong [0,1].
        if saved["emit_link"] is not None:
            nt.links.remove(emit_in.links[0])
        emit_in.default_value = (1.0, 1.0, 1.0, 1.0)

        # EXR: Blender bỏ qua hoàn toàn view transform khi ghi EXR, nên dữ liệu ra là
        # scene-linear mà không cần đụng `view_settings` (giữ AgX cho các đường khác).
        sc.render.image_settings.file_format = "OPEN_EXR"
        sc.render.image_settings.color_depth = "32"
        sc.render.image_settings.color_mode = "RGBA"
        sc.render.image_settings.exr_codec = "ZIP"

        sc.use_nodes = True
        tree = sc.node_tree
        tree.nodes.clear()
        rl = tree.nodes.new("CompositorNodeRLayers")
        out = tree.nodes.new("CompositorNodeOutputFile")
        out.base_path = out_dir
        out.format.file_format = "OPEN_EXR"
        out.format.color_depth = "32"
        out.format.color_mode = "RGBA"
        out.file_slots.clear()
        out.file_slots.new("image")
        out.file_slots.new("screen")
        socket = f"Combined_{LIGHTGROUP}"
        if socket not in rl.outputs:
            raise RuntimeError(
                f"không có socket {socket!r} — light group là tính năng của Cycles, "
                f"engine hiện tại là {sc.render.engine}"
            )
        tree.links.new(rl.outputs["Image"], out.inputs["image"])
        tree.links.new(rl.outputs[socket], out.inputs["screen"])

        sc.frame_set(sc.frame_current)  # File Output đặt tên theo frame hiện tại
        bpy.ops.render.render(write_still=False)
    finally:
        sc.render.engine = saved["engine"]
        sc.cycles.use_denoising = saved["denoising"]
        sc.render.image_settings.file_format = saved["file_format"]
        sc.render.image_settings.color_depth = saved["color_depth"]
        sc.render.image_settings.color_mode = saved["color_mode"]
        sc.render.filepath = saved["filepath"]
        sc.use_nodes = saved["use_nodes"]
        emit_in.default_value = saved["emit_color"]
        if saved["emit_link"] is not None and not emit_in.links:
            nt.links.new(saved["emit_link"], emit_in)

    frame = f"{bpy.context.scene.frame_current:04d}"
    image = _load_pixels(os.path.join(out_dir, f"image{frame}.exr"))
    screen = _load_pixels(os.path.join(out_dir, f"screen{frame}.exr"))
    for name in ("image", "screen"):
        os.remove(os.path.join(out_dir, f"{name}{frame}.exr"))
    return image, screen


# ------------------------------------------------------------------ pass UV


def _render_uv_pixels(s, tmp_exr):
    """Render UV pass và trả về mảng float32 (h, w, 4), dòng đầu là dòng TRÊN."""
    sc = bpy.context.scene
    screens = screen_objects()
    if not screens:
        raise RuntimeError("không tìm thấy mesh màn hình")

    saved = {
        "engine": sc.render.engine,
        "view_transform": sc.view_settings.view_transform,
        "filter_size": sc.render.filter_size,
        "file_format": sc.render.image_settings.file_format,
        "color_depth": sc.render.image_settings.color_depth,
        # `color_mode` là trạng thái TOÀN CỤC của scene. Không đặt tường minh thì pass này ăn
        # theo giá trị của người khác; ai đó đổi sang "RGB" là EXR mất alpha, mặt nạ thành CẢ
        # KHUNG HÌNH, video dán đè toàn ảnh — và mọi rào chắn khác vẫn xanh. Xem PRD §7.
        "color_mode": sc.render.image_settings.color_mode,
        "taa": sc.eevee.taa_render_samples,
        "filepath": sc.render.filepath,
        "hide": {ob.name: ob.hide_render for ob in bpy.data.objects},
        "holdout": {ob.name: ob.is_holdout for ob in bpy.data.objects},
        # Gán theo TỪNG slot rồi trả lại, không `materials.clear()`: xoá slot làm
        # `material_index` của polygon trỏ trật, và mesh nhiều vật liệu sẽ hỏng câm.
        "slots": [(ob, [sl.material for sl in ob.material_slots]) for ob in screens],
    }
    glass = set(_glass_objects())
    try:
        # Gán TRỰC TIẾP vào slot, KHÔNG dùng `view_layer.material_override`: override của
        # EEVEE Next không đánh giá node UV và trả về hằng số ~0.008 mà không báo gì. Đo trên
        # chính scene này, vùng màn hình 48052 px:
        #   gán trực tiếp     R[0.000,1.000] G[0.000,0.996] B[0.000,0.000]   <- đúng
        #   material_override R[0.007,0.008] G[0.008,0.009] B[0.009,0.010]   <- rác
        # B = 0 là dấu hiệu nhận biết: UV chỉ có hai chiều nên kênh xanh dương phải đúng bằng 0.
        uv_mat = _uv_material()
        for ob in screens:
            for sl in ob.material_slots:
                sl.material = uv_mat

        # EEVEE bất kể engine đang chọn: pass này chỉ là emission, Cycles không cho thêm gì mà
        # khử nhiễu của nó còn LÀM MỜ toạ độ.
        sc.render.engine = "BLENDER_EEVEE_NEXT"
        # Raw: UV là dữ liệu. Để AgX thì tone map bóp giá trị mà ảnh vẫn "trông như UV".
        sc.view_settings.view_transform = "Raw"
        # Tắt lọc pixel: nội suy sẽ trộn UV ngang qua mép màn hình thành toạ độ lai. Kèm theo
        # đó `taa_render_samples = 1` vì khử răng cưa vô nghĩa khi filter_size = 0.
        sc.render.filter_size = 0.0
        sc.eevee.taa_render_samples = 1

        for ob in bpy.data.objects:
            if ob.type != "MESH":
                continue
            if ob in screens:
                ob.hide_render, ob.is_holdout = False, False
            elif ob in glass or ob is s["plane"]:
                ob.hide_render = True  # kính không che, tấm hứng bóng không liên quan
            else:
                # Thân máy phải HOLDOUT chứ không phải ẩn: chỗ nó che màn hình (viền, cụm
                # camera trước) phải bị đục khỏi mặt nạ. Ẩn đi thì mặt nạ nhận cả phần màn
                # hình bị che và video sẽ đè lên thân máy.
                ob.hide_render, ob.is_holdout = False, True

        sc.render.image_settings.file_format = "OPEN_EXR"
        sc.render.image_settings.color_depth = "32"
        sc.render.image_settings.color_mode = "RGBA"
        sc.render.image_settings.exr_codec = "ZIP"
        sc.render.filepath = tmp_exr
        bpy.ops.render.render(write_still=True)
    finally:
        sc.render.engine = saved["engine"]
        sc.view_settings.view_transform = saved["view_transform"]
        sc.render.filter_size = saved["filter_size"]
        sc.render.image_settings.file_format = saved["file_format"]
        sc.render.image_settings.color_depth = saved["color_depth"]
        sc.render.image_settings.color_mode = saved["color_mode"]
        sc.eevee.taa_render_samples = saved["taa"]
        sc.render.filepath = saved["filepath"]
        for ob, mats in saved["slots"]:
            for sl, mat in zip(ob.material_slots, mats):
                sl.material = mat
        for ob in bpy.data.objects:
            if ob.name in saved["hide"]:
                ob.hide_render = saved["hide"][ob.name]
                ob.is_holdout = saved["holdout"][ob.name]

    px = _load_pixels(tmp_exr)
    os.remove(tmp_exr)
    return px


# ------------------------------------------------------------------ rào chắn


def _assert_lightgroup(s, screen, mask):
    """Light group có thật sự mang dữ liệu không.

    Gõ nhầm tên (`"screeen"`) KHÔNG raise: `view_layer.lightgroups` vẫn còn `"screen"` nên
    socket vẫn tồn tại và vẫn ghi ra file — toàn số 0. Plate ra đủ file, ảnh trông bình
    thường, chỉ có điều màn hình ĐỨNG YÊN khi phát video. Nên phải kiểm **dữ liệu trong
    kênh**, không kiểm sự tồn tại của socket. Xem PRD §7.
    """
    assigned = {ob.lightgroup for ob in screen_objects()}
    if assigned != {LIGHTGROUP}:
        raise RuntimeError(f"mesh màn hình gán light group sai: {assigned!r}")
    inside = screen[:, :, :3][mask]
    if inside.size == 0:
        raise RuntimeError("mặt nạ rỗng, không kiểm được light group")
    mean = float(inside.mean())
    if mean <= 0.01:
        raise RuntimeError(
            f"light group {LIGHTGROUP!r} không mang dữ liệu (T trung bình {mean:.6f}). "
            "Engine không phải Cycles, hoặc tên light group gán cho object không khớp."
        )


def _assert_uv_pass(px, mask):
    """UV pass có đúng là toạ độ UV không."""
    if not mask.any():
        raise RuntimeError("UV pass không có pixel màn hình nào — camera trỏ sai hoặc mesh bị ẩn")
    # UV chỉ có hai chiều nên kênh xanh dương PHẢI bằng 0. Khác 0 nghĩa là pass này không
    # phải toạ độ UV — và nó vẫn ra một ảnh "trông hợp lý".
    blue = float(px[:, :, 2][mask].max())
    if blue > 1e-3:
        raise RuntimeError(f"UV pass sai: kênh B phải bằng 0, đo được {blue:.4f}")
    uv = px[:, :, :2][mask]
    lo, hi = float(uv.min()), float(uv.max())
    if lo < -1e-4 or hi > 1 + 1e-4:
        raise RuntimeError(f"UV ra ngoài [0,1]: [{lo:.4f}, {hi:.4f}] — video sẽ dán lệch")


def _assert_screen_fraction(mask, width, height):
    """Tỉ lệ vùng màn hình có nằm trong dải hợp lý không.

    Rào chắn cho đúng ca `color_mode = "RGB"`: EXR mất alpha thì mặt nạ thành 100% khung hình
    (đo thật: 34080/34080) trong khi kênh B vẫn bằng 0 và `uv_range` vẫn hợp lệ — cả hai rào
    chắn kia đều xanh.
    """
    fraction = mask.sum() / (width * height)
    if not 0.02 <= fraction <= 0.75:
        raise RuntimeError(
            f"vùng màn hình chiếm {fraction:.1%} khung hình — ngoài dải hợp lý [2%, 75%]. "
            "Thường là do EXR mất kênh alpha (color_mode) hoặc camera trỏ sai."
        )


def _assert_additive(image, screen, mask, denoise):
    """Phép phân rã `Image = base + Combined_screen` có đúng không.

    Ánh sáng không âm, nên `base` âm nghĩa là light group đang bắt NHIỀU HƠN đóng góp thật của
    màn hình — tức phân rã sai và mọi thứ dựng trên nó đều sai.

    Nhưng ngưỡng phải khác nhau theo `denoise`, vì OpenImageDenoise là **phi tuyến**: nó khử
    nhiễu `Image` và AOV riêng rẽ nên hiệu của hai bản đã khử không còn bằng bản khử của hiệu.
    Đo thật (240×320, Cycles 64 spp, T trung bình 1.587):

        denoise = False   base min **+0.001612**  — cộng tính ĐÚNG TUYỆT ĐỐI, 0 pixel âm
        denoise = True    base min  -0.193568     — 0.87% pixel âm quá 1% của T

    Nên bản `denoise=False` là bản chứng minh phân rã đúng (test integration chạy bản này), còn
    bản production chỉ cần chặn sai lệch LỚN — một lỗi double-count thật sẽ cho `base ≈ −T`,
    lệch cả bậc chứ không phải vài phần trăm.
    """
    base = image[:, :, :3] - screen[:, :, :3]
    inside = base[mask]
    scale = float(screen[:, :, :3][mask].mean()) or 1.0
    tol = 0.25 * scale if denoise else 1e-3
    worst = float(inside.min())
    if worst < -tol:
        raise RuntimeError(
            f"base = Image − Combined_screen ra ÂM ({worst:.6f}, ngưỡng −{tol:.6f}) trong lòng "
            "màn hình — light group đang bắt nhiều hơn đóng góp thật của màn hình."
        )
    if float(inside.mean()) <= 0:
        raise RuntimeError("base trung bình trong lòng màn hình ≤ 0 — phân rã sai hoàn toàn")
    # Cắt âm: bức xạ âm là vô nghĩa, và đưa xuống shader thì AgX cho ra pixel loang màu.
    return np.maximum(base, 0.0)


# ------------------------------------------------------------------ điểm vào


def render_plate(s, out_dir, denoise=True, push=4):
    """Render plate vào `out_dir`. Trả về mô tả để server gửi cho client."""
    os.makedirs(out_dir, exist_ok=True)

    uv_px = _render_uv_pixels(s, os.path.join(out_dir, "_uv.exr"))
    height, width = uv_px.shape[:2]
    # Chỉ pixel đặc mới là màn hình. Mép có alpha lẻ là pixel pha, UV ở đó đã là toạ độ lai
    # giữa màn hình và nền.
    mask = uv_px[:, :, 3] > 0.999
    _assert_uv_pass(uv_px, mask)
    _assert_screen_fraction(mask, width, height)

    image, screen = _render_light_passes(s, out_dir, denoise=denoise)
    if image.shape[:2] != (height, width):
        raise RuntimeError(f"pass UV {width}×{height} khác pass ánh sáng {image.shape[1::-1]}")
    _assert_lightgroup(s, screen, mask)
    base = _assert_additive(image, screen, mask, denoise)

    uv, pushed = buffers.push_uv(uv_px[:, :, :2], mask, iters=push)
    files = {
        "base": buffers.write_bin(os.path.join(out_dir, "base.bin"), base, "half"),
        "t": buffers.write_bin(os.path.join(out_dir, "t.bin"), screen[:, :, :3], "half"),
        "alpha": buffers.write_bin(
            os.path.join(out_dir, "alpha.bin"), image[:, :, 3:4], "half"
        ),
        "uv": buffers.write_bin(os.path.join(out_dir, "uv.bin"), uv, "float32"),
    }
    return {
        "dir": out_dir,
        "res": [width, height],
        "files": files,
        "screen_px": int(mask.sum()),
        "pushed_px": int(pushed.sum()),
        "denoised": denoise,
    }
