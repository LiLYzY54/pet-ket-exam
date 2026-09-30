import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, 'screenshots');

async function main() {
  const endpoint = 'http://127.0.0.1:9223';
  const target = await fetch(`${endpoint}/json/new?${encodeURIComponent('http://localhost:4173/?e2e=1')}`, { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });

  function call(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return Promise.race([
      new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${method}`)), 15000))
    ]);
  }

  async function evaluate(expression) {
    const out = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  }

  async function waitFor(expression, label, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(`Boolean(${expression})`)) return;
      } catch (e) { }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timeout: ${label}`);
  }

  async function capture(filename, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await call('Page.captureScreenshot', params);
    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log(`Saved screenshot: ${filename}`);
  }

  async function setViewport(width, height, isMobile = false) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile
    });
  }

  await call('Runtime.enable');
  await call('Page.enable');
  await waitFor('window.App && document.querySelector("#view-home")', 'Home page');

  // 1. Desktop: 首页 (Home)
  await setViewport(1280, 850);
  await waitFor('document.querySelector("#view-home")?.offsetParent !== null', 'Home visible');
  await new Promise(r => setTimeout(r, 400));
  await capture('01_home_page.png');

  // 2. Desktop: 考试设置与信息填写 (Info & Setup)
  await evaluate(`window.App.show('info')`);
  await waitFor('document.querySelector("#view-info")?.offsetParent !== null', 'Info visible');
  await evaluate(`
    window.App.pickExam('PET');
    document.querySelector('#stuName').value = '王芃博';
    document.querySelector('#stuPlace').value = 'BEIJING';
  `);
  await new Promise(r => setTimeout(r, 400));
  await capture('02_exam_setup.png');

  // 3. Desktop: 听力作答页 (Listening Exam Part 1)
  await evaluate(`
    document.querySelector('input[value="practice"]').click();
    window.App.startExam();
  `);
  await waitFor('document.querySelector("#view-exam")?.offsetParent !== null', 'Exam visible');
  await waitFor('document.querySelector("#audioStatus")?.textContent.includes("已就绪")', 'Audio ready', 20000);
  // Pick some answers
  await evaluate(`
    window.App.pick('listening:L1:1', 'A');
    window.App.pick('listening:L1:2', 'B');
  `);
  await new Promise(r => setTimeout(r, 400));
  await capture('03_exam_listening.png');

  // 4. Desktop: 写作只读任务页 (Writing Display-Only)
  await evaluate(`
    const parts = window.App.activeParts();
    const wIdx = parts.findIndex(p => p.module === 'writing');
    window.App.gotoPart(wIdx);
  `);
  await waitFor('document.querySelector(".offline-notice")', 'Writing notice');
  await new Promise(r => setTimeout(r, 400));
  await capture('04_writing_offline_task.png');

  // Confirm writing and speaking
  await evaluate(`{
    window.App.completeOfflinePart();
    const allParts = window.App.activeParts();
    const sIdx = allParts.findIndex(p => p.module === 'speaking');
    window.App.gotoPart(sIdx);
    window.App.completeOfflinePart();
  }`);

  // 5. Desktop: 提交前答题卡 (Answer Sheet Check)
  await evaluate(`window.App.openCheck()`);
  await waitFor('document.querySelector("#view-check")?.offsetParent !== null', 'Check sheet visible');
  await new Promise(r => setTimeout(r, 400));
  await capture('05_answer_sheet_check.png');

  // 6. Desktop: 客观题阶段报告 (Stage 2 Report)
  await evaluate(`window.App.requestSubmit()`);
  await waitFor('document.querySelector("#confirmDialog")?.open', 'Confirm dialog');
  await evaluate(`window.App.closeConfirm(true)`);
  await waitFor('document.querySelector("#view-report")?.offsetParent !== null', 'Report visible');
  await new Promise(r => setTimeout(r, 500));
  await capture('06_stage_report.png');

  // 7. Mobile (390px): 手机端作答页
  await setViewport(390, 844, true);
  await evaluate(`window.App.show('exam')`);
  await new Promise(r => setTimeout(r, 400));
  await capture('07_mobile_exam.png');

  // 8. Mobile (390px): 手机端阶段报告页
  await evaluate(`window.App.show('report')`);
  await new Promise(r => setTimeout(r, 400));
  await capture('08_mobile_report.png');

  ws.close();
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
