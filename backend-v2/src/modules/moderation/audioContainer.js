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
module.exports = { isAudioOnlyWebm };
