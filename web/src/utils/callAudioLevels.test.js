import { expect, test, vi } from 'vitest';
import { createCallAudioLevels } from './callAudioLevels';
function fixture() {
  let sample = 128;
  const source = { connect:vi.fn(), disconnect:vi.fn() };
  const analyser = { fftSize:0, disconnect:vi.fn(), getByteTimeDomainData: data=>data.fill(sample) };
  const context = { state:'running', createMediaStreamSource:()=>source, createAnalyser:()=>analyser };
  const track = {readyState:'live', enabled:true, muted:false};
  const stream = {getAudioTracks:()=>[track]};
  return {context,source,analyser,track,stream,sample:value=>{sample=value;}};
}
test('speech hysteresis holds briefly then returns to silence', () => {
  const f=fixture();const update=vi.fn();const levels=createCallAudioLevels(f.context,update);
  levels.sync({self:f.stream});f.sample(140);levels.sample(100);
  expect(update.mock.lastCall[0].self.speaking).toBe(true);
  f.sample(128);levels.sample(200);expect(update.mock.lastCall[0].self.speaking).toBe(true);
  levels.sample(600);expect(update.mock.lastCall[0].self.speaking).toBe(false);
});
test('muted microphone stops speaking immediately and cleanup never stops the call track', () => {
  const f=fixture();const update=vi.fn();const levels=createCallAudioLevels(f.context,update);
  levels.sync({self:f.stream});f.sample(140);levels.sample(100);f.track.enabled=false;levels.sample(101);
  expect(update.mock.lastCall[0].self.speaking).toBe(false);
  levels.dispose();expect(f.source.disconnect).toHaveBeenCalledOnce();expect(f.track.readyState).toBe('live');
});
test('member leaving clears their meter without an extra audio destination', () => {
  const f=fixture();const update=vi.fn();const levels=createCallAudioLevels(f.context,update);
  levels.sync({peer:f.stream});f.sample(145);levels.sample(1);
  levels.sync({});levels.sample(2);expect(update.mock.lastCall[0]).toEqual({});
  expect(f.source.connect).toHaveBeenCalledOnce();
  expect(f.source.connect).toHaveBeenCalledWith(f.analyser);
});
