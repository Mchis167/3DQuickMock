import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// defineConfig của vitest/config, không phải của vite — để khối `test` có kiểu.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Đường dẫn asset TƯƠNG ĐỐI: bản build được phục vụ dưới tiền tố `/app/` của API server để
  // trang export và API cùng origin (khỏi CORS, khỏi URL tuyệt đối). Với `base` mặc định là
  // '/', mọi thẻ script trong `export.html` sẽ trỏ về gốc và 404.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@schema': fileURLToPath(new URL('./schema', import.meta.url)),
    },
  },
  // Hai entry của CÙNG một bundle: `index.html` cho UI, `export.html` cho vòng lặp export
  // chạy trong Chrome headless. Nhờ vậy cả hai import đúng một `composite.frag.glsl` — lời
  // hứa "preview không lệch export" nằm ở đây chứ không ở một phép đo.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        export: fileURLToPath(new URL('./export.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    // BẮT BUỘC: không có nó, khi 5173 bận thì Vite ÂM THẦM nhảy sang 5174 — đúng cổng của API
    // server. Lúc đó mọi lời gọi tRPC rơi vào Vite, và Vite trả `index.html` cho mọi đường dẫn
    // nên client báo "Unexpected token '<'" thay vì báo sai cổng. Đã sập thật.
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Blender thật quá chậm cho vòng lặp commit — tầng integration chạy riêng.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
})
