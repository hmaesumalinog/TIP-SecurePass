import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshScheduler } from '../public/assets/js/refresh-scheduler.mjs';

test('admin refresh pauses offline/hidden, avoids overlapping requests and backs off after failure',async()=>{
  const doc=new EventTarget(),win=new EventTarget();doc.hidden=false;win.navigator={onLine:true};
  let time=0,task=null,delay=0,calls=0,resolve;
  win.setTimeout=(fn,ms)=>{task=fn;delay=ms;return 1;};win.clearTimeout=()=>{task=null;};
  const scheduler=createRefreshScheduler(()=>{calls++;return new Promise(r=>resolve=r);},{document:doc,window:win,now:()=>time});
  assert.equal(delay,60000);
  time=60000;const pending=task();
  win.dispatchEvent(new Event('online'));assert.equal(calls,1);
  resolve(false);await pending;assert.equal(delay,120000);
  time=180000;const again=task();resolve(false);await again;assert.equal(delay,240000);
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(task,null);
  time=500000;doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(delay,0);
  const success=task();resolve(true);await success;assert.equal(delay,60000);
  win.navigator.onLine=false;win.dispatchEvent(new Event('offline'));assert.equal(task,null);
  win.navigator.onLine=true;win.dispatchEvent(new Event('online'));assert.equal(delay,60000);
  scheduler.fresh();assert.equal(delay,60000);scheduler.stop();assert.equal(task,null);
});
