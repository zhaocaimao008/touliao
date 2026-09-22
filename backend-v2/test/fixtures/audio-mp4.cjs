'use strict';
// Synthetic BMFF metadata, no user recordings. Track assertions do not decode AAC.
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const box=(type,...data)=>{const body=Buffer.concat(data);return Buffer.concat([u32(body.length+8),Buffer.from(type),body]);};
function mp4({brand='isom',handlers=['soun'],codec='mp4a'}={}) {
  const tracks=handlers.map(handler=>box('trak',box('mdia',
    box('hdlr',Buffer.alloc(8),Buffer.from(handler),Buffer.alloc(12)),
    box('minf',box('stbl',box('stsd',Buffer.alloc(4),u32(1),box(codec,Buffer.alloc(28))))))));
  return Buffer.concat([box('ftyp',Buffer.from(brand),u32(0),Buffer.from('isommp42')),box('moov',...tracks),box('mdat',Buffer.from([0,1,2,3]))]);
}
module.exports={mp4,box};
