import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocument } from '@/entities/scene-config/document'
import { initHistory } from '@/entities/scene-config/history'
import { useDocumentStore } from '@/entities/scene-config/store'
import { useSessionStore } from '@/entities/session'

import { setPlaybackFrames } from '@/entities/session/playback-frames'

import { plateSignature } from './use-plate'

const signature = () => plateSignature(useDocumentStore.getState().document)

// WebGL không tồn tại trong jsdom. Component ghép video được thay bằng cổng giả: bài kiểm ở
// đây là "canvas chuyển sang ĐƯỜNG NÀO", không phải "shader vẽ ra gì".
vi.mock('./video-composite', () => ({
  VideoComposite: () => <div data-testid="video-composite" />,
}))

// Thanh điều khiển gọi tRPC để dựng plate; ở đây chỉ cần biết nó có mặt hay không.
vi.mock('./use-plate', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useBuildPlate: () => ({ build: vi.fn(), building: false, error: null }) }
})

vi.mock('@/shared/api/trpc', () => ({
  apiUrl: (pathname: string) => `http://test${pathname}`,
  API_BASE: 'http://test',
}))

import { PreviewCanvas } from './preview-canvas'

beforeEach(() => {
  useSessionStore.setState({
    zoom: 'fit',
    previewQuality: 'med',
    rendering: false,
    error: null,
    preview: { url: '/preview/a.png', ms: 240, liftMm: 0, bottomGapMm: 0 },
    plate: null,
    plateSignature: null,
    video: null,
    playing: false,
    playbackCache: null,
    playhead: 1,
  })
  setPlaybackFrames(null)
  const document = createDocument()
  useDocumentStore.setState({
    history: initHistory(document),
    document,
    canUndo: false,
    canRedo: false,
  })
})

function image() {
  return screen.getByAltText('Preview mockup')
}

/** jsdom không tự có kích thước; gán tay để phép đo thu phóng có số thật. */
function giveSizes(viewportHeight = 600, viewportWidth = 800) {
  const canvas = image().parentElement as HTMLElement
  canvas.getBoundingClientRect = () =>
    ({ width: viewportWidth, height: viewportHeight, left: 0, top: 0 }) as DOMRect
  Object.defineProperty(image(), 'naturalWidth', { value: 480, configurable: true })
  Object.defineProperty(image(), 'naturalHeight', { value: 640, configurable: true })
  return canvas
}

