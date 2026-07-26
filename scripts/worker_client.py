#!/usr/bin/env python3
"""Client tối thiểu cho worker Blender — dùng để test và làm mẫu cho backend Next.js.

  python3 scripts/worker_client.py            # chạy bộ test đo độ trễ
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"  # không có trong PATH
WORKER = os.path.join(ROOT, "scripts/blender/worker.py")


class Worker:
    def __init__(self):
        self.p = subprocess.Popen(
            [BLENDER, "-b", "--factory-startup", "-P", WORKER],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1, cwd=ROOT,
        )
        self._await_reply()  # thông điệp ready

    def _await_reply(self):
        for line in self.p.stdout:
            if line.startswith("@@"):
                return json.loads(line[2:])
        raise RuntimeError("worker chết trước khi trả lời")

    def send(self, **cmd):
        self.p.stdin.write(json.dumps(cmd) + "\n")
        self.p.stdin.flush()
        return self._await_reply()

    def close(self):
        try:
            self.send(cmd="quit")
        except Exception:
            pass
        self.p.terminate()


def main():
    t0 = time.time()
    w = Worker()
    print(f"khởi động worker            {(time.time()-t0)*1000:7.0f} ms  (trả một lần duy nhất)")

    print(json.dumps(w.send(cmd="ping"), ensure_ascii=False))

    t = time.time()
    w.send(cmd="scene", engine="eevee", res=[480, 640], samples=16)
    print(f"dựng scene                  {(time.time()-t)*1000:7.0f} ms")

    base = dict(
        screen=os.path.join(ROOT, "assets/raw/iphone-17-pro-max/gltf/textures/17ProMax_Screen_baseColor.jpeg"),
        world={"hdri": os.path.join(ROOT, "assets/hdri/studio_small_03.hdr"), "strength": 0.6},
    )

    r = w.send(cmd="still", out="/tmp/wk_warm.png", camera={"azimuth": 0, "elevation": 12}, **base)
    print(f"still đầu tiên (nạp HDRI)   {r['ms']:7.0f} ms")

    for az in (30, 60, 90):
        r = w.send(cmd="still", out=f"/tmp/wk_{az}.png", camera={"azimuth": az, "elevation": 12}, **base)
        print(f"đổi góc camera az={az:3d}      {r['ms']:7.0f} ms")

    r = w.send(cmd="still", out="/tmp/wk_rot.png",
               camera={"azimuth": 30, "elevation": 12},
               screen=base["screen"],
               world={"hdri": base["world"]["hdri"], "strength": 0.6, "rotation": 225})
    print(f"kéo slider hdri_rotation    {r['ms']:7.0f} ms")

    r = w.send(cmd="strip", out_dir="/tmp/wk_strip", n=36,
               camera={"elevation": 12, "frame_fill": 0.72}, **base)
    print(f"precompute dải 36 góc       {r['ms']:7.0f} ms  ({r['ms']/36:.0f} ms/góc, bước {r['step_deg']:.0f}°)")

    ch = {"device.spin_z": {"keyframes": [
        {"frame": 1, "value": 0.0, "interpolation": "LINEAR"},
        {"frame": 61, "value": 360.0, "interpolation": "LINEAR"}]}}
    r = w.send(cmd="sample", channels=ch, frames_list=[1, 15, 30, 45, 60])
    print(f"lấy mẫu đường cong (UI vẽ)  giá trị = {[round(v,1) for v in r['values']['device.spin_z']]}")

    r = w.send(cmd="anim", out_dir="/tmp/wk_anim", channels=ch, frames=60, fps=30, **base)
    print(f"render animation 60 frame   {r['ms']:7.0f} ms  ({r['ms']/60:.0f} ms/frame)")

    print(json.dumps(w.send(cmd="meta"), ensure_ascii=False)[:120] + " ...")
    w.close()


if __name__ == "__main__":
    sys.exit(main())
