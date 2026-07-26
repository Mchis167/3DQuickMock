import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Phép ghép của Pha 5 chỉ được tồn tại ở MỘT chỗ.
 *
 * Đây là rào chắn giữ lời hứa lớn nhất của cả pha: preview và export không lệch nhau vì chúng
 * chạy cùng một mã nguồn, chứ không phải vì đo thấy hai bên gần nhau. Lời hứa đó chết ngay
 * khoảnh khắc ai đó chép shader ra làm một bản "cho export" — và nó chết trong im lặng, vì cả
 * hai bản đều chạy tốt cho tới lúc một bên được sửa.
 *
 * Cưỡng chế bằng test chứ không bằng lời dặn trong AGENTS.md, vì lời dặn không fail CI.
 */

const ROOT = path.resolve(__dirname, '..')
const SOURCE = 'src/entities/composite/composite.frag.glsl'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('một nguồn sự thật cho phép ghép', () => {
  it('chỉ có đúng một file .glsl chứa phép ghép', () => {
    const shaders = walk(path.join(ROOT, 'src'))
      .filter((f) => f.endsWith('.glsl'))
      .map((f) => path.relative(ROOT, f))
    // Vertex shader nằm inline trong `compositor.ts` nên nó không tính; chỉ fragment shader
    // của phép ghép mới là file riêng.
    expect(shaders).toEqual([SOURCE])
  })

  it('không có bản chép tay của phép ghép trong TypeScript', () => {
    // Dấu vân tay của phép ghép: cộng base với tích của toán tử truyền. Nếu nó xuất hiện
    // trong .ts thì đã có người viết lại bằng JS — và bản đó sẽ trôi khỏi shader.
    const suspicious = walk(path.join(ROOT, 'src'))
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
      .filter((f) => {
        const text = readFileSync(f, 'utf8')
        return /textureGrad|\bagx\s*\(|uMeanColour\s*\*/.test(text)
      })
      .map((f) => path.relative(ROOT, f))
    expect(suspicious).toEqual([])
  })

  it('ffmpeg không được tự giải mã video nguồn', () => {
    // Cổng của Pha 5: ffmpeg chỉ mã hoá. Thêm một `-i` nữa là nó đã tham gia phép ghép, và
    // lúc đó bản xuất ra đi qua một bộ giải mã KHÁC bộ giải mã của preview — cùng một khung
    // hình mà Chrome và ffmpeg lệch tb 2.3-9.5/255, chỉ 24-47% pixel trùng.
    // Bỏ chú thích trước khi soi: chính file này GIẢI THÍCH vì sao không dùng `remap`, nên
    // so trên văn bản thô sẽ bắt phải lời giải thích thay vì bắt code.
    const builder = readFileSync(
      path.join(ROOT, 'src/server/export-video/ffmpeg-args.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(builder).toContain("'pipe:0'")
    expect(builder).not.toMatch(/'-vf'|'-filter_complex'|'-lavfi'|remap/)
  })

  it('vertex shader phải LẬT Y, và plate phải nạp không lật', () => {
    // Buffer của plate ghi dòng TRÊN trước, còn NDC y = -1 là ĐÁY khung. Không lật thì cả
    // mockup lộn ngược — dấu hiệu nhận ra là cụm Dynamic Island nằm ở đáy máy. Ảnh vẫn "trông
    // như một cái mockup" nên rất dễ lọt.
    const compositor = readFileSync(
      path.join(ROOT, 'src/entities/composite/compositor.ts'),
      'utf8',
    )
    expect(compositor).toMatch(/vUv\s*=\s*vec2\(p\.x,\s*1\.0\s*-\s*p\.y\)/)
    // `UNPACK_FLIP_Y_WEBGL` là trạng thái toàn cục; `setFrame` bật nó cho texture video, nên
    // đường nạp plate phải tắt lại tường minh.
    expect(compositor).toMatch(/UNPACK_FLIP_Y_WEBGL,\s*false/)
    expect(compositor).toMatch(/UNPACK_FLIP_Y_WEBGL,\s*true/)
  })

  it('shader giữ đúng những bước KHÔNG được bỏ', () => {
    const source = readFileSync(path.join(ROOT, SOURCE), 'utf8')
    // Ba bước dưới đây đều từng được đo là quan trọng, và bỏ bước nào cũng cho ra ảnh trông
    // bình thường — nên chúng phải bị khoá lại bằng chữ, không chỉ bằng ý định.
    //
    //  - chia alpha TRƯỚC tone map: bỏ thì riêng vành silhouette lệch gấp bội
    //  - `textureGrad` với đạo hàm của chính UV: bỏ thì GPU chọn nhầm mip ở mép mặt nạ
    //  - số hạng hắt sáng: bỏ thì thân máy lệch 2.9 -> 7.4/255
    expect(source).toMatch(/agx\(\s*linear\s*\/\s*max\(\s*alpha/)
    expect(source).toMatch(/textureGrad\(uVideo, clamp\(content, 0\.0, 1\.0\), ddx, ddy\)/)
    // Đạo hàm phải lấy trên toạ độ ĐÃ khớp tỉ lệ, không phải toạ độ gốc: lấy sai thì mức mip
    // lệch theo đúng tỉ lệ phóng và vùng bị thu nhỏ hiện răng cưa.
    expect(source).toMatch(/ddx\s*=\s*dFdx\(content\)/)
    // Ba chế độ khớp tỉ lệ phải nằm TRONG shader — video không khớp được ở server như ảnh.
    expect(source).toContain('uContentScale')
    expect(source).toContain('uLetterbox')
    expect(source).toContain('uMeanColour')
    // Trả premultiplied cho canvas — phải khớp `premultipliedAlpha: true` của context.
    expect(source).toMatch(/outColour\s*=\s*vec4\(\s*display\s*\*\s*alpha,\s*alpha\s*\)/)
  })
})
