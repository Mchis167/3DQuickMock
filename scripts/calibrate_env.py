#!/usr/bin/env python3
"""Hiệu chuẩn độ sáng cho từng HDRI rồi sinh assets/hdri/presets.json.

Mỗi HDRI có độ sáng gốc khác nhau rất nhiều, nên preset chỉ mang tên file là không đủ:
đổi môi trường sẽ làm độ phơi sáng nhảy loạn. Script dò nhị phân `strength` của từng bộ
cho tới khi độ sáng vùng thiết bị khớp mốc chung.

  python3 scripts/calibrate_env.py
"""

import json
import math
import os
import statistics
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worker_client import ROOT, Worker  # noqa: E402

SCREEN = os.path.join(
    ROOT, "assets/raw/iphone-17-pro-max/gltf/textures/17ProMax_Screen_baseColor.jpeg"
)
CAM = {"azimuth": 32, "elevation": 12, "frame_fill": 0.72}
# Thumbnail nhìn mặt lưng: titanium và kính chiếm phần lớn khung, nên khác biệt giữa các
# môi trường hiện rõ. Nhìn mặt trước thì màn hình sáng át hết, các preset trông giống nhau.
THUMB_CAM = {"azimuth": 215, "elevation": 12, "frame_fill": 0.78}

# Mốc hiệu chuẩn: bộ và cường độ đã chốt sau nhiều lần thử.
REFERENCE = ("studio_small_03", 0.6)

# nhãn hiển thị cho người dùng; slug Poly Haven vô nghĩa với người dùng cuối
LABELS = {
    "studio_small_03": ("Contrast Studio", "Structured highlights, best for metallic reflections"),
    "studio_small_08": ("Soft Studio", "Low contrast, even lighting, safe for all angles"),
    "studio_small_09": ("Warm Studio", "Warm yellow tones, incandescent lamp feel"),
    "brown_photostudio_02": ("Photo Studio with Plants", "Cluttered background, recommended for lighting only"),
    "photo_studio_loft_hall": ("Loft Hall Window", "Strong directional light with warm tones"),
    "small_empty_room_1": ("Empty Room", "Neutral, soft wall reflections"),
    "venice_sunset": ("Venice Sunset", "Warm outdoor light, moderate contrast"),
    "kloofendal_48d_partly_cloudy_puresky": ("Noon Sky", "Harsh outdoor light, sharp shadows"),
    "royal_esplanade_1k": ("Royal Esplanade", "Elegant outdoor light, classic architectural reflections"),
    "shanghai_bund_1k": ("Shanghai Bund Night", "Vibrant city night lights, colorful neon reflections"),
    "snowy_park_01_1k": ("Snowy Park", "Cool outdoor tones, soft and bright light"),
    "industrial_pipe_and_valve_01_1k": ("Industrial Machine Room", "Strong metallic reflections, high contrast, deep shadows"),
    "alps_field_1k": ("Alps Field", "Bright natural light, warm sunny valley"),
    "autumn_park_1k": ("Autumn Park", "Warm golden tones, soft lighting reflections"),
    "garage_1k": ("Indoor Garage", "Indoor garage lighting, wide tube light reflections"),
    "modern_buildings_1k": ("Modern Urban", "Light between glass buildings, sharp angular reflections"),
    "overcast_soil_1k": ("Overcast Sky", "Evenly diffused light, ultra-soft shadows"),
    "museum_of_ethnography_1k": ("Museum Hall", "Spacious indoor setting, distant window light source"),
    "leadenhall_market_1k": ("Leadenhall Market", "Historic dome architecture, intricate lighting reflections"),
    "lakeside_1k": ("Lakeside", "Cool outdoor light, soft blue reflections"),
}


def device_luminance(path):
    """Độ sáng trung bình CHỈ trong vùng thiết bị (alpha đặc), bỏ nền trong suốt."""
    im = Image.open(path).convert("RGBA")
    px = list(im.getdata())
    vals = [(r + g + b) / 3 for r, g, b, a in px if a > 250]
    return statistics.mean(vals) if vals else 0.0


