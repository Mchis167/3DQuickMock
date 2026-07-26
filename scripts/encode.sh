#!/usr/bin/env bash
# Đóng gói PNG sequence (có alpha) thành video.
#
#   scripts/encode.sh <frames_dir> <out_basename> [fps] [format]
#
# format: prores (mặc định, .mov ProRes 4444, giữ alpha)
#         webm   (.webm VP9 yuva420p, giữ alpha, cho web)
#         mp4    (.mp4 H.264, KHÔNG có alpha, ghép nền màu FLAT_BG)

set -euo pipefail

DIR="${1:?thiếu thư mục frames}"
OUT="${2:?thiếu tên file output}"
FPS="${3:-30}"
FMT="${4:-prores}"
FLAT_BG="${FLAT_BG:-#f2f2f4}"

IN=("-framerate" "$FPS" "-i" "$DIR/frame_%04d.png")

case "$FMT" in
  prores)
    # 4444 là profile duy nhất của ProRes mang được alpha
    ffmpeg -y "${IN[@]}" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le \
           -vendor apl0 "$OUT.mov"
    ;;
  webm)
    ffmpeg -y "${IN[@]}" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 \
           -row-mt 1 "$OUT.webm"
    ;;
  mp4)
    # H.264 không mang alpha -> phải ghép lên nền đặc trước khi encode
    ffmpeg -y -f lavfi -i "color=c=$FLAT_BG" "${IN[@]}" \
           -filter_complex "[0][1]scale2ref[bg][fg];[bg][fg]overlay=shortest=1,format=yuv420p" \
           -c:v libx264 -crf 16 -preset slow "$OUT.mp4"
    ;;
  *)
    echo "format không hợp lệ: $FMT (prores|webm|mp4)" >&2
    exit 1
    ;;
esac

echo "→ $(ls -lh "$OUT".* | awk '{print $9, $5}')"
