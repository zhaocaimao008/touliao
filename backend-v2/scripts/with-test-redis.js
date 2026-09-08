'use strict';
// Starts and terminates only a private Redis process; never flushes an existing Redis service.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tl-redis-test-'));
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const redis=spawn('redis-server',['--bind','127.0.0.1','--port',String(port),'--save','','--appendonly','no','--dir',dir],{stdio:['ignore','pipe','pipe']});
  let child;
  const cleanup=()=>{child?.kill('SIGTERM');redis.kill('SIGTERM');};
  process.once('SIGTERM',cleanup);process.once('SIGINT',cleanup);
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('private Redis startup timeout')),5000);
      redis.once('error',reject);redis.once('exit',code=>reject(new Error(`private Redis exited: ${code}`)));
      redis.stdout.on('data',data=>{if(data.toString().includes('Ready to accept connections')){clearTimeout(timeout);resolve();}});
    });
    const env={...process.env,TEST_REDIS_URL:`redis://127.0.0.1:${port}`,TEST_REDIS_PORT:String(port)};
    const run=(cmd,args)=>new Promise((resolve,reject)=>{child=spawn(cmd,args,{stdio:'inherit',env});child.once('error',reject);child.once('exit',code=>resolve(code ?? 1));});
    console.log('Private Redis ready; persistence disabled.');
    const integration=await run(process.execPath,['test/security-events.integration.js']);
    if(integration) return integration;
    const queue = await run(process.execPath,['test/redis-queue.integration.js']);
    if(queue) return queue;
    const [cmd,...args]=process.argv.slice(2);
    return cmd ? await run(cmd,args) : 0;
  } finally {
    const exited=new Promise(r=>redis.once('exit',r));redis.kill('SIGTERM');await exited;
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e);process.exitCode=1;});
