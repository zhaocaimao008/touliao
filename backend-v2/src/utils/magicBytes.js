'use strict';

// 纯 CJS 文件头兜底；只识别明确签名，未知内容或不完整签名返回 null。
function detectMagicBytes(buf) {
  try {
    if (!Buffer.isBuffer(buf)) return null;
    const matches = (bytes, offset = 0) => buf.length >= offset + bytes.length
      && bytes.every((byte, index) => buf[offset + index] === byte);
    const ascii = (value, offset = 0) => buf.length >= offset + value.length
      && buf.toString('latin1', offset, offset + value.length) === value;

    if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
    if (matches([0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
    if (ascii('GIF87a') || ascii('GIF89a')) return { ext: 'gif', mime: 'image/gif' };
    if (ascii('RIFF')) {
      if (ascii('WEBP', 8)) return { ext: 'webp', mime: 'image/webp' };
      if (ascii('WAVE', 8)) return { ext: 'wav', mime: 'audio/wav' };
    }
    if (ascii('BM')) return { ext: 'bmp', mime: 'image/bmp' };
    if (matches([0x49, 0x49, 0x2a, 0x00]) || matches([0x4d, 0x4d, 0x00, 0x2a])) {
      return { ext: 'tif', mime: 'image/tiff' };
    }

    // ftyp 的 major brand 位于 offset 8；保留 M4A/M4B 的音频 MIME。
    if (buf.length >= 12 && ascii('ftyp', 4)) {
      switch (buf.toString('latin1', 8, 12)) {
        case 'M4A ': case 'M4B ':
          return { ext: 'm4a', mime: 'audio/x-m4a' };
        case 'isom': case 'iso2': case 'mp41': case 'mp42': case 'avc1': case 'dash':
          return { ext: 'mp4', mime: 'video/mp4' };
        case 'qt  ':
          return { ext: 'mov', mime: 'video/quicktime' };
        case 'avif': case 'avis':
          return { ext: 'avif', mime: 'image/avif' };
        case 'heic': case 'heix': case 'hevc': case 'mif1':
          return { ext: 'heic', mime: 'image/heic' };
        case '3gp4': case '3gp5':
          return { ext: '3gp', mime: 'video/3gpp' };
        default:
          return null;
      }
    }

    if (matches([0x1a, 0x45, 0xdf, 0xa3])) {
      if (buf.includes('webm')) return { ext: 'webm', mime: 'video/webm' };
      if (buf.includes('matroska')) return { ext: 'mkv', mime: 'video/x-matroska' };
      return null;
    }
    if (ascii('OggS')) return { ext: 'ogg', mime: 'audio/ogg' };
    if (ascii('ID3') || (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
      return { ext: 'mp3', mime: 'audio/mpeg' };
    }
    if (ascii('fLaC')) return { ext: 'flac', mime: 'audio/flac' };
    if (ascii('%PDF')) return { ext: 'pdf', mime: 'application/pdf' };
    if (matches([0x50, 0x4b, 0x03, 0x04]) || matches([0x50, 0x4b, 0x05, 0x06])) {
      return { ext: 'zip', mime: 'application/zip' };
    }
    if (matches([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { ext: '7z', mime: 'application/x-7z-compressed' };
    if (matches([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return { ext: 'rar', mime: 'application/vnd.rar' };
    if (matches([0x1f, 0x8b])) return { ext: 'gz', mime: 'application/gzip' };
    if (ascii('MZ')) return { ext: 'exe', mime: 'application/x-msdownload' };
    if (matches([0x7f, 0x45, 0x4c, 0x46])) return { ext: 'elf', mime: 'application/x-elf' };
    if (matches([0xfe, 0xed, 0xfa, 0xce]) || matches([0xfe, 0xed, 0xfa, 0xcf])
      || matches([0xcf, 0xfa, 0xed, 0xfe])) {
      return { ext: 'macho', mime: 'application/x-mach-binary' };
    }
    if (matches([0x00, 0x61, 0x73, 0x6d])) return { ext: 'wasm', mime: 'application/wasm' };
    return null;
  } catch {
    return null;
  }
}

module.exports = { detectMagicBytes };
