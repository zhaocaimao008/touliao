#!/usr/bin/env python3
"""Build a local screenshot comparison gallery, without copying prototype data to the app."""
import argparse, csv, json
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--evidence', required=True)
args=parser.parse_args()
root=Path(args.evidence).resolve()
repo=Path(__file__).resolve().parents[1]
rows=list(csv.DictReader((repo/'docs/ui-design-system/page-mapping.csv').open()))
core={'conversations':'conversations','chat':'chat'}
people={'contacts':'contacts','requests':'requests','contact-detail':'contact-detail','add-friend':'add-friend','create-group':'create-group','groups':'groups','group-detail':'group-detail','group-members':'group-permissions','group-announcement':'group-detail','search':'search','blocked':'blocked','contact-tags':'contact-tags','group-chat':'group-detail'}
settings={'profile':'profile','edit-profile':'edit-profile','settings':'profile','account':'account','privacy':'privacy','notifications':'notifications','appearance':'appearance','devices':'devices','device-detail':'devices','my-qr':'my-qr','files':'files','call-history':'call-history','voice-call':'voice-call','video-call':'video-call','login':'login','register':'register','forgot':'forgot','forgot-password':'forgot','reset-password':'account'}
content={'favorites':'favorites','discover':'discover','publish':'publish'}
def existing(path): return path if (root/path).is_file() else None
pages=[]
for row in rows:
  captures={}
  for platform,prefix in [('desktop','win32-1200'),('mobile','web-390')]:
    for theme in ['light','dark']:
      ident=row['id']; before=after=None
      if ident in core:
        after=existing(f'final-core/{prefix}-{theme}-{core[ident]}.png')
        if platform=='desktop':
          before=existing(f'before/chat-aurora-{theme}.png') if ident=='chat' else existing('before/home-1200.png') if theme=='light' else None
      for lookup,current,old in [(people,'final-people','before-journeys'),(settings,'final-settings','before-settings'),(content,'batch5','before-content')]:
        if ident in lookup:
          after=existing(f'{current}/{prefix}-{theme}-{lookup[ident]}.png')
          before=existing(f'{old}/{prefix}-{theme}-{lookup[ident]}.png')
      captures[f'{platform}-{theme}']={'before':before,'after':after,'reference':existing(f'reference/{platform}-{theme}-{ident}.png')}
  pages.append({'id':row['id'],'title':row['title'],'status':row['implementation'],'note':row['protocol_support'],'captures':captures})
data=json.dumps(pages,ensure_ascii=False).replace('</','<\\/')
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>投聊改版 · 设计与前后对照</title>
<style>body{margin:0;background:#f4f6fa;color:#17212e;font:15px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}header{padding:24px;background:white;border-bottom:1px solid #e7ebf2}h1{font-size:24px;margin:0 0 8px}p{margin:8px 0;color:#566376}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}select,button{font:inherit;padding:8px 12px;border:1px solid #a9b5c6;border-radius:8px;background:white}main{padding:24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0;background:white;border:1px solid #e7ebf2;border-radius:12px;padding:16px;align-self:start}figcaption{font-weight:600;margin-bottom:12px}img{width:100%;height:auto;display:block}a{color:#2864f0}#note{padding:16px;background:#edf3ff;border-radius:12px;margin-bottom:20px}.empty{padding:32px 16px;color:#566376}.twocol{grid-template-columns:repeat(2,minmax(0,1fr))}.hidden{display:none}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style>
<header><h1>投聊 UI 设计系统 · 实施对照</h1><p>源设计 42 页／66 类组件／136 图标。前后截图均为隔离测试数据；Windows 截图是 Chromium 模拟渲染，不代表原生 Windows 或手机真机验收。</p><p>参考图包含原型展示外壳，按内容、变量与层级对照。缺少后端能力的页面保留说明；部分设计页复用现有抽屉或设置页。</p><div class="controls"><label>页面 <select id="page"></select></label><label>布局 <select id="platform"><option value="desktop">桌面</option><option value="mobile">窄屏 Web</option></select></label><label>主题 <select id="theme"><option value="light">浅色</option><option value="dark">深色</option></select></label><button id="reference-toggle">隐藏设计参考</button></div></header>
<main><div id="note"></div><div class="grid" id="grid"></div></main><script>
const pages=DATA; const picker=document.querySelector('#page'); let showReference=true;
for(const p of pages){const o=new Option(p.title,p.id);picker.add(o)}picker.value='chat';
function render(){const p=pages.find(p=>p.id===picker.value);const c=p.captures[document.querySelector('#platform').value+'-'+document.querySelector('#theme').value];document.querySelector('#note').textContent=p.status+'。'+p.note;const grid=document.querySelector('#grid');grid.replaceChildren();grid.classList.toggle('twocol',!showReference);for(const [key,label]of [['before','改造前'],['after','改造后'],['reference','设计参考']]){if(key==='reference'&&!showReference)continue;const f=document.createElement('figure');const caption=document.createElement('figcaption');caption.textContent=label;f.append(caption);if(c[key]){const a=document.createElement('a');a.href=c[key];a.target='_blank';const img=document.createElement('img');img.src=c[key];img.alt=p.title+' · '+label;a.append(img);f.append(a)}else{const empty=document.createElement('div');empty.className='empty';empty.textContent=key==='after'?'没有对应的独立实现截图；请查看页面映射中的能力说明。':'未保存同一场景的独立截图。';f.append(empty)}grid.append(f)}}
for(const id of ['page','platform','theme'])document.querySelector('#'+id).addEventListener('change',render);document.querySelector('#reference-toggle').onclick=()=>{showReference=!showReference;document.querySelector('#reference-toggle').textContent=showReference?'隐藏设计参考':'显示设计参考';render()};render();</script></html>'''.replace('DATA',data)
(root/'review.html').write_text(html)
(root/'review-index.json').write_text(json.dumps(pages,ensure_ascii=False,indent=2)+'\n')
print(f'{root}/review.html: {len(pages)} pages')
