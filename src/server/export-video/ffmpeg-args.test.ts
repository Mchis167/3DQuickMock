import { describe, expect, it } from 'vitest'

import { containerFor, ffmpegArgs, keepsAlpha } from './ffmpeg-args'

describe('tham số ffmpeg cho export video', () => {
  const spec = { width: 1080, height: 1440, fps: 30, output: '/tmp/out.mov' }

  it('ĐÚNG MỘT đầu vào, và nó là pipe:0', () => {
    // Đây là một cổng "xong khi" của Pha 5, không phải chi tiết cài đặt: thêm một `-i` nghĩa
    // là ffmpeg đang tự giải mã video nguồn, tức nó đã tham gia vào phép ghép. Lúc đó preview
    // và export lại là hai đường khác nhau — đúng thứ cả pha này tồn tại để dẹp.
    const args = ffmpegArgs(spec)
    const inputs = args.filter((arg) => arg === '-i')
    expect(inputs).toHaveLength(1)
    expect(args[args.indexOf('-i') + 1]).toBe('pipe:0')
  })

  it('không có bộ lọc nào — ffmpeg chỉ mã hoá', () => {
    const args = ffmpegArgs(spec)
    for (const flag of ['-vf', '-filter_complex', '-lavfi', '-filter:v']) {
      expect(args, flag).not.toContain(flag)
    }
  })

  it('nhận RGBA thô đúng kích thước và nhịp khung hình', () => {
    const args = ffmpegArgs(spec)
    expect(args[args.indexOf('-f') + 1]).toBe('rawvideo')
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('rgba')
    expect(args[args.indexOf('-s') + 1]).toBe('1080x1440')
    expect(args[args.indexOf('-r') + 1]).toBe('30')
  })

  it('mov giữ alpha bằng ProRes 4444; mp4 thì KHÔNG và phải nói rõ', () => {
    expect(ffmpegArgs(spec)).toContain('prores_ks')
    expect(ffmpegArgs(spec)).toContain('yuva444p10le')
    expect(keepsAlpha('/tmp/out.mov')).toBe(true)
    expect(keepsAlpha('/tmp/out.webm')).toBe(true)
    // Nền trong suốt thành đen. Người dùng phải biết TRƯỚC khi đợi export xong.
    expect(keepsAlpha('/tmp/out.mp4')).toBe(false)
  })

  it('đuôi file lạ thì báo lỗi, không đoán bừa', () => {
    expect(() => containerFor('/tmp/out.avi')).toThrow(/không hỗ trợ/)
  })
})
