'use strict';
const fs = require('fs');
// WebM magic alone cannot distinguish MediaRecorder audio from video. Inspect
// every Tracks element without reading frame payloads; malformed/unknown tracks
// fail closed. This is format classification, never a content-safety verdict.
async function isAudioOnlyWebm(filename) {
  let file;
  try {
    file = await fs.promises.open(filename,'r');
    const size = (await file.stat()).size;
    let elements = 0, tracks = 0;
    async function bytes(offset,length) {
      const buffer = Buffer.alloc(length);
      if ((await file.read(buffer,0,length,offset)).bytesRead !== length) throw new Error('truncated');
      return buffer;
    }
    async function vint(offset, id=false) {
      const first = (await bytes(offset,1))[0];
      let length=1, mask=128;
      while (length<=8 && !(first&mask)) { length++; mask>>=1; }
      if (length>8 || (id && length>4)) throw new Error('invalid vint');
      const b = await bytes(offset,length);
      let value = BigInt(id ? first : first & (mask-1));
      for (let n=1;n<length;n++) value=(value<<8n)|BigInt(b[n]);
      const unknown = !id && value === (1n<<BigInt(7*length))-1n;
      if (!unknown && value>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('oversize');
      return {value:Number(value),length,unknown};
    }
    async function walk(start,end,parent) {
      let trackType = null;
      while (start<end) {
        if (++elements>10000) throw new Error('too many elements');
        const id=await vint(start,true), len=await vint(start+id.length);
        const data=start+id.length+len.length;
        if (len.unknown && id.value!==0x18538067) throw new Error('unknown element size');
        const next=len.unknown?end:data+len.value;
        if (next>end || next<data) throw new Error('invalid bounds');
        if (id.value===0x18538067 || id.value===0x1654ae6b || id.value===0xae) {
          if (id.value===0xae && parent!==0x1654ae6b) throw new Error('misplaced track');
          await walk(data,next,id.value);
        } else if (parent===0xae && id.value===0x83) {
          if (len.value!==1 || trackType!==null) throw new Error('invalid track');
          trackType=(await bytes(data,1))[0];
        }
        start=next;
      }
      if (parent===0xae) {
        if (trackType!==2) throw new Error('not audio');
        tracks++;
      }
    }
    await walk(0,size,null);
    return tracks>0;
  } catch { return false; }
  finally { if (file) await file.close(); }
}
// ISO BMFF brands (isom/mp42/M4A) do not prove the absence of video. Inspect
// every track's handler AND sample descriptions, with bounded metadata reads.
// Frame payloads are skipped; this classifies the container, not its content.
async function isAudioOnlyMp4(filename) {
  let file;
  try {
    file = await fs.promises.open(filename, 'r');
    const size = (await file.stat()).size;
    let count = 0;
    async function bytes(offset, length) {
      if (offset < 0 || offset + length > size) throw new Error('truncated');
      const buffer = Buffer.alloc(length);
      if ((await file.read(buffer, 0, length, offset)).bytesRead !== length) throw new Error('truncated');
      return buffer;
    }
    async function boxes(start, end) {
      const result = [];
      while (start < end) {
        if (++count > 10000 || end - start < 8) throw new Error('invalid boxes');
        const header = await bytes(start, 8);
        let length = header.readUInt32BE(0), headerSize = 8;
        if (length === 1) {
          const large = (await bytes(start + 8, 8)).readBigUInt64BE();
          if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('oversize');
          length = Number(large); headerSize = 16;
        } else if (length === 0) length = end - start;
        if (length < headerSize || length > end - start) throw new Error('invalid bounds');
        result.push({ type: header.toString('ascii', 4, 8), start: start + headerSize, end: start + length });
        start += length;
      }
      return result;
    }
    function one(items, type) {
      const matches = items.filter(b => b.type === type);
      if (matches.length !== 1) throw new Error('missing or duplicate box');
      return matches[0];
    }
    const children = box => boxes(box.start, box.end);
    const root = await boxes(0, size);
    const ftyp = one(root, 'ftyp');
    if (ftyp.end - ftyp.start < 8 || !root.some(b => b.type === 'mdat' && b.end > b.start)) return false;
    const moov = await children(one(root, 'moov'));
    const tracks = moov.filter(b => b.type === 'trak');
    if (!tracks.length) return false;
    for (const track of tracks) {
      const mdia = await children(one(await children(track), 'mdia'));
      const handler = one(mdia, 'hdlr');
      if (handler.end - handler.start < 24 || (await bytes(handler.start, 12)).toString('ascii', 8, 12) !== 'soun') return false;
      const minf = await children(one(mdia, 'minf'));
      const stbl = await children(one(minf, 'stbl'));
      const stsd = one(stbl, 'stsd');
      if (stsd.end - stsd.start < 8) return false;
      const descriptions = await boxes(stsd.start + 8, stsd.end);
      const header = await bytes(stsd.start, 8);
      if (header.readUInt32BE(0) !== 0 || header.readUInt32BE(4) !== descriptions.length || !descriptions.length) return false;
      // Native AAC and Safari AAC: unknown/encrypted/video sample entries fail closed.
      if (descriptions.some(b => b.type !== 'mp4a' || b.end - b.start < 28)) return false;
    }
    return true;
  } catch { return false; }
  finally { if (file) await file.close(); }
}
module.exports = { isAudioOnlyWebm, isAudioOnlyMp4 };
