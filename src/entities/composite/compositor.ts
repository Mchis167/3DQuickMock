import fragmentSource from './composite.frag.glsl?raw'

/**
 * Bộ ghép WebGL2 — vỏ bọc quanh `composite.frag.glsl`.
 *
 * Module này sở hữu **toàn bộ** trạng thái GL của phép ghép: thuộc tính context, texture,
 * uniform, vòng vẽ, và đọc pixel ngược ra. Preview và export dùng chung đúng lớp này; khác
 * nhau duy nhất ở vòng lặp điều khiển (phát video vs tua từng frame).
 *
 * Vì sao thuộc tính context phải nằm ở đây chứ không ở nơi gọi: `premultipliedAlpha` và
 * `preserveDrawingBuffer` quyết định kết quả đọc ra. Hai framebuffer dựng bằng hai bộ thuộc
 * tính khác nhau thì không shader nào chữa được, và preview/export sẽ lệch nhau ở mép alpha
 * mà không ai truy ra được nguyên nhân.
 */

export interface BufferSpec {
  width: number
  height: number
  channels: number
  dtype: 'half' | 'float32'
  data: ArrayBuffer
}

export interface PlateBuffers {
  base: BufferSpec
  t: BufferSpec
  alpha: BufferSpec
  uv: BufferSpec
}

export interface AgxLut {
  size: number
  logMin: number
  logRange: number
  /** RGB half, bố cục b-major rồi g rồi r. */
  data: ArrayBuffer
}

/** Thuộc tính context — cố định ở đây để preview và export không thể lệch nhau. */
export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  // Bắt buộc cho export: không có nó thì `readPixels` sau khi trình duyệt hợp thành xong sẽ
  // đọc phải buffer đã bị xoá, và ra ảnh trong suốt hoàn toàn — không lỗi, không cảnh báo.
  preserveDrawingBuffer: true,
  antialias: false,
  depth: false,
  stencil: false,
  desynchronized: false,
}

