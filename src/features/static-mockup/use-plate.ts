import { useCallback, useEffect, useState } from 'react'

import type { MockupDocument } from '@/entities/scene-config/document'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'
import { trpc } from '@/shared/api/trpc'

/**
 * Plate hết hiệu lực khi cấu hình đổi — và phải TỰ hết hiệu lực.
 *
 * Plate là một tấm ảnh Blender render cho ĐÚNG một bộ camera, pose, môi trường và ảnh màn
 * hình. Xoay máy đi mà vẫn giữ plate cũ thì video vẫn phát mượt trên một tấm ảnh sai góc —
 * không lỗi, không cảnh báo, và người dùng chỉ phát hiện khi export ra rồi mới thấy sai.
 *
 * Nên: đổi bất cứ thứ gì plate phụ thuộc -> vứt plate -> canvas tự quay về preview tĩnh, nơi
 * người dùng chỉnh góc như bình thường. Dựng lại plate là một hành động TƯỜNG MINH.
 */

/** Những trường mà plate phụ thuộc. Thêm trường mới vào scene thì phải cân nhắc thêm ở đây. */
export function plateSignature(document: MockupDocument): string {
  return JSON.stringify({
    camera: document.camera,
    pose: document.pose,
    world: document.world,
    screen: document.screen,
  })
}

export function usePlateInvalidation(): void {
  const document = useDocumentStore((state) => state.document)
  const plate = useSessionStore((state) => state.plate)
  const signature = useSessionStore((state) => state.plateSignature)
  const setPlate = useSessionStore((state) => state.setPlate)

  useEffect(() => {
    if (!plate) return
    if (plateSignature(document) !== signature) setPlate(null)
  }, [document, plate, signature, setPlate])
}

/**
 * Dựng plate cho cấu hình hiện tại, và ghi lại vân tay của cấu hình đó.
 *
 * Vân tay phải chụp TRƯỚC khi gọi server: người dùng hoàn toàn có thể kéo một slider trong lúc
 * Cycles đang chạy, và nếu chụp sau thì plate cũ sẽ được gắn nhãn cấu hình mới — đúng cái mà
 * `usePlateInvalidation` sinh ra để chặn.
 */
export function useBuildPlate() {
  const document = useDocumentStore((state) => state.document)
  const setPlate = useSessionStore((state) => state.setPlate)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const build = useCallback(async () => {
    const signature = plateSignature(document)
    setBuilding(true)
    setError(null)
    try {
      const result = await trpc.plate.mutate({
        camera: document.camera,
        pose: document.pose,
        world: document.world,
        screen: document.screen,
      })
      setPlate({ res: result.res, files: result.files }, signature)
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    } finally {
      setBuilding(false)
    }
  }, [document, setPlate])

  return { build, building, error }
}
