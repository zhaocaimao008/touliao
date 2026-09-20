import { test, expect } from 'vitest';
import { normalizeForwardResult } from './forwardResult';
test('HTTP success cannot disguise a filtered target; N-1 retry hints are preserved',()=>{
 const result=normalizeForwardResult({success:true,status:'success',success_count:1,retryable_message_ids:['missing'],target_results:[{conversation_id:'allowed',status:'success'},{conversation_id:'muted',status:'failed'}]});
 expect(result).toMatchObject({status:'partial_success',target_success_count:1,target_failed_count:1,retryable_message_ids:['missing']});
});
test.each([['success','success'],['failed','failed']])('uniform target %s is expressed as %s',(cell,status)=>{
 expect(normalizeForwardResult({target_results:[{status:cell},{status:cell}]}).status).toBe(status);
});