const VERTEX_SOURCE = `#version 300 es
// Một tam giác phủ toàn khung, không dùng vertex buffer. Rẻ hơn quad hai tam giác và không có
// đường nối ở giữa.
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  // LẬT Y. Buffer của plate ghi theo hàng, **dòng đầu là dòng TRÊN** của ảnh; còn toạ độ
  // texture của GL có t = 0 ở dòng ĐẦU TIÊN được nạp, trong khi NDC y = -1 lại là ĐÁY khung.
  // Lấy thẳng vUv = p thì đáy khung đọc phải dòng trên cùng của ảnh -> cả mockup lộn ngược
  // (dấu hiệu nhận ra: cụm Dynamic Island nằm ở đáy máy). Đã sập thật ở Pha 5d.
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export class CompositorError extends Error {}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new CompositorError('không tạo được shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? ''
    gl.deleteShader(shader)
    throw new CompositorError(`biên dịch shader hỏng:\n${log}`)
  }
  return shader
}

/** `Float16Array` chưa có ở mọi trình duyệt nên half đi thẳng vào GL dưới dạng `Uint16Array`. */
function typedView(spec: BufferSpec): ArrayBufferView {
  return spec.dtype === 'float32' ? new Float32Array(spec.data) : new Uint16Array(spec.data)
}

function formatFor(gl: WebGL2RenderingContext, spec: BufferSpec) {
  const half = spec.dtype === 'half'
  const type = half ? gl.HALF_FLOAT : gl.FLOAT
  switch (spec.channels) {
    case 1:
      return { internal: half ? gl.R16F : gl.R32F, format: gl.RED, type }
    case 3:
      return { internal: half ? gl.RGB16F : gl.RGB32F, format: gl.RGB, type }
    case 4:
      return { internal: half ? gl.RGBA16F : gl.RGBA32F, format: gl.RGBA, type }
    default:
      throw new CompositorError(`số kênh lạ: ${spec.channels}`)
  }
}

export class Compositor {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly textures = new Map<string, WebGLTexture>()
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>()
  private video: WebGLTexture | null = null
  private size: { width: number; height: number } = { width: 0, height: 0 }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES)
    if (!gl) throw new CompositorError('không mở được WebGL2')
    this.gl = gl as WebGL2RenderingContext
    // Bắt buộc để dựng texture float: thiếu extension này thì `texImage2D` với RGB16F trả
    // INVALID_OPERATION mà KHÔNG ném exception, và texture lấy mẫu ra đen thuần.
    if (!this.gl.getExtension('EXT_color_buffer_float')) {
      throw new CompositorError('thiếu EXT_color_buffer_float — không dựng được texture float')
    }
    // Hàng LUT 97×3×2 = 582 byte, không chia hết cho 4. Với alignment mặc định thì
    // `texImage3D` trả INVALID_OPERATION, không ném exception, và LUT lấy mẫu ra ĐEN THUẦN.
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)

    const program = this.gl.createProgram()
    if (!program) throw new CompositorError('không tạo được program')
    this.gl.attachShader(program, compile(this.gl, this.gl.VERTEX_SHADER, VERTEX_SOURCE))
    this.gl.attachShader(program, compile(this.gl, this.gl.FRAGMENT_SHADER, fragmentSource))
    this.gl.linkProgram(program)
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new CompositorError(
        `nối program hỏng:\n${this.gl.getProgramInfoLog(program) ?? ''}`,
      )
    }
    this.program = program
    this.gl.useProgram(program)
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name))
    }
    return this.uniforms.get(name) ?? null
  }

  private upload2d(name: string, unit: number, spec: BufferSpec): void {
    const gl = this.gl
    const texture = this.textures.get(name) ?? gl.createTexture()
    if (!texture) throw new CompositorError(`không tạo được texture ${name}`)
    this.textures.set(name, texture)
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // Đặt LẠI tường minh: `UNPACK_FLIP_Y_WEBGL` là trạng thái toàn cục và `setFrame()` bật nó
    // lên cho texture video. Dựng lại plate trong lúc video đang chạy sẽ nạp buffer bị lật —
    // và ảnh ra vẫn "trông như một cái mockup", chỉ lộn ngược.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    const { internal, format, type } = formatFor(gl, spec)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internal,
      spec.width,
      spec.height,
      0,
      format,
      type,
      typedView(spec),
    )
    // NEAREST cho buffer của plate: chúng ở ĐÚNG độ phân giải khung vẽ, nên nội suy chỉ làm
    // nhoè. Riêng `uv` thì nội suy còn SAI: trộn toạ độ hai bên mép mặt nạ ra một toạ độ lai
    // trỏ vào giữa màn hình.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(this.uniform(name), unit)
  }

  /** Nạp plate. Gọi lại khi đổi góc camera; giữa các frame video thì không cần. */
  setPlate(buffers: PlateBuffers): void {
    const { base, t, alpha, uv } = buffers
    for (const [name, spec] of Object.entries(buffers)) {
      if (spec.width !== base.width || spec.height !== base.height) {
        throw new CompositorError(
          `buffer ${name} là ${spec.width}×${spec.height}, khác base ${base.width}×${base.height}`,
        )
      }
    }
    // uv phải là float32. half có 11 bit mantissa nên gần 1.0 sai 1/2048 — nhân với 1179 px
    // chiều ngang ảnh màn hình là 0.58 px, vượt ngưỡng "dưới một pixel" của spike Pha 2.5.
    if (uv.dtype !== 'float32') {
      throw new CompositorError(`uv phải là float32, nhận ${uv.dtype}`)
    }
    this.upload2d('uBase', 0, base)
    this.upload2d('uT', 1, t)
    this.upload2d('uAlpha', 2, alpha)
    this.upload2d('uUv', 3, uv)
    this.size = { width: base.width, height: base.height }
    this.gl.canvas.width = base.width
    this.gl.canvas.height = base.height
    this.gl.viewport(0, 0, base.width, base.height)
  }

  setAgxLut(lut: AgxLut): void {
    const gl = this.gl
    const texture = this.textures.get('uAgx') ?? gl.createTexture()
    if (!texture) throw new CompositorError('không tạo được texture LUT')
    this.textures.set('uAgx', texture)
    gl.activeTexture(gl.TEXTURE0 + 5)
    gl.bindTexture(gl.TEXTURE_3D, texture)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB16F,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGB,
      gl.HALF_FLOAT,
      new Uint16Array(lut.data),
    )
    // LINEAR: nội suy tam tuyến tính của phần cứng chính là thuật toán mà self-check của
    // `bake_agx_lut.py` đã đo (99.54% pixel trong 1/255).
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, wrap, gl.CLAMP_TO_EDGE)
    }
    gl.uniform1i(this.uniform('uAgx'), 5)
    gl.uniform1f(this.uniform('uAgxSize'), lut.size)
    gl.uniform1f(this.uniform('uAgxLogMin'), lut.logMin)
    gl.uniform1f(this.uniform('uAgxLogRange'), lut.logRange)
  }

  /**
   * Đặt frame màn hình. `source` là `<video>`, `<canvas>` hay `ImageBitmap`.
   *
   * `SRGB8_ALPHA8` chứ không phải `RGBA8`: nhờ vậy GPU tự giải sRGB khi lấy mẫu và giá trị vào
   * shader đã là tuyến tính. Tự giải trong shader thì tốn hơn và mất luôn lọc mip đúng cách —
   * mip phải lấy trung bình trong không gian tuyến tính.
   */
  /**
   * Phép khớp tỉ lệ cho nội dung màn hình. Gọi lại khi đổi chế độ hoặc đổi video.
   *
   * Tính bằng `screenFitTransform` của `entities/screen-fit` — cùng một hàm thuần mà preview
   * và export đều dùng, nên hai bên không thể khớp khác nhau.
   */
  setContentFit(scale: { x: number; y: number }, letterbox: boolean): void {
    this.gl.useProgram(this.program)
    this.gl.uniform2f(this.uniform('uContentScale'), scale.x, scale.y)
    this.gl.uniform1f(this.uniform('uLetterbox'), letterbox ? 1 : 0)
  }

  setFrame(source: TexImageSource, meanColour: [number, number, number]): void {
    const gl = this.gl
    this.video ??= gl.createTexture()
    if (!this.video) throw new CompositorError('không tạo được texture video')
    gl.activeTexture(gl.TEXTURE0 + 4)
    gl.bindTexture(gl.TEXTURE_2D, this.video)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(this.uniform('uVideo'), 4)
    gl.uniform3f(this.uniform('uMeanColour'), ...meanColour)
  }

  draw(): void {
    const gl = this.gl
    if (this.size.width === 0) throw new CompositorError('chưa nạp plate')
    gl.useProgram(this.program)
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Đọc ngược khung vừa vẽ, dòng đầu là dòng TRÊN (ngược với thứ tự của GL). */
  readPixels(): Uint8ClampedArray {
    const { width, height } = this.size
    const flipped = new Uint8Array(width * height * 4)
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, flipped)
    const out = new Uint8ClampedArray(width * height * 4)
    const stride = width * 4
    for (let y = 0; y < height; y++) {
      out.set(flipped.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride)
    }
    return out
  }

  dispose(): void {
    for (const texture of this.textures.values()) this.gl.deleteTexture(texture)
    this.textures.clear()
    if (this.video) this.gl.deleteTexture(this.video)
    this.gl.deleteProgram(this.program)
  }
}
