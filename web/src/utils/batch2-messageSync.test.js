import { test, expect } from 'vitest';
import { applySyncEvents } from './messageSync';
test('offline clear removes old committed messages and preserves later messages and pending outbox',()=>{
 const current=[{id:'old',server_sequence:1},{id:'pending',_tempId:'pending'},{id:'new',server_sequence:4}];
 expect(applySyncEvents(current,[{event_type:'conversation_cleared',server_sequence:3,payload:{}}]).map(x=>x.id)).toEqual(['pending','new']);
});
test('burn read event carries server deadline without using send time',()=>{
 const m={id:'a',created_at:1,server_sequence:1,burn_after:60};
 expect(applySyncEvents([m],[{event_type:'message_burn_started',message_id:'a',server_sequence:2,payload:{burn_expires_at:'200',burn_read_at:'140'}}])[0]).toMatchObject({burn_expires_at:200,burn_read_at:140});
});
