import { beforeEach, expect, test, vi } from 'vitest';
const env = vi.hoisted(() => {
  globalThis.window = { location: { search: '' } };
  globalThis.document = { body: {} };
  return { slots: [], cursor: 0, effects: [], login: vi.fn() };
});
vi.mock('react', async original => ({ ...(await original()),
  useState: initial => { const i=env.cursor++; if (!(i in env.slots)) env.slots[i]=typeof initial==='function'?initial():initial; return [env.slots[i], v=>{env.slots[i]=typeof v==='function'?v(env.slots[i]):v;}]; },
  useRef: initial => { const i=env.cursor++; if (!(i in env.slots)) env.slots[i]={current:initial}; return env.slots[i]; },
  useEffect: fn => { env.effects.push(fn); }, useCallback: fn=>fn,
}));
vi.mock('react-dom', () => ({createPortal: node=>node}));
vi.mock('axios', () => ({ default: { get:vi.fn(),post:vi.fn(),defaults:{} } }));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn(),useLocation:()=>({}),Link:'a'}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({login:env.login,accounts:[],maxAccounts:5})}));
vi.mock('../contexts/I18nContext',()=>({useI18n:()=>({t:key=>key})}));
vi.mock('../utils/rememberedCreds',()=>({lastRememberedPhone:()=>'',saveCred:vi.fn(),hasCred:()=>false,removeCred:vi.fn()}));
vi.mock('../utils/clientStorage',()=>({clientStorage:{getItem:()=>null}}));
vi.mock('../utils/config',()=>({timeoutSignal:()=>null,resolveTenantCode:vi.fn()}));
vi.mock('../utils/toast',()=>({showToast:vi.fn()}));
vi.mock('./AccountWindowButton',()=>({default:()=>null}));
import axios from 'axios';
import Login from '../pages/Login';
import Register from '../pages/Register';
import LegalConsent from './LegalConsent';
import { ReportDialog } from './ReportDialog';
const consent={accepted:true,privacyVersion:'2026-09-20',termsVersion:'2026-09-20'};
const doc=kind=>({data:{version:'2026-09-20',text:`${kind} synthetic policy text`}});
const render=(component,props={})=>{env.cursor=0;return component(props);};
function find(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const c of [node.props?.children].flat(Infinity)){const r=find(c,predicate);if(r)return r;}}
const byText=(tree,text)=>find(tree,n=>n.props?.children===text);
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
beforeEach(()=>{env.slots=[];env.effects=[];env.cursor=0;vi.clearAllMocks();axios.get.mockImplementation(url=>Promise.resolve(doc(url)));axios.post.mockResolvedValue({data:{user:{id:'synthetic'},token:'synthetic'}});});
test.each([[Login,'login'],[Register,'register']])('%s blocks unchecked submission and transmits selected policy versions',async(Component,kind)=>{
  let tree=render(Component);
  const submit=()=>find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  await submit();expect(axios.post).not.toHaveBeenCalled();
  const legal=find(tree,n=>n.type===LegalConsent);expect(legal).toBeTruthy();
  legal.props.onChange(consent);tree=render(Component);
  if(kind==='register'){
    for(const input of ['username','phone','password','inviteCode']) {
      const n=find(tree,n=>n.type==='input'&&n.props.id===`reg-${input}`);
      // Actual form uses reg-* IDs; values satisfy the existing validation.
      expect(n).toBeTruthy();n.props.onChange({target:{value:{username:'tester',phone:'13012345678',password:'Testpass123',inviteCode:'123456'}[input]}});tree=render(Component);
    }
  }
  await submit();expect(axios.post).toHaveBeenCalledWith(`/api/auth/${kind}`,expect.objectContaining({legalConsent:consent}));
  expect(env.login).toHaveBeenCalledOnce();
  find(tree,n=>n.type===LegalConsent).props.onChange({...consent,accepted:false});tree=render(Component);
  await submit();expect(axios.post).toHaveBeenCalledTimes(1);
});
test('policy text opens, consent starts unchecked and remains unavailable on load failure',async()=>{
  const onChange=vi.fn();let tree=render(LegalConsent,{onChange});
  let checkbox=find(tree,n=>n.type==='input');expect(checkbox.props.checked).toBe(false);expect(checkbox.props.disabled).toBe(true);
  axios.get.mockRejectedValueOnce(new Error('synthetic offline'));env.effects.shift()();await flush();tree=render(LegalConsent,{onChange});
  expect(find(tree,n=>n.type==='input').props.disabled).toBe(true);expect(find(tree,n=>n.props?.role==='alert')).toBeTruthy();
  env.effects.at(-1)();await flush();tree=render(LegalConsent,{onChange});
  checkbox=find(tree,n=>n.type==='input');expect(checkbox.props.disabled).toBe(false);
  checkbox.props.onChange({target:{checked:true}});expect(onChange).toHaveBeenCalledWith(consent);
  byText(tree,'隐私政策').props.onClick();tree=render(LegalConsent,{onChange});
  expect(find(tree,n=>n.props?.role==='dialog').props['aria-label']).toBe('隐私政策');
  expect(find(tree,n=>n.props?.children==='/api/legal/privacy synthetic policy text')).toBeTruthy();
});
test('report failure never shows success; retry returns a durable ID and refresh shows resolution',async()=>{
  axios.get.mockResolvedValue({data:{items:[],hasMore:false}});
  axios.post.mockRejectedValueOnce({response:{data:{error:'synthetic unavailable'}}});
  const props={targetType:'message',targetId:'message-1',onClose:vi.fn()};
  let tree=render(ReportDialog,props);
  find(tree,n=>n.type==='textarea').props.onChange({target:{value:'synthetic abuse'}});tree=render(ReportDialog,props);
  await find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render(ReportDialog,props);
  expect(find(tree,n=>n.props?.role==='alert').props.children).toBe('synthetic unavailable');expect(find(tree,n=>n.props?.role==='status')).toBeUndefined();
  axios.post.mockResolvedValue({data:{id:'ticket-123',status:'pending'}});
  await find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render(ReportDialog,props);
  expect(axios.post).toHaveBeenLastCalledWith('/api/reports',{targetType:'message',targetId:'message-1',reason:'synthetic abuse'},{skipRetry:true});
  expect(find(tree,n=>n.props?.role==='status')).toBeTruthy();
  axios.get.mockResolvedValue({data:{items:[{id:'ticket-123',status:'resolved',reason:'synthetic abuse',resolution:'已核实并处理'}],hasMore:false}});
  await byText(tree,'刷新状态').props.onClick();tree=render(ReportDialog,props);
  expect(byText(tree,'已核实并处理')).toBeTruthy();
});
