import { createTRPCClient, httpBatchLink } from '@trpc/client'

import type { AppRouter } from '@/server/trpc/router'

/**
 * Cửa duy nhất từ UI sang server.
 *
 * Đây là element `api` trong luật ranh giới — chỗ DUY NHẤT được import từ `src/server`,
 * và chỉ để lấy **type** của router. Feature gọi thẳng server sẽ bị lint chặn, vì như
 * thế `fs`/`child_process` bị kéo vào bundle browser.
 *
 * Cổng 5174 là server Fastify (Vite ở 5173). Không proxy qua Vite: một tầng trung gian
 * nữa chỉ làm lỗi mạng khó đọc hơn khi server chưa chạy.
 */
export const API_BASE = import.meta.env['VITE_API_BASE'] ?? 'http://127.0.0.1:5174'

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_BASE}/trpc` })],
})

/** Ảnh preview và thumbnail do server phục vụ, không phải Vite. */
export function apiUrl(pathname: string): string {
  return `${API_BASE}${pathname}`
}
