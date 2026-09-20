import { expect, test, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../../admin/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('const safetyState='),html.indexOf('// ── 安全 ──'));
function element(tag='div') { return {tag,children:[],value:'',innerHTML:'',textContent:'',hidden:true,append(...nodes){this.children.push(...nodes);},setAttribute(){},querySelectorAll(){return [];}}; }
function fixture() {
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};$('safety-status').value='pending';
  let status='pending';const report=()=>({id:'ticket-1',target_type:'user',target_id:'user-1',reporter_id:'reporter-1',snapshot:'<img src=x onerror=alert(1)>',reason:'synthetic reason',status,events:[{status,note:'synthetic',actor:'admin'}]});
  const api=vi.fn(async(url,options)=>{
    if(url==='/safety-reports/ticket-1/resolve'){status=options.body.status;return report();}
    if(url.startsWith('/safety-reports?'))return {items:[report()],total:1};
    if(url==='/safety-reports/ticket-1')return report();
    if(url==='/users/user-1/ban')return {success:true};
    throw new Error(`unexpected ${url}`);
  });
  const context={$ ,api,document:{createElement:element},esc:v=>String(v??'').replace(/</g,'&lt;'),toast:vi.fn(),renderPage:vi.fn(),confirm:()=>true,encodeURIComponent};vm.createContext(context);vm.runInContext(code,context);
  return {context,$,api};
}
test('admin queue and detail use the real backend contract; note is required before state advances',async()=>{
  const {context,$,api}=fixture();await context.loadSafetyReports();
  expect($('safety-body').innerHTML).toContain('ticket-1');expect($('safety-body').innerHTML).toContain('synthetic reason');
  await context.openSafetyReport('ticket-1');const detail=$('safety-detail');
  expect(detail.innerHTML).toContain('&lt;img');expect(detail.innerHTML).not.toContain('<img');
  const [select,note,save]=detail.children;select.value='reviewing';
  await save.onclick();expect(api.mock.calls.some(([url])=>url.endsWith('/resolve'))).toBe(false);
  note.value='已受理，正在核实';await save.onclick();
  expect(api).toHaveBeenCalledWith('/safety-reports/ticket-1/resolve',{method:'POST',body:{status:'reviewing',note:'已受理，正在核实'}});
});
test('admin enforcement button calls existing target endpoint before suggesting a resolution note',async()=>{
  const {context,$,api}=fixture();
  await api('/safety-reports/ticket-1/resolve',{body:{status:'reviewing'}});
  await context.openSafetyReport('ticket-1');
  const enforce=$('safety-detail').children.find(node=>node.textContent==='封禁用户');expect(enforce).toBeTruthy();
  await enforce.onclick();expect(api).toHaveBeenCalledWith('/users/user-1/ban',{method:'POST',body:{}});
  expect($('safety-detail').children.find(node=>node.tag==='textarea').value).toContain('已核实并执行');
});
