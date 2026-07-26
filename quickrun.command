#!/bin/bash
# Double-click để chạy: khởi động Vite + Fastify (dev:all), mở trình duyệt vào
# localhost:5173, và dọn dẹp tiến trình khi đóng cửa sổ Terminal (Ctrl+C hoặc bấm X).
set -e
cd "$(dirname "$0")"

# nvm không tự nạp trong Terminal.app khi double-click .command, nên nạp tay nếu có.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi

echo "3DQuickMock — đang khởi động dev:all (Vite :5173 + Fastify :5174)..."

pnpm dev:all &
DEV_PID=$!

# Dọn tiến trình con (Vite, Fastify, worker Blender) khi thoát — không thì đóng cửa sổ
# xong vẫn còn Blender sống nhờ stdin EOF không được kích hoạt qua trap này.
trap 'echo "Đang dừng..."; kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null' EXIT INT TERM

# Đợi Vite sẵn sàng rồi mới mở trình duyệt, tránh mở ra trang "không kết nối được".
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:5173"; then
    open "http://127.0.0.1:5173"
    break
  fi
  sleep 1
done

wait $DEV_PID
