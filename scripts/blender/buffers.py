"""Đóng gói buffer cho trình duyệt: EXR/numpy -> file `.bin` thô.

Vì sao `.bin` thô chứ không phải ảnh: trình duyệt **không có bộ giải mã EXR**, còn PNG thì
hoặc mất dải động (8-bit) hoặc bị trình duyệt âm thầm hạ bit (16-bit qua `<img>` — spike Pha
2.5 đo lệch 5.01 px). Buffer thô đi thẳng vào `texImage2D` với đúng kiểu dữ liệu đã ghi, không
qua bộ giải mã nào nên **không có chỗ nào để mất bit**. Đây là localhost nên vài chục MB là
chuyện nhỏ (đo: 5.5 MB mất 5.7 ms fetch + 0.7 ms upload GPU).

Quy ước: mọi buffer ghi theo hàng, **dòng đầu là dòng TRÊN** của ảnh (ngược với `Image.pixels`
của Blender — xem PRD §7).
"""

import numpy as np

# Kiểu dữ liệu cho từng loại buffer, và lý do chọn.
#
#   base / t / alpha  -> half (float16). Đây là dữ liệu scene-linear đã tone-map-chưa-áp, dải
#                        động rộng nhưng độ chính xác 11 bit mantissa là quá đủ cho màu.
#   uv                -> float32. KHÔNG được dùng half: gần 1.0 thì half sai 1/2048, nhân với
#                        1179 px chiều ngang ảnh màn hình là 0.58 px — vượt ngưỡng "dưới một
#                        pixel" mà spike Pha 2.5 đã đặt ra. float32 cũng làm biến mất luôn trò
#                        tách hai byte và nỗi lo trình duyệt hạ bit.
DTYPES = {"half": np.float16, "float32": np.float32}


def write_bin(path, array, dtype="half"):
    """Ghi mảng ra `.bin` thô, trả về mô tả để client biết cách nạp."""
    if dtype not in DTYPES:
        raise ValueError(f"dtype lạ: {dtype}, biết {sorted(DTYPES)}")
    arr = np.ascontiguousarray(array, dtype=DTYPES[dtype])
    if arr.ndim != 3:
        raise ValueError(f"cần mảng (h, w, c), nhận {arr.shape}")
    # Không cho NaN/Inf lọt xuống client: shader gặp NaN thì ra pixel đen hoặc trắng loang mà
    # không báo gì, và truy ngược từ ảnh về nguyên nhân rất tốn.
    if not np.isfinite(arr).all():
        raise ValueError(f"{path}: buffer có NaN hoặc Inf")
    with open(path, "wb") as f:
        f.write(arr.tobytes())
    h, w, c = arr.shape
    return {"path": path, "width": w, "height": h, "channels": c, "dtype": dtype}


def push_uv(uv, mask, iters=4):
    """Nới UV ra ngoài mép mặt nạ bằng cách lan giá trị hợp lệ ra 8 hướng.

    Đây là "edge extend" của Nuke, và nó chữa HAI lỗi bằng một phép:

    1. **Vành sai màu.** Mặt nạ là nhị phân (`filter_size = 0`, bắt buộc — xem plate.py), còn
       ảnh máy thì khử răng cưa. Vành ~2px quanh mép màn hình vì thế lấy nhầm màu spill thay
       vì màu video. Đo: vành này gánh **99.2%** tổng sai số thân máy (8.7/255, p99 54.6).
    2. **GPU chọn nhầm mip.** `textureGrad` lấy đạo hàm của UV theo pixel; ở mép mặt nạ, UV
       nhảy vọt từ giá trị thật sang 0 nên đạo hàm hoá lớn và GPU chọn mip nhỏ nhất — ra một
       vành mờ tịt. Nới UV làm đạo hàm liên tục qua mép nên bẫy này biến mất luôn.

    Trả về `(uv_đã_nới, mask_đã_nới)`. `mask` vào/ra là bool.
    """
    u = uv[:, :, 0].astype(np.float32).copy()
    v = uv[:, :, 1].astype(np.float32).copy()
    filled = mask.astype(bool).copy()

    for _ in range(iters):
        holes = ~filled
        if not holes.any():
            break
        total_u = np.zeros_like(u)
        total_v = np.zeros_like(v)
        count = np.zeros(u.shape, dtype=np.int32)
        # 8 láng giềng. `np.roll` cuộn vòng qua biên ảnh, nhưng mép ảnh không phải mép màn
        # hình (màn hình nằm gọn trong khung) nên không ảnh hưởng.
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                src = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
                su = np.roll(np.roll(u, dy, axis=0), dx, axis=1)
                sv = np.roll(np.roll(v, dy, axis=0), dx, axis=1)
                take = src & holes
                total_u[take] += su[take]
                total_v[take] += sv[take]
                count[take] += 1
        grow = holes & (count > 0)
        u[grow] = total_u[grow] / count[grow]
        v[grow] = total_v[grow] / count[grow]
        filled |= grow

    out = np.stack([u, v, filled.astype(np.float32)], axis=-1)
    return out, filled
