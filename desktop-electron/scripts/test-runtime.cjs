'use strict';
// Linux runtime smoke only; does not certify Windows packaging or signing.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');const os = require('os');const path = require('path');const assert = require('assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'tl-electron-runtime-'));
app.setPath('userData',dir);
app.whenReady().then(async()=>{
  try {
    const Store=require('electron-store');const store=new Store({cwd:dir});store.set('smoke',true);assert.equal(store.get('smoke'),true);
    const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'../src/preload.js')}});
    await win.loadURL('data:text/html,<html><body>isolated smoke</body></html>');
    assert.equal(await win.webContents.executeJavaScript('typeof require'),'undefined');
    const globals=await win.webContents.executeJavaScript('Object.keys(window).filter(k=>/electron|desktop/i.test(k))');
    assert.ok(globals.length>0,'preload bridge must initialize');
    console.log(JSON.stringify({electron:process.versions.electron,platform:process.platform,store:true,sandboxConfigured:true,osSandboxDisabled:app.commandLine.hasSwitch('no-sandbox'),bridge:globals}));
    win.destroy();
  } catch(e) {console.error(e);process.exitCode=1;}
  finally {app.quit();}
});
app.on('quit',()=>{fs.rmSync(dir,{recursive:true,force:true});});
