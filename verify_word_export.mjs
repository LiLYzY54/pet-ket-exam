import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. 确保静态服务器运行
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(4173, resolve));
console.log('Test server started on 4173');

try {
  // 2. 连接 CDP
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
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate', { url: 'http://localhost:4173/?e2e=1#home' });
  await new Promise(r => setTimeout(r, 1200));

  // 3. 验证页面加载与 WordReportExporter 挂载
  const evalCheck = await call('Runtime.evaluate', {
    expression: `({
      hasExporter: typeof window.WordReportExporter !== 'undefined',
      hasGenerateDocx: typeof window.WordReportExporter?.generateDocxBlob === 'function',
      hasApp: typeof window.App !== 'undefined',
      hasExportWord: typeof window.App?.exportWord === 'function'
    })`,
    returnByValue: true
  });
  console.log('App and Exporter runtime check:', evalCheck.result.value);

  // 4. 模拟完成考试并进入客观题成绩单
  const reportCheck = await call('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const s = window.state;
        s.exam = 'PET';
        s.paperId = 'test1';
        s.modules = window.DATA[s.exam].modules.map(m => m.id);
        s.student = { name: '自动化测试生', id: 'AUTO-20261012', place: 'BEIJING', session: '2026-10-12 10:00' };
        s.answers = { 'listening-p1-q1': 'A', 'listening-p1-q2': 'B', 'reading-p1-q1': 'A' };
        
        // 执行提交并渲染
        window.App.doSubmit();
        
        const btn = document.querySelector('.report-actions .btn');
        const hasWordBtn = btn && btn.textContent.includes('Word');
        
        // 拦截并测试生成 docx 二进制
        let docxBase64 = null;
        if (window.WordReportExporter) {
          const d = window.DATA[s.exam], r = s.results || {};
          const pMeta = window.getPaperMeta(s.exam, s.paperId);
          const scores = {};
          ['listening', 'reading'].forEach(id => {
            const mod = d.modules.find(m => m.id === id), info = r.byModule?.[id];
            scores[id] = { raw: info?.raw ?? 0, total: mod?.maxRaw ?? info?.total ?? 0, ...window.App.scoreMeta(id, info?.raw ?? 0) };
          });
          const exportData = {
            exam: s.exam,
            paperId: s.paperId,
            paperMeta: pMeta,
            student: s.student,
            results: r,
            DATA: window.DATA,
            scores
          };
          const blob = window.WordReportExporter.generateDocxBlob(exportData);
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          docxBase64 = btoa(binary);
        }

        return {
          currentView: s.currentView,
          reportRendered: !!document.querySelector('#reportPanel .report-summary-page'),
          hasWordBtn,
          wordBtnText: btn ? btn.textContent.trim() : null,
          docxBase64Length: docxBase64 ? docxBase64.length : 0,
          docxBase64
        };
      } catch (err) {
        return { error: err.stack || err.message };
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  console.log('Full reportCheck response:', JSON.stringify(reportCheck, null, 2));
  const res = reportCheck.result?.value || {};
  console.log('Report view & button check:', {
    currentView: res.currentView,
    reportRendered: res.reportRendered,
    hasWordBtn: res.hasWordBtn,
    wordBtnText: res.wordBtnText,
    docxBase64Length: res.docxBase64Length
  });

  if (res.docxBase64) {
    const docxBuf = Buffer.from(res.docxBase64, 'base64');
    fs.writeFileSync(path.join(__dirname, 'e2e_verified_report.docx'), docxBuf);
    console.log(`Saved e2e_verified_report.docx (${docxBuf.length} bytes)`);
  }

  // 关闭 CDP target
  await fetch(`${endpoint}/json/close/${target.id}`, { method: 'PUT' });
  ws.close();
} finally {
  server.close();
}
