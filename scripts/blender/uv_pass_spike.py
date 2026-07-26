"""Spike Pha 2.5 — UV pass: EXR float32 so với PNG 16-bit.

Câu hỏi cần trả lời: nếu server gửi UV pass sang client dưới dạng PNG 16-bit thay vì
EXR float32, phép tra cứu `(u,v)` trong shader còn lệch dưới một pixel không?

Cách đo: render UV pass MỘT lần ra EXR 32-bit (coi là sự thật), rồi lượng tử hoá chính
những pixel đó về 16-bit và 8-bit, so lại bằng đơn vị pixel của ảnh màn hình. Đo trên
cùng một lần render nên khác biệt duy nhất là độ sâu bit — không lẫn nhiễu sampling.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/uv_pass_spike.py -- out/uv_spike

Ghi ra `<prefix>.exr`, `<prefix>_16.png` (tự encode), `<prefix>_blender16.png`
(Blender encode) và in bảng sai số.
"""

import os
import struct
import sys
import zlib

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene_lib  # noqa: E402

PREFIX = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
RES = (720, 960)

# Kích thước ảnh app thật trên màn hình iPhone 17 Pro Max. Sai số UV chỉ có nghĩa khi
# quy về pixel của ảnh NÀY: 1/65535 nghe nhỏ, nhưng phải nhân với 2556 mới biết nhỏ thật.
SCREEN_W, SCREEN_H = 1179, 2556


def _uv_material():
    """Material phát ra chính toạ độ UV thành màu: u -> R, v -> G."""
    mat = bpy.data.materials.new("UVPass")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    uv = nt.nodes.new("ShaderNodeUVMap")
    # để trống uv_map -> dùng layer active_render, chính là layer build_once() đã chọn.
    # Chỉ định tên tay ở đây sẽ âm thầm lệch khỏi layer mà ảnh màn hình đang dùng.
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(uv.outputs["UV"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def render_uv_pass():
    s = scene_lib.build_once(engine="eevee", res=RES, samples=1)
    scene_lib.place_camera(s, azimuth_deg=20, elevation_deg=12, frame_fill=0.72)

    screen_objs = [
        ob
        for ob in bpy.data.objects
        if ob.type == "MESH"
        and any(sl.material and "Screen" in sl.material.name for sl in ob.material_slots)
    ]
    if not screen_objs:
        raise SystemExit("không tìm thấy mesh màn hình")

    # Chỉ giữ mesh màn hình: thân máy và kính phủ che mất UV hoặc pha màu vào nó. Mặt
    # nạ che khuất là việc của Pha 5, không phải câu hỏi của spike này.
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            ob.hide_render = ob not in screen_objs
    mat = _uv_material()
    for ob in screen_objs:
        ob.data.materials.clear()
        ob.data.materials.append(mat)

    sc = bpy.context.scene
    # Raw: UV là DỮ LIỆU, không phải màu. Để AgX thì tone map sẽ bóp giá trị và toàn bộ
    # phép đo này thành vô nghĩa trong khi ảnh vẫn "trông như UV".
    sc.view_settings.view_transform = "Raw"
    sc.render.film_transparent = True
    sc.render.filter_size = 0.0  # tắt lọc pixel: UV nội suy qua mép cho ra giá trị lai
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.exr_codec = "ZIP"
    sc.render.filepath = PREFIX + ".exr"
    bpy.ops.render.render(write_still=True)

    # Đọc lại từ file chứ không lấy từ bộ đệm render: đây là đúng thứ server sẽ gửi đi.
    img = bpy.data.images.load(PREFIX + ".exr")
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return sc, img, px


def write_png16(path, rgba16):
    """PNG 16-bit RGBA viết tay.

    Tự encode thay vì nhờ Blender vì đường của Blender đi qua color management; ở đây
    cần đúng từng bit của mảng đưa vào, và phía server cũng sẽ encode kiểu này.
    """
    h, w = rgba16.shape[:2]
    raw = b"".join(b"\x00" + rgba16[y].astype(">u2").tobytes() for y in range(h))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 16, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))


def read_png16(path):
    """Giải mã lại PNG vừa viết — không tin vào encoder của chính mình."""
    data = open(path, "rb").read()
    pos, w, h, depth, idat = 8, 0, 0, 0, b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if tag == b"IHDR":
            w, h, depth = struct.unpack(">IIB", body[:9])
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length
    assert depth == 16, depth
    raw = zlib.decompress(idat)
    bpp = 8  # RGBA 16-bit = 8 byte mỗi pixel
    stride = w * bpp
    # Phải bỏ lọc theo từng dòng: encoder của Blender dùng Sub/Up/Average/Paeth. Bỏ qua
    # byte lọc và đọc thẳng cho ra ảnh rác mà vẫn giải mã "thành công" — lần đầu viết
    # hàm này tôi đã tin con số rác đó.
    out = np.zeros((h, stride), dtype=np.int64)
    for y in range(h):
        ft = raw[y * (stride + 1)]
        line = np.frombuffer(raw[y * (stride + 1) + 1 : (y + 1) * (stride + 1)], dtype=np.uint8)
        cur = line.astype(np.int64).copy()
        up = out[y - 1] if y > 0 else np.zeros(stride, dtype=np.int64)
        if ft == 0:
            pass
        elif ft == 2:
            cur = (cur + up) & 0xFF
        else:
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0
                b = up[x]
                c = up[x - bpp] if x >= bpp else 0
                if ft == 1:
                    pred = a
                elif ft == 3:
                    pred = (a + b) // 2
                elif ft == 4:
                    p = a + b - c
                    pred = min((a, b, c), key=lambda v: abs(p - v))
                else:
                    raise ValueError(f"filter {ft} chưa hỗ trợ")
                cur[x] = (cur[x] + pred) & 0xFF
        out[y] = cur
    return out.astype(np.uint8).view(">u2").reshape(h, w, 4).astype(np.uint16)


