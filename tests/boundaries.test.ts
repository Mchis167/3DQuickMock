import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * Luật ranh giới đã một lần hỏng IM LẶNG: khoá selector viết là `capture` thay vì
 * `captured`, plugin bỏ qua không báo gì, và mọi import xuyên feature đều lọt.
 * Lint "xanh" khi đó không chứng minh được gì.
 *
 * Test này kiểm cả hai chiều — chặn cái phải chặn, cho qua cái phải cho qua — nên
 * lần hỏng sau sẽ lộ ra ngay.
 */

const eslint = new ESLint({ cwd: process.cwd() })

async function boundaryErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'boundaries/dependencies')
}

describe('luật ranh giới features', () => {
  it('chặn import xuyên feature', async () => {
    const errors = await boundaryErrors(
      `import { VIDEO_EDITOR_FEATURE } from '@/features/video-editor'\nexport const x = VIDEO_EDITOR_FEATURE\n`,
      'src/features/static-mockup/probe.ts',
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.severity).toBe(2)
  })

  it('chặn import bằng đường dẫn tương đối, không chỉ qua alias', async () => {
    const errors = await boundaryErrors(
      `import { VIDEO_EDITOR_FEATURE } from '../video-editor'\nexport const x = VIDEO_EDITOR_FEATURE\n`,
      'src/features/static-mockup/probe.ts',
    )
    expect(errors).toHaveLength(1)
  })

  it('chặn shared import ngược lên feature', async () => {
    const errors = await boundaryErrors(
      `import { EXPORT_FEATURE } from '@/features/export'\nexport const x = EXPORT_FEATURE\n`,
      'src/shared/lib/probe.ts',
    )
    expect(errors).toHaveLength(1)
  })

  it('chặn entity import lên feature', async () => {
    const errors = await boundaryErrors(
      `import { EXPORT_FEATURE } from '@/features/export'\nexport const x = EXPORT_FEATURE\n`,
      'src/entities/scene-config/probe.ts',
    )
    expect(errors).toHaveLength(1)
  })

  it('cho phép feature import shared', async () => {
    const errors = await boundaryErrors(
      `import { cn } from '@/shared/lib/cn'\nexport const x = cn('a')\n`,
      'src/features/static-mockup/probe.ts',
    )
    expect(errors).toEqual([])
  })

  it('cho phép import trong cùng một feature', async () => {
    const errors = await boundaryErrors(
      `import { STATIC_MOCKUP_FEATURE } from './index'\nexport const x = STATIC_MOCKUP_FEATURE\n`,
      'src/features/static-mockup/probe.ts',
    )
    expect(errors).toEqual([])
  })

  it('chặn feature import thẳng vào server', async () => {
    // Ngoại lệ chỉ dành cho shared/api. Nếu feature gọi thẳng server thì code server
    // (fs, child_process) bị bundle vào bundle browser.
    const errors = await boundaryErrors(
      `import { appRouter } from '@/server/trpc/router'\nexport const x = appRouter\n`,
      'src/features/static-mockup/probe.ts',
    )
    expect(errors).toHaveLength(1)
  })

  it('chặn shared/lib import api (api ở trên shared)', async () => {
    const errors = await boundaryErrors(
      `import { trpc } from '@/shared/api/trpc'\nexport const x = trpc\n`,
      'src/shared/lib/probe.ts',
    )
    expect(errors).toHaveLength(1)
  })

  it('cho phép shared/api lấy type của server', async () => {
    const errors = await boundaryErrors(
      `import type { AppRouter } from '@/server/trpc/router'\nexport type X = AppRouter\n`,
      'src/shared/api/probe.ts',
    )
    expect(errors).toEqual([])
  })

  it('cho phép feature import api', async () => {
    const errors = await boundaryErrors(
      `import { trpc } from '@/shared/api/trpc'\nexport const x = trpc\n`,
      'src/features/static-mockup/probe.ts',
    )
    expect(errors).toEqual([])
  })

  it('cho phép app import feature', async () => {
    const errors = await boundaryErrors(
      `import { EXPORT_FEATURE } from '@/features/export'\nexport const x = EXPORT_FEATURE\n`,
      'src/app/probe.ts',
    )
    expect(errors).toEqual([])
  })
})
