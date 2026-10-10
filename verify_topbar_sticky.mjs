import fs from 'fs';

const endpoint = 'http://127.0.0.1:9223';
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent('http://127.0.0.1:4173/?e2e=1')}`, {method:'PUT'}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});

let seq=0;
const pending=new Map();
ws.addEventListener('message',event=>{
  const msg=JSON.parse(event.data);
  if(msg.id&&pending.has(msg.id)){
    const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id);
    msg.error?reject(new Error(msg.error.message)):resolve(msg.result);
  }
});
function call(method,params={}){
  const id=++seq; ws.send(JSON.stringify({id,method,params}));
  return Promise.race([
    new Promise((resolve,reject)=>pending.set(id,{resolve,reject})),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(`CDP 超时：${method}`)),15000))
  ]);
}
async function evaluate(expression){
  const out=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text);
  return out.result.value;
}
async function waitFor(expression,label,timeout=15000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    try{
      if(await evaluate(`Boolean(${expression})`)) return;
    }catch(e){
      if(!/navigated or closed|execution context/i.test(e.message)) throw e;
    }
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error(`等待超时：${label}`);
}

async function run(){
  await call('Page.enable');
  await call('DOM.enable');
  await call('Runtime.enable');

  await waitFor(`Boolean(window.App)`, 'App 初始化');
  await waitFor(`document.querySelector('#examPick')`, '页面初始化');

  // Clear drafts and start PET Test 2
  await evaluate(`
    localStorage.removeItem('petket_draft');
    localStorage.removeItem('petket_exam_draft_v2');
    window.App.show('info');
    window.App.pickExam('PET');
    window.App.pickPaper('test2');
    document.querySelector('#stuName').value = '测试学生';
    window.App.startExam();
  `);

  await waitFor(`document.querySelector('#view-exam')?.offsetParent !== null`, '进入试卷页');

  // 1. Verify topbar exists and contains countdown
  const topbarInfo = await evaluate(`
    (() => {
      const topbar = document.getElementById('examTopbar');
      const badge = document.getElementById('examClockBadge');
      const cd = document.getElementById('countdownText');
      const timer = document.getElementById('timerText');
      const progress = document.getElementById('progressText');
      const rect = topbar.getBoundingClientRect();
      const style = window.getComputedStyle(topbar);
      return {
        hasTopbar: !!topbar,
        hasBadge: !!badge,
        countdownText: cd?.textContent,
        timerText: timer?.textContent,
        progressText: progress?.textContent,
        position: style.position,
        top: style.top,
        rectTop: Math.round(rect.top),
        rectHeight: Math.round(rect.height),
        badgeBg: window.getComputedStyle(badge).backgroundColor,
        badgeColor: window.getComputedStyle(badge).color
      };
    })()
  `);
  console.log('✓ 初始状态顶栏信息:', topbarInfo);

  if (topbarInfo.position !== 'sticky' || topbarInfo.top !== '0px') {
    throw new Error(`Expected position: sticky and top: 0px, got position=${topbarInfo.position}, top=${topbarInfo.top}`);
  }
  if (!topbarInfo.countdownText.includes('听力剩余')) {
    throw new Error(`Expected countdown text to contain '听力剩余', got: ${topbarInfo.countdownText}`);
  }

  // 2. Scroll down 800px and check if topbar remains pinned at top: 0
  await evaluate(`window.scrollTo(0, 800)`);
  await new Promise(r => setTimeout(r, 400));

  const scrolledInfo = await evaluate(`
    (() => {
      const topbar = document.getElementById('examTopbar');
      const badge = document.getElementById('examClockBadge');
      const rect = topbar.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        rectTop: Math.round(rect.top),
        rectBottom: Math.round(rect.bottom),
        badgeVisible: badge.offsetParent !== null
      };
    })()
  `);
  console.log('✓ 页面下滑 800px 后顶栏吸顶信息:', scrolledInfo);

  if (scrolledInfo.rectTop !== 0) {
    throw new Error(`Expected topbar rect.top === 0 when scrolled, got: ${scrolledInfo.rectTop}`);
  }

  // Take desktop screenshot
  const shotDesktop = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('page_desktop_sticky.png', Buffer.from(shotDesktop.data, 'base64'));
  console.log('✓ 已保存桌面端吸顶截屏: page_desktop_sticky.png');

  // 3. Test mobile viewport 390px x 844px
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 400));

  const mobileInfo = await evaluate(`
    (() => {
      const docWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      const topbar = document.getElementById('examTopbar');
      const rect = topbar.getBoundingClientRect();
      return {
        scrollWidth: docWidth,
        clientWidth: clientWidth,
        hasHorizontalOverflow: docWidth > clientWidth,
        topbarTop: Math.round(rect.top),
        topbarWidth: Math.round(rect.width)
      };
    })()
  `);
  console.log('✓ 移动端 390px 响应式信息:', mobileInfo);

  if (mobileInfo.hasHorizontalOverflow) {
    throw new Error(`Mobile has horizontal overflow: scrollWidth=${mobileInfo.scrollWidth}, clientWidth=${mobileInfo.clientWidth}`);
  }
  if (mobileInfo.topbarTop !== 0) {
    throw new Error(`Mobile topbar not sticking at top: 0, rect.top=${mobileInfo.topbarTop}`);
  }

  const shotMobile = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('page_mobile_sticky.png', Buffer.from(shotMobile.data, 'base64'));
  console.log('✓ 已保存移动端 390px 吸顶截屏: page_mobile_sticky.png');

  // 4. Test warning and urgent visual classes on badge
  const warningCheck = await evaluate(`
    (() => {
      const badge = document.getElementById('examClockBadge');
      // simulate left <= 250s (warning)
      state.moduleDeadlines.listening = Date.now() + 250 * 1000;
      App.updateCountdown();
      const isWarn = badge.classList.contains('is-warning');
      const warnColor = window.getComputedStyle(badge).color;
      
      // simulate left <= 30s (urgent)
      state.moduleDeadlines.listening = Date.now() + 30 * 1000;
      App.updateCountdown();
      const isUrgent = badge.classList.contains('is-urgent');
      const urgentColor = window.getComputedStyle(badge).color;
      
      return { isWarn, isUrgent, warnColor, urgentColor, text: document.getElementById('countdownText').textContent };
    })()
  `);
  console.log('✓ 倒计时预警与紧急状态切换校验:', warningCheck);
  if (!warningCheck.isWarn || !warningCheck.isUrgent) {
    throw new Error('Urgency classes is-warning / is-urgent failed to trigger!');
  }

  console.log('\n========================================');
  console.log('🎉 倒计时前置与顶部固定栏（Sticky Topbar）验证全部通过！');
  console.log('========================================');

  await fetch(`${endpoint}/json/close/${target.id}`).catch(()=>{});
  ws.close();
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