def error_px(uv_true, uv_test, mask):
    """Sai số quy về pixel của ảnh màn hình."""
    d = np.abs(uv_test - uv_true)[mask]
    dx = d[:, 0] * SCREEN_W
    dy = d[:, 1] * SCREEN_H
    worst = np.maximum(dx, dy)
    return worst.mean(), worst.max()


def main():
    sc, img, px = render_uv_pass()
    h, w = px.shape[:2]
    alpha = px[:, :, 3]
    uv_true = px[:, :, :2]

    # Chỉ pixel bên trong hẳn: mép có alpha lẻ là pixel pha, UV ở đó vốn đã là giá trị
    # lai giữa màn hình và nền — lỗi ở đó không phải lỗi lượng tử hoá.
    mask = alpha > 0.999
    n = int(mask.sum())
    lo, hi = float(uv_true[mask].min()), float(uv_true[mask].max())

    quant16 = np.round(np.clip(px, 0.0, 1.0) * 65535.0).astype(np.uint16)
    write_png16(PREFIX + "_16.png", quant16)
    uv16 = read_png16(PREFIX + "_16.png")[:, :, :2].astype(np.float64) / 65535.0

    # Đường của Blender: cùng dữ liệu, nhưng qua color management của nó.
    img.filepath_raw = PREFIX + "_blender16.png"
    img.file_format = "PNG"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "16"
    img.save_render(PREFIX + "_blender16.png", scene=sc)
    # `img.pixels` chạy từ DƯỚI lên, PNG lưu từ TRÊN xuống. Không lật thì sai số đo ra
    # ~1255 px và trông y như "PNG 16-bit không đủ chính xác" — kết luận sai hoàn toàn.
    uvb = read_png16(PREFIX + "_blender16.png")[::-1, :, :2].astype(np.float64) / 65535.0

    # 8-bit không phải phương án ai chọn — nó là điều XẢY RA nếu client nạp PNG qua
    # <img>/ImageBitmap rồi texImage2D: trình duyệt hạ 16-bit xuống 8-bit không báo gì.
    uv8 = np.round(np.clip(px[:, :, :2], 0, 1) * 255.0) / 255.0

    # Cách vòng qua giới hạn đó: tách mỗi kênh 16-bit thành hai byte và gửi bằng PNG
    # 8-bit. Trình duyệt giải mã kiểu gì cũng giữ nguyên byte, shader ghép lại. Ở đây
    # chỉ kiểm phép ghép có đúng không — cách xếp texture để Pha 5 quyết.
    q = np.round(np.clip(px[:, :, :2], 0, 1) * 65535.0).astype(np.uint32)
    byte_hi = (q >> 8).astype(np.uint8).astype(np.float64)
    byte_lo = (q & 0xFF).astype(np.uint8).astype(np.float64)
    uv_split = (byte_hi * 256.0 + byte_lo) / 65535.0

    print("\n### UV pass spike")
    print(f"render      {w}x{h}, {n} pixel màn hình đặc")
    print(f"UV range    [{lo:.6f}, {hi:.6f}]  (ngoài [0,1] sẽ bị PNG cắt)")
    print(f"tham chiếu  ảnh màn hình {SCREEN_W}x{SCREEN_H}")
    print(f"\n{'đường':<28}{'lệch tb (px)':>14}{'lệch max (px)':>15}")
    for name, uv in (
        ("PNG 16-bit (tự encode)", uv16),
        ("PNG 16-bit (Blender)", uvb),
        ("2×8-bit ghép byte", uv_split),
        ("8-bit (browser hạ bit)", uv8),
    ):
        mean, mx = error_px(uv_true, uv, mask)
        print(f"{name:<28}{mean:>14.4f}{mx:>15.4f}")

    # Với view_transform = Raw, đường của Blender KHÔNG bọc sRGB — kiểm luôn để nếu ai
    # đổi view transform về AgX thì con số này nổ lên thay vì lặng lẽ sai.
    u = np.clip(uv_true, 0, 1)
    srgb = np.where(u <= 0.0031308, u * 12.92, 1.055 * np.power(u, 1 / 2.4) - 0.055)
    print(f"\nkiểm color management: |B16 - sRGB(uv)| tb = {np.abs(uvb - srgb)[mask].mean():.4f}")
    print("  (lớn = tốt: nghĩa là KHÔNG bị bọc sRGB)")

    mean16, max16 = error_px(uv_true, uv16, mask)
    print(f"\nNGƯỠNG < 1.0 px: {'ĐẠT' if max16 < 1.0 else 'KHÔNG ĐẠT'} (max {max16:.4f} px)")
    print(f"mean16={mean16:.6f}")


main()
