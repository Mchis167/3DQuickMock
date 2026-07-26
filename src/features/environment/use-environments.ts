import { useEffect, useState } from 'react'

import { trpc } from '@/shared/api/trpc'

export interface EnvironmentOption {
  id: string
  label: string
  description: string
  hdri: string
  strength: number
  rotation: number
  thumbnailUrl: string
}

/**
 * Nạp thư viện môi trường một lần khi mở app.
 *
 * Không cache giữa các lần mở: `presets.json` do `scripts/calibrate_env.py` sinh lại,
 * và giữ số cũ sau khi hiệu chuẩn lại là lỗi im lặng đúng nghĩa — độ sáng sẽ nhảy mà
 * không ai biết vì sao.
 */
export function useEnvironments() {
  const [presets, setPresets] = useState<EnvironmentOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    trpc.environments
      .query()
      .then((result) => {
        if (alive) setPresets(result.presets)
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      alive = false
    }
  }, [])

  return { presets, error }
}
