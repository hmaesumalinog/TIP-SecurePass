// Local-only browser checks. Start both preview helpers first. No live accounts
// or provider calls. PLAYWRIGHT_PATH can point to an existing Playwright package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const output=resolve('tmp/performance-qa');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const errors=[];let paths=[];let checked=0;
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>paths.push(new URL(request.url()).pathname));
const widthCheck=async()=>{
  const result=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(result.document<=result.viewport,`Overflow on ${page.url()}: ${JSON.stringify(result)}`);checked++;
};
try {
  for(const width of [320,375,768,1280]){
    await page.setViewportSize({width,height:900});
    for(const path of ['/index.html','/forgot.html','/recover.html','/admin/dashboard.html','/admin/students.html','/admin/audit.html','/admin/recovery.html']){
      await page.goto('http://127.0.0.1:4175'+path);await page.waitForLoadState('networkidle');await widthCheck();
      if(path==='/admin/students.html') {
        assert.match(await page.locator('#page-state').textContent(),/5 students on this page/);
        if(width===320)await page.screenshot({path:resolve(output,'admin-students-mobile.png'),fullPage:true});
      }
      if(width===1280&&path==='/admin/dashboard.html')await page.screenshot({path:resolve(output,'admin-dashboard-desktop.png'),fullPage:true});
    }
    await page.goto('http://127.0.0.1:4175/__fixture/enrolled');await page.waitForLoadState('networkidle');await widthCheck();
    paths=[];await page.goto('http://127.0.0.1:4175/portal.html');await page.waitForLoadState('networkidle');await widthCheck();
    assert.equal(paths.filter(p=>p==='/api/profile').length,1);
    assert.equal(paths.filter(p=>p==='/.netlify/functions/security-settings').length,0,'Portal does not fetch recovery status twice');
    assert.match(await page.locator('#security-pills').textContent(),/Authenticator connected/);
    if(width===375)await page.screenshot({path:resolve(output,'student-portal-mobile.png'),fullPage:true});
  }
  await page.setViewportSize({width:375,height:850});
  await page.goto('http://127.0.0.1:4176/__qa/pending');
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent.includes('being processed'));
  assert.equal(await page.locator('#otp-code').isEnabled(),true);
  await page.screenshot({path:resolve(output,'sms-pending-mobile.png'),fullPage:true});
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent.includes('already active'),{},{timeout:20000});
  await page.getByRole('textbox',{name:'Six-digit text message code'}).fill('012345');
  await page.getByRole('button',{name:'Verify and continue'}).click();
  await page.getByRole('textbox',{name:'New password',exact:true}).fill('Synthetic!Password123');
  await page.getByRole('textbox',{name:'Confirm new password',exact:true}).fill('Synthetic!Password123');
  await page.getByRole('button',{name:'Save new password',exact:true}).click();
  await page.locator('[data-view="complete"]').waitFor({state:'visible'});await widthCheck();
  const stats=await (await page.request.get('http://127.0.0.1:4176/__stats')).json();
  assert.equal(stats.sms,1);assert.equal(stats.verify,1);assert.equal(stats.save,1);
  await page.screenshot({path:resolve(output,'recovery-complete-mobile.png'),fullPage:true});
  await page.goto('http://127.0.0.1:4176/__qa/sms-rejected');
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent.includes('rejected'));
  assert.equal(await page.locator('#resend-code').isDisabled(),true);await widthCheck();
  await page.goto('http://127.0.0.1:4176/__qa/sms-unknown');
  await page.waitForFunction(()=>document.querySelector('#delivery-status')?.textContent.includes('not been confirmed'));
  assert.equal(await page.locator('#otp-code').isEnabled(),true);await widthCheck();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({responsiveViewsChecked:checked,consoleErrors:errors.length,syntheticRecovery:stats,screenshots:output}));
} finally {await browser.close();}
