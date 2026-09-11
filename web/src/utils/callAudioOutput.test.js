import { expect, test, vi } from 'vitest';
import { createCallAudioOutput } from './callAudioOutput';
const device = () => ({ sink: '', async setSinkId(id) { this.sink = id; } });

test('switch applies to existing and newly joined participants', async () => {
  const output = createCallAudioOutput();
  const a = device(), b = device();
  output.register(a);
  await output.select('headset');
  output.register(b);
  await output.select('headset');
  expect([a.sink,b.sink,output.selected]).toEqual(['headset','headset','headset']);
  output.dispose();
});

test('failed switch rolls all participants back and preserves the chosen label', async () => {
  const onError = vi.fn();
  const output = createCallAudioOutput({onError});
  const a = device(), b = device();
  output.register(a); output.register(b);
  await output.select('working');
  b.setSinkId = async id => { if (id === 'missing') throw new Error('Unplugged'); b.sink = id; };
  await expect(output.select('missing')).rejects.toThrow('Unplugged');
  expect([a.sink,b.sink,output.selected]).toEqual(['working','working','working']);
  expect(onError).toHaveBeenCalledOnce();
});

test('rapid choices are serialized even if setSinkId resolves late', async () => {
  const output = createCallAudioOutput();
  const a = device(); output.register(a);
  let release;
  a.setSinkId = async id => { if(id==='slow') await new Promise(r=>{release=r;}); a.sink=id; };
  const slow = output.select('slow');
  const latest = output.select('latest');
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  release(); await Promise.all([slow,latest]);
  expect(a.sink).toBe('latest'); expect(output.selected).toBe('latest');
});

test('participant joining during a pending change uses the selected device', async () => {
  const output = createCallAudioOutput();
  const a=device(), b=device();let release;
  a.setSinkId=async id=>{await new Promise(r=>{release=r;});a.sink=id;};
  output.register(a);const switchDevice=output.select('headset');
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  output.register(b);release();await switchDevice;
  expect([a.sink,b.sink]).toEqual(['headset','headset']);
});

test('unmount suppresses completion callbacks from delayed device operations', async () => {
  const onChange=vi.fn();const output=createCallAudioOutput({onChange});const a=device();let release;
  a.setSinkId=async()=>{await new Promise(r=>{release=r;});};output.register(a);
  const work=output.select('late');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  output.dispose();release();await work;expect(onChange).not.toHaveBeenCalled();
});
