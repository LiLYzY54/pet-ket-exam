import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000))
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
    throw new Error(`Wait timeout: ${label}`);
  }

  await call('Runtime.enable');
  await call('Page.enable');
  await waitFor('window.App && document.querySelector("#view-home")', 'Home ready');

  // Start PET exam
  await evaluate(`
    window.App.show('info');
    window.App.pickExam('PET');
    window.App.pickPaper('test2');
    document.querySelector('#stuName').value = '王芃博';
    document.querySelector('#stuPlace').value = 'BEIJING';
    document.querySelector('input[value="practice"]').click();
    window.App.startExam();
  `);
  await waitFor('document.querySelector("#view-exam")?.offsetParent !== null', 'Exam ready');

  // Answer a few questions using App methods
  await evaluate(`
    window.App.pick('listening:L1:1', 'A');
    window.App.pick('listening:L1:2', 'B');
    window.App.pick('listening:L1:3', 'C');
    window.App.pick('listening:L1:4', 'A');
    window.App.pick('listening:L1:5', 'B');
    window.App.pick('listening:L1:6', 'C');
    window.App.pick('listening:L1:7', 'A');
    
    // Complete offline tasks
    const parts = window.App.activeParts();
    const wIdx = parts.findIndex(p => p.module === 'writing');
    window.App.gotoPart(wIdx);
    window.App.completeOfflinePart();
    
    const sIdx = parts.findIndex(p => p.module === 'speaking');
    window.App.gotoPart(sIdx);
    window.App.completeOfflinePart();
    
    window.App.requestSubmit();
  `);

  await waitFor('document.querySelector("#confirmDialog")?.open', 'Confirm dialog');
  await evaluate(`window.App.closeConfirm(true)`);
  await waitFor('document.querySelector("#view-report")?.offsetParent !== null', 'Report ready');

  // Generate A4 PDF with exact print settings
  const pdfResult = await call('Page.printToPDF', {
    paperWidth: 8.27, // A4 width in inches (210mm)
    paperHeight: 11.69, // A4 height in inches (297mm)
    marginTop: 0.43, // 11mm
    marginBottom: 0.43,
    marginLeft: 0.43,
    marginRight: 0.43,
    printBackground: true,
    preferCSSPageSize: true
  });

  const pdfPath = path.join(__dirname, 'output_pet_report.pdf');
  fs.writeFileSync(pdfPath, Buffer.from(pdfResult.data, 'base64'));
  console.log(`✓ PDF successfully written to ${pdfPath}`);

  ws.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
