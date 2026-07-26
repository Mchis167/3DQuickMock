import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Tầng integration: Blender THẬT, chậm, không chạy mỗi commit.
 * Cấu hình riêng vì bộ này cần include ngược lại đúng những file mà `pnpm test` loại ra.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@schema': fileURLToPath(new URL('./schema', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.integration.test.ts'],
    // Blender chỉ có một; hai file test chạy song song sẽ tranh nhau GPU và làm số đo
    // vô nghĩa.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
