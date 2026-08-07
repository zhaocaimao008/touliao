import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:760,height:900}});
await p.goto('file:///tmp/real.html');
await p.waitForTimeout(300);
const r = await p.evaluate(()=>{
  const reply=document.querySelector('.wc-msg-reply');
  const walk=(el,depth)=>{
    const rect=el.getBoundingClientRect();
    const cs=getComputedStyle(el);
    const out=[{d:depth, tag:el.tagName, cls:el.className, h:Math.round(rect.height), w:Math.round(rect.width),
      disp:cs.display, ar:cs.aspectRatio, minH:cs.minHeight, cv:cs.contentVisibility, cis:cs.containIntrinsicSize, of:cs.objectFit}];
    for(const c of el.children) out.push(...walk(c,depth+1));
    return out;
  };
  return {html: reply.outerHTML.slice(0,400), tree: walk(reply,0)};
});
console.log(r.html);
console.log('---');
for(const n of r.tree) console.log(`${'  '.repeat(n.d)}${n.tag}.${n.cls} h=${n.h} w=${n.w} disp=${n.disp} ar=${n.ar} minH=${n.minH} cv=${n.cv} cis=${n.cis} of=${n.of}`);
await b.close();