describe('PreviewCanvas — chế độ Fit', () => {
  it('khung ảnh bám khung nhìn, KHÔNG bám số pixel của ảnh', () => {
    render(<PreviewCanvas />)
    // Kích thước hiện lên phải chỉ phụ thuộc khung nhìn: đổi mức độ nét (360×480 -> 1080×1440,
    // cùng tỉ lệ 3:4) thì mockup phải y nguyên, chỉ nét hơn.
    //
    // jsdom không tính layout nên không đo được ở đây; số đo thật lấy từ Chrome 150 (xem chú
    // thích trong component). Test này khoá lại ĐÚNG cấu trúc CSS đã đo:
    //  - `absolute` + `inset-2`: cả hai chiều lấy từ containing block nên luôn xác định. Bỏ
    //    `absolute` là `h-full` rơi về `auto` và ảnh to nhỏ theo mức độ nét — đúng lỗi đã gặp.
    //  - `object-contain`: khung bằng khung nhìn thì phải có cái này, nếu không ảnh bị méo.
    expect(image().className).toContain('absolute')
    expect(image().className).toContain('inset-2')
    expect(image().className).toContain('object-contain')
    // `w-auto` để ảnh tự lấy chiều rộng theo pixel gốc — chính là thứ gây lỗi.
    expect(image().className).not.toMatch(/(^|\s)w-auto(\s|$)/)
  })

  it('chỉ có hai chế độ, không còn 100%/200%', () => {
    render(<PreviewCanvas />)
    expect(screen.getByRole('radio', { name: 'Fit' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Zoom' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '100%' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '200%' })).not.toBeInTheDocument()
  })

  it('không hiện mức phóng khi đang Fit', () => {
    render(<PreviewCanvas />)
    expect(screen.queryByTestId('zoom-level')).not.toBeInTheDocument()
  })
})

describe('PreviewCanvas — chế độ Zoom', () => {
  it('vào Zoom thì căn giữa ở mức vừa khung, không nhảy hình', async () => {
    render(<PreviewCanvas />)
    giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    // fit của 480×640 trong 800×600 là 600/640 ≈ 94%.
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('94%')
  })

  it('cuộn chuột phóng to, và chặn cuộn trang', async () => {
    render(<PreviewCanvas />)
    const canvas = giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))

    // `fireEvent` bọc trong `act()` nên React kịp render lại; `dispatchEvent` trực tiếp thì
    // không, và assertion sẽ đọc giá trị cũ.
    const notCancelled = fireEvent.wheel(canvas, { deltaY: -200, clientX: 400, clientY: 300 })
    // Không `preventDefault` thì trang cuộn theo thay vì canvas phóng to.
    expect(notCancelled).toBe(false)
    expect(
      Number(screen.getByTestId('zoom-level').textContent?.replace('%', '')),
    ).toBeGreaterThan(94)
  })

  it('cuộn ngược lại thì thu nhỏ', async () => {
    render(<PreviewCanvas />)
    const canvas = giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    fireEvent.wheel(canvas, { deltaY: 300, clientX: 400, clientY: 300 })
    expect(Number(screen.getByTestId('zoom-level').textContent?.replace('%', ''))).toBeLessThan(
      94,
    )
  })

  it('phím + và − đổi mức phóng, phím 0 về 100%', async () => {
    render(<PreviewCanvas />)
    giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))

    // Vào zoom ở mức fit 93.75%, nhân 1.25 -> 117%.
    fireEvent.keyDown(window, { key: '+' })
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('117%')

    fireEvent.keyDown(window, { key: '0' })
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('100%')

    fireEvent.keyDown(window, { key: '-' })
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('80%')
  })

  it('phím F về chế độ Fit', async () => {
    render(<PreviewCanvas />)
    giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    fireEvent.keyDown(window, { key: 'f' })
    expect(useSessionStore.getState().zoom).toBe('fit')
  })

  it('KHÔNG giành phím khi đang gõ số vào panel', async () => {
    render(
      <>
        <input aria-label="ô số" />
        <PreviewCanvas />
      </>,
    )
    giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    const before = screen.getByTestId('zoom-level').textContent

    fireEvent.keyDown(screen.getByLabelText('ô số'), { key: '-' })
    // Gõ '-' để nhập số âm không được làm canvas thu nhỏ.
    expect(screen.getByTestId('zoom-level')).toHaveTextContent(before ?? '')
  })

  it('Cmd/Ctrl + phím không bị chiếm — nhường cho phím tắt hệ thống', async () => {
    render(<PreviewCanvas />)
    giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    const before = screen.getByTestId('zoom-level').textContent
    fireEvent.keyDown(window, { key: '0', metaKey: true })
    expect(screen.getByTestId('zoom-level')).toHaveTextContent(before ?? '')
  })

  it('kéo chuột để di ảnh', async () => {
    render(<PreviewCanvas />)
    const canvas = giveSizes()
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    canvas.setPointerCapture = () => {}

    const before = image().style.transform
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 130 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(image().style.transform).not.toBe(before)
    expect(image().style.transform).toContain('translate')
  })

  it('ảnh mới về (kéo slider) KHÔNG reset mức phóng đang xem', async () => {
    render(<PreviewCanvas />)
    giveSizes()
    // Lần tải đầu ghi nhận kích thước ảnh.
    fireEvent.load(image())
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom' }))
    fireEvent.keyDown(window, { key: '+' })
    const zoomed = screen.getByTestId('zoom-level').textContent

    // Ảnh mới CÙNG kích thước: đang soi chi tiết mà bị đưa về fit là mất chỗ đang xem.
    fireEvent.load(image())
    expect(screen.getByTestId('zoom-level')).toHaveTextContent(zoomed ?? '')
  })
})

const MANIFEST = {
  res: [8, 10] as [number, number],
  files: {
    base: { url: '/cache/plate/x/base.bin', channels: 3, dtype: 'half' as const },
    t: { url: '/cache/plate/x/t.bin', channels: 3, dtype: 'half' as const },
    alpha: { url: '/cache/plate/x/alpha.bin', channels: 1, dtype: 'half' as const },
    uv: { url: '/cache/plate/x/uv.bin', channels: 3, dtype: 'float32' as const },
  },
}
const VIDEO = { url: '/cache/uploads/clip.mp4', width: 1080, height: 1920 }

describe('PreviewCanvas — đường video', () => {
  it('có ĐỦ plate và video thì chuyển sang bộ ghép WebGL, bỏ ảnh tĩnh', () => {
    useSessionStore.setState({ plate: MANIFEST, video: VIDEO, plateSignature: signature() })
    render(<PreviewCanvas />)
    expect(screen.getByTestId('video-composite')).toBeInTheDocument()
    expect(screen.queryByAltText('Preview mockup')).not.toBeInTheDocument()
  })

  it('có video nhưng CHƯA có plate thì vẫn là ảnh tĩnh', () => {
    // Plate mất ~15s dựng. Chuyển đường sớm sẽ để lại một canvas trống suốt quãng đó, và
    // trông y như hỏng.
    useSessionStore.setState({ plate: null, video: VIDEO })
    render(<PreviewCanvas />)
    expect(screen.queryByTestId('video-composite')).not.toBeInTheDocument()
    expect(screen.getByAltText('Preview mockup')).toBeInTheDocument()
  })

  it('bỏ video thì plate bị vứt theo — plate gắn chặt vào MỘT bộ góc', () => {
    useSessionStore.setState({ plate: MANIFEST, video: VIDEO })
    useSessionStore.getState().setVideo(null)
    expect(useSessionStore.getState().plate).toBeNull()
  })

  it('ĐỔI GÓC thì plate tự hết hiệu lực, canvas quay về ảnh tĩnh', async () => {
    // Đây là hành vi quan trọng nhất của cả luồng: không có nó, người dùng xoay máy xong vẫn
    // thấy video phát mượt trên một tấm ảnh SAI GÓC và không có gì báo.
    useSessionStore.setState({ plate: MANIFEST, video: VIDEO, plateSignature: signature() })
    render(<PreviewCanvas />)
    expect(screen.getByTestId('video-composite')).toBeInTheDocument()

    act(() => {
      useDocumentStore.getState().setCamera({ azimuth: 45 })
    })
    await waitFor(() => expect(useSessionStore.getState().plate).toBeNull())
    expect(screen.queryByTestId('video-composite')).not.toBeInTheDocument()
    expect(screen.getByAltText('Preview mockup')).toBeInTheDocument()
  })

  it('có video thì luôn có nút dựng plate ngay trên canvas', () => {
    useSessionStore.setState({ plate: null, video: VIDEO })
    render(<PreviewCanvas />)
    expect(screen.getByRole('button', { name: /Build plate/ })).toBeInTheDocument()
  })
})

