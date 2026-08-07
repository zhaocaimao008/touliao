import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:760,height:900}});
await p.goto('file:///tmp/real.html');
await p.waitForTimeout(200);
const r = await p.evaluate(()=>{
  const reply=document.querySelector('.wc-msg-reply');
  const cs=getComputedStyle(reply);
  const media=reply.querySelector('.wc-msg-reply-media');
  const mcs=media?getComputedStyle(media):null;
  const thumb=reply.querySelector('.wc-msg-reply-thumb');
  const tcs=thumb?getComputedStyle(thumb):null;
  const wrap=document.querySelector('.wc-msg-bubble-wrap');
  const wcs=getComputedStyle(wrap);
  const bub=document.querySelector('.wc-msg-bubble');
  const bcs=getComputedStyle(bub);
  return {
    reply:{display:cs.display, height:cs.height, minHeight:cs.minHeight, flex:cs.flex, alignSelf:cs.alignSelf, flexDirection:cs.flexDirection},
    bubble:{display:bcs.display, height:bcs.height, flexDirection:bcs.flexDirection, alignItems:bcs.alignItems},
    wrap:{display:wcs.display, alignItems:wcs.alignItems, height:wcs.height},
    media: mcs?{display:mcs.display,height:mcs.height,flex:mcs.flex}:null,
    thumb: tcs?{display:tcs.display,width:tcs.width,height:tcs.height,minHeight:tcs.minHeight,objectFit:tcs.objectFit}:null,
  };
});
console.log(JSON.stringify(r,null,2));
await b.close();