def render_lum(w, hdri, strength, tag):
    """Đo ở góc MẶT LƯNG, không phải mặt trước.

    Mặt trước bị màn hình phát sáng chiếm phần lớn, mà độ sáng màn hình cố định không
    phụ thuộc HDRI -> nó neo phép đo và làm loãng tín hiệu. Hiệu chuẩn theo mặt trước
    cho ra con số trông hoàn hảo nhưng vật liệu thật vẫn chênh nhau rõ.
    """
    out = f"/tmp/cal_{tag}.png"
    w.send(
        cmd="still", out=out, screen=SCREEN, camera=THUMB_CAM,
        world={"hdri": hdri, "strength": strength, "rotation": 0.0},
    )
    return device_luminance(out)


def solve_strength(w, hdri, target, tag, lo=0.02, hi=6.0, rounds=7):
    """Dò nhị phân. Độ sáng đơn điệu tăng theo strength nên dò nhị phân là đủ."""
    best = (None, None)
    for i in range(rounds):
        mid = math.sqrt(lo * hi)  # dò theo thang log: strength trải rộng nhiều bậc
        lum = render_lum(w, hdri, mid, f"{tag}_{i}")
        if best[0] is None or abs(lum - target) < abs(best[1] - target):
            best = (mid, lum)
        if lum < target:
            lo = mid
        else:
            hi = mid
    return best


def main():
    hdri_dir = os.path.join(ROOT, "assets/hdri")
    names = sorted(n[:-4] for n in os.listdir(hdri_dir) if n.endswith(".hdr"))

    w = Worker()
    w.send(cmd="scene", engine="eevee", res=[420, 560], samples=16)

    ref_name, ref_strength = REFERENCE
    target = render_lum(w, os.path.join(hdri_dir, ref_name + ".hdr"), ref_strength, "ref")
    print(f"mốc chuẩn: {ref_name} @ {ref_strength} -> độ sáng {target:.1f}\n")

    presets = []
    print(f"{'HDRI':<38} {'strength':>9} {'độ sáng':>9} {'lệch mốc':>9}")
    for n in names:
        path = os.path.join(hdri_dir, n + ".hdr")
        if n == ref_name:
            strength, lum = ref_strength, target
        else:
            strength, lum = solve_strength(w, path, target, n)
        label, desc = LABELS.get(n, (n.replace("_", " ").title(), ""))
        print(f"{n:<38} {strength:9.3f} {lum:9.1f} {lum - target:+9.1f}")
        presets.append(
            {
                "id": n,
                "label": label,
                "description": desc,
                "hdri": f"assets/hdri/{n}.hdr",
                "strength": round(strength, 3),
                "rotation": 0.0,
                "thumbnail": f"assets/hdri/thumbs/{n}.png",
                "builtin": True,
            }
        )

    # thumbnail để chọn môi trường theo HÌNH thay vì theo tên slug vô nghĩa
    thumbs = os.path.join(hdri_dir, "thumbs")
    os.makedirs(thumbs, exist_ok=True)
    w.send(cmd="scene", engine="eevee", res=[220, 290], samples=24)
    print()
    for p in presets:
        w.send(
            cmd="still",
            out=os.path.join(thumbs, p["id"] + ".png"),
            screen=SCREEN,
            camera=THUMB_CAM,
            world={"hdri": os.path.join(ROOT, p["hdri"]), "strength": p["strength"],
                   "rotation": p["rotation"]},
        )
        print(f"thumbnail: {p['label']}")
    w.close()

    out = os.path.join(hdri_dir, "presets.json")
    with open(out, "w") as f:
        json.dump(
            {
                "_comment": (
                    "strength đã hiệu chuẩn để mọi preset cho độ phơi sáng tương đương "
                    f"({ref_name} @ {ref_strength} làm mốc). Đổi môi trường sẽ không làm "
                    "nhảy độ sáng. Chạy lại scripts/calibrate_env.py sau khi thêm HDRI mới."
                ),
                "reference": {"id": ref_name, "strength": ref_strength, "luminance": round(target, 2)},
                "presets": presets,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )
    print(f"\n-> {out} ({len(presets)} preset)")


if __name__ == "__main__":
    sys.exit(main())