/**
 * Đường PHÁT LẠI: canvas phải hiện ảnh từ dải đã render sẵn, và phải ĐỔI theo playhead.
 *
 * Mắt xích này chưa có phép kiểm nào, và đúng là chỗ người dùng báo lỗi "ấn play là nó chỉ
 * hiển thị frame cuối luôn". Vòng lặp phát đã có test riêng và chạy đúng, nên nếu lỗi có
 * thật thì nó nằm ở đây.
 */
describe('PreviewCanvas — đường phát lại', () => {
  const SIGNATURE = 'sig'

  /** Ảnh giả có kích thước thật; jsdom không nạp ảnh nên phải gán tay. */
  function fakeImages(count: number) {
    return Array.from({ length: count }, (_, i) => {
      const image = { naturalWidth: 360, naturalHeight: 480, width: 360, height: 480, id: i }
      return image as unknown as HTMLImageElement
    })
  }

  /**
   * Ghi lại ẢNH THẬT SỰ được vẽ.
   *
   * Vì sao không đọc `data-frame`: nó lấy từ prop, nên nó chỉ chứng minh "component nhận
   * đúng số frame", không chứng minh "đúng ảnh lên màn hình". Bẻ code để luôn vẽ ảnh cuối
   * mà mọi phép kiểm theo `data-frame` vẫn xanh — nên phép kiểm đó đo sai thứ.
   */
  function recordDrawnImages() {
    const drawn: number[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: () => {},
      drawImage: (image: unknown) => {
        drawn.push((image as { id: number }).id)
      },
    } as unknown as CanvasRenderingContext2D)
    return drawn
  }

  const CACHE = {
    signature: SIGNATURE,
    fps: 30,
    urls: ['/a/frame_0001.png', '/a/frame_0002.png', '/a/frame_0003.png'],
  }

  beforeEach(() => {
    setPlaybackFrames({ signature: SIGNATURE, images: fakeImages(3) })
  })

  const playbackCanvas = () => screen.getByLabelText('Playback frame')

  it('đang phát thì vẽ canvas từ dải ảnh, KHÔNG dùng thẻ img đổi src', () => {
    useSessionStore.setState({ playing: true, playbackCache: CACHE, playhead: 1 })
    render(<PreviewCanvas />)

    expect(playbackCanvas()).toBeInTheDocument()
    // Không còn thẻ ảnh preview tĩnh: chỉ có MỘT nguồn hình lúc đang phát.
    expect(screen.queryByAltText('Preview mockup')).not.toBeInTheDocument()
  })

  it('ẢNH ĐƯỢC VẼ đổi theo playhead — không phải chỉ cái nhãn đổi', () => {
    const drawn = recordDrawnImages()
    useSessionStore.setState({ playing: true, playbackCache: CACHE, playhead: 1 })
    render(<PreviewCanvas />)

    for (const frame of [2, 3, 1]) {
      act(() => {
        useSessionStore.setState({ playhead: frame })
      })
    }

    // `id` của ảnh giả là chỉ số 0-based, playhead là 1-based.
    expect(drawn).toEqual([0, 1, 2, 0])
    expect(playbackCanvas().getAttribute('data-frame')).toBe('1')
  })

  it('dừng phát thì quay về preview tĩnh', () => {
    useSessionStore.setState({ playing: true, playbackCache: CACHE, playhead: 2 })
    render(<PreviewCanvas />)
    expect(playbackCanvas()).toBeInTheDocument()

    act(() => {
      useSessionStore.setState({ playing: false })
    })
    expect(screen.getByAltText('Preview mockup')).toHaveAttribute(
      'src',
      'http://test/preview/a.png',
    )
  })

  it('vân tay lệch thì KHÔNG vẽ dải cũ — về preview tĩnh', () => {
    setPlaybackFrames({ signature: 'vân tay khác', images: fakeImages(3) })
    useSessionStore.setState({ playing: true, playbackCache: CACHE, playhead: 2 })
    render(<PreviewCanvas />)

    expect(screen.queryByLabelText('Playback frame')).not.toBeInTheDocument()
    expect(screen.getByAltText('Preview mockup')).toBeInTheDocument()
  })
})
