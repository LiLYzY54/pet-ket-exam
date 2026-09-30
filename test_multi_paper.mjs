const endpoint = 'http://127.0.0.1:9223';
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent('http://localhost:4173/?e2e=1')}`, {method:'PUT'}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});

let seq=0;
const pending=new Map();
const exceptions=[];
ws.addEventListener('message',event=>{
  const msg=JSON.parse(event.data);
  if(msg.id&&pending.has(msg.id)){
    const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id);
    msg.error?reject(new Error(msg.error.message)):resolve(msg.result);
  }
  if(msg.method==='Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
  if(msg.method==='Page.javascriptDialogOpening') call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
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
function assert(value,message){if(!value) throw new Error(message)}

await call('Runtime.enable');
await call('Page.enable');
await waitFor('window.App && document.querySelector("#view-home")','网站初始化');
console.log('✓ 1. 首页初始化成功');

// 清空本地存储
await evaluate(`localStorage.clear(); new Promise(resolve=>{const r=indexedDB.deleteDatabase('petket_recordings');r.onsuccess=r.onerror=r.onblocked=()=>resolve(true)})`);
await call('Page.reload',{ignoreCache:true}).catch(e=>{if(!/navigated or closed/i.test(e.message)) throw e});
await new Promise(r=>setTimeout(r,600));
await waitFor('window.App && document.querySelector("#view-home")','重新初始化');

// 2. 进入设置页，验证两级选择
await evaluate(`window.App.show('info')`);
await waitFor(`document.querySelector('#view-info')?.offsetParent!==null`, '信息页可见');
console.log('✓ 2. 进入设置页');

// 未选择级别时，试卷区提示请先选择级别
let paperHint = await evaluate(`document.querySelector('#paperPick').innerText`);
assert(paperHint.includes('请先在上方选择'), '未选择级别时应提示先选级别');
console.log('✓ 3. 未选择考试级别时，试卷区显示引导提示');

// 点击进入试卷作答，应提示先选级别
await evaluate(`window.App.startExam()`);
let toastMsg = await evaluate(`document.querySelector('#toast')?.innerText`);
assert(toastMsg.includes('请先选择 PET 或 KET'), '缺少级别时未正确拦截');
console.log('✓ 4. 缺少考试级别时拦截成功');

// 选择 PET
await evaluate(`window.App.pickExam('PET')`);
let paperCards = await evaluate(`document.querySelectorAll('.paper-card').length`);
assert(paperCards === 2, `PET 应有 2 套试卷，实际渲染：${paperCards}`);
console.log('✓ 5. 选择 PET 后渲染 2 张试卷卡');

// 此时未选择试卷，点击开始作答应拦截
await evaluate(`document.querySelector('#stuName').value = '测试学生'; window.App.startExam()`);
toastMsg = await evaluate(`document.querySelector('#toast')?.innerText`);
assert(toastMsg.includes('请选择试卷'), '缺少套卷时未正确拦截');
console.log('✓ 6. 缺少试卷时拦截成功并提示“请选择试卷”');

// 切换到 KET，验证试卷选择重置
await evaluate(`window.App.pickPaper('test2')`);
assert(await evaluate(`window.state.paperId === 'test2'`), '选择 test2 成功');
await evaluate(`window.App.pickExam('KET')`);
assert(await evaluate(`window.state.paperId === null`), '切换级别后 paperId 未被清空');
console.log('✓ 7. 切换级别自动清空上一级别套卷选择');

// 3. 验证 4 种组合的标题、题量与音频配置
const combos = [
  { exam: 'PET', paperId: 'test1', titlePrefix: 'PET · 试卷 1', objCount: 57, audioFile: 'pet-listening.mp3' },
  { exam: 'PET', paperId: 'test2', titlePrefix: 'PET · 试卷 2', objCount: 57, audioFile: 'pet-test2-listening.mp3' },
  { exam: 'KET', paperId: 'test1', titlePrefix: 'KET · 试卷 1', objCount: 55, audioFile: 'ket-listening.mp3' },
  { exam: 'KET', paperId: 'test2', titlePrefix: 'KET · 试卷 2', objCount: 55, audioFile: 'ket-test2-listening.mp3' }
];

for (const c of combos) {
  await evaluate(`
    localStorage.removeItem('petket_draft');
    window.App.show('info');
    window.App.pickExam('${c.exam}');
    window.App.pickPaper('${c.paperId}');
    document.querySelector('#stuName').value = '组合测试';
    document.querySelector('input[value="practice"]').click();
    window.App.startExam();
  `);
  await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`, `进入 ${c.exam} ${c.paperId}`);
  
  const title = await evaluate(`document.querySelector('#examTitle').textContent.trim()`);
  assert(title.startsWith(c.titlePrefix), `标题不匹配：${title} vs ${c.titlePrefix}`);
  
  const prog = await evaluate(`document.querySelector('#progressText').textContent.trim()`);
  assert(prog.includes(`0 / ${c.objCount}`), `题量不匹配：${prog} vs ${c.objCount}`);
  
  const audioSrc = await evaluate(`document.querySelector('#player').getAttribute('src')`);
  assert(audioSrc && audioSrc.includes(c.audioFile), `音频源不匹配：${audioSrc} vs ${c.audioFile}`);
  
  console.log(`✓ 8. 组合 ${c.exam} · ${c.paperId} 验证通过（题量 ${c.objCount}，音频 ${c.audioFile}）`);
}

// 4. 验证草稿保存与跨卷覆盖提示
// 当前停留在 KET Test2，做一题产生草稿
await evaluate(`document.querySelector('.opt')?.click()`);
await waitFor(`document.querySelector('#progressText')?.textContent.includes('1 / 55')`, 'KET Test2 答题');
assert(await evaluate(`Boolean(localStorage.getItem('petket_draft'))`), '草稿未保存');

// 尝试开启 PET Test1，必须弹窗提示覆盖
await evaluate(`
  window.App.show('info');
  window.App.pickExam('PET');
  window.App.pickPaper('test1');
  document.querySelector('#stuName').value = '张同学';
  window.App.startExam();
`);
await waitFor(`document.querySelector('#confirmDialog')?.open`, '覆盖草稿弹窗');
const confirmMsg = await evaluate(`document.querySelector('#confirmMessage').textContent`);
assert(confirmMsg.includes('KET') && confirmMsg.includes('试卷 2'), `确认信息应提及未完成的草稿试卷：${confirmMsg}`);
console.log(`✓ 9. 开启新试卷前弹出覆盖草稿提示：${confirmMsg}`);

// 确认覆盖
await evaluate(`window.App.closeConfirm(true)`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`, '新试卷进入');
const newTitle = await evaluate(`document.querySelector('#examTitle').textContent.trim()`);
assert(newTitle.startsWith('PET · 试卷 1'), '应进入 PET 试卷 1');
console.log('✓ 10. 确认覆盖草稿后顺利进入新试卷');

// 5. 完整走完 PET Test 2 答题、评分与报告验证
console.log('开始完整走完 PET Test 2...');
await evaluate(`
  localStorage.removeItem('petket_draft');
  window.App.show('info');
  window.App.pickExam('PET');
  window.App.pickPaper('test2');
  document.querySelector('#stuName').value = '完整测试学生';
  document.querySelector('#stuPlace').value = 'BEIJING';
  document.querySelector('input[value="practice"]').click();
  window.App.startExam();
`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`, '进入 PET Test 2');

// 答 PET Test 2 听力客观题
await evaluate(`
  // L1 答题 (7题)
  window.App.pick('listening:L1:1', 'A');
  window.App.pick('listening:L1:2', 'A');
  window.App.pick('listening:L1:3', 'B');
  window.App.pick('listening:L1:4', 'C');
  window.App.pick('listening:L1:5', 'C');
  window.App.pick('listening:L1:6', 'B');
  window.App.pick('listening:L1:7', 'B');

  // L2 答题 (6题)
  window.App.pick('listening:L2:8', 'A');
  window.App.pick('listening:L2:9', 'B');
  window.App.pick('listening:L2:10', 'C');
  window.App.pick('listening:L2:11', 'B');
  window.App.pick('listening:L2:12', 'A');
  window.App.pick('listening:L2:13', 'A');

  // L3 填空 (6题)
  window.App.setText('listening:L3:14', 'windows');
  window.App.setText('listening:L3:15', 'painter');
  window.App.setText('listening:L3:16', 'horses');
  window.App.setText('listening:L3:17', 'kitchen');
  window.App.setText('listening:L3:18', 'dolphins');
  window.App.setText('listening:L3:19', 'tradell');

  // L4 访谈 (6题)
  window.App.pick('listening:L4:20', 'B');
  window.App.pick('listening:L4:21', 'A');
  window.App.pick('listening:L4:22', 'C');
  window.App.pick('listening:L4:23', 'B');
  window.App.pick('listening:L4:24', 'C');
  window.App.pick('listening:L4:25', 'A');

  // 完成线下任务
  const parts = window.App.activeParts();
  const wIdx = parts.findIndex(p => p.module === 'writing');
  window.App.gotoPart(wIdx);
  window.App.completeOfflinePart();

  const sIdx = parts.findIndex(p => p.module === 'speaking');
  window.App.gotoPart(sIdx);
  window.App.completeOfflinePart();

  window.App.requestSubmit();
`);

await waitFor('document.querySelector("#confirmDialog")?.open', '交卷确认框');
await evaluate(`window.App.closeConfirm(true)`);
await waitFor('document.querySelector("#view-report")?.offsetParent !== null', '报告页可见');
console.log('✓ 11. PET Test 2 交卷成功并生成阶段报告');

// 验证报告中的试卷名称
const reportTitle = await evaluate(`document.querySelector('.report-title').textContent`);
assert(reportTitle.includes('试卷 2'), `报告标题应含试卷 2，实际为：${reportTitle}`);
const kvText = await evaluate(`document.querySelector('.kv').innerText`);
assert(kvText.includes('试卷 2') && kvText.includes('test2'), `报告考生信息应含试卷 2 和 test2，实际为：${kvText}`);
console.log(`✓ 12. 报告标题与考生信息正确包含套卷名称：${reportTitle} | ${kvText.replace(/\n/g, ' ')}`);

// 验证报告严格不含综合总分/最终等级
const reportFullText = await evaluate(`document.querySelector('#reportPanel').innerText`);
assert(!reportFullText.includes('Overall Score'), '报告绝不能出现 Overall Score');
assert(!reportFullText.includes('综合 CEFR'), '报告绝不能出现 综合 CEFR');
console.log('✓ 13. 报告严格无综合总分与综合等级');

// 6. 验证返回首页后历史记录包含套卷名称
await evaluate(`window.App.show('home')`);
await waitFor(`document.querySelector('#view-home')?.offsetParent!==null`, '回到首页');
const historyText = await evaluate(`document.querySelector('#historyPanel')?.innerText || ''`);
assert(historyText.includes('PET') && historyText.includes('试卷 2'), `历史记录未包含试卷 2：${historyText}`);
console.log(`✓ 14. 首页历史记录正确包含套卷信息：${historyText.split('\n')[2] || historyText}`);

// 7. 验证旧版数据兼容性（无 paperId 的历史记录能正常打开并识别为试卷 1）
await evaluate(`
  const oldResults = JSON.parse(localStorage.getItem('petket_results') || '[]');
  oldResults.push({
    _id: 'legacy_test_001',
    version: 2,
    exam: 'PET',
    // 故意不传 paperId
    student: { name: '旧版学生', place: 'BEIJING', id: '20260901P0001', session: '20260901' },
    modules: ['listening', 'reading', 'writing', 'speaking'],
    results: { version: 2, status: 'objective_complete', byModule: {}, typeStats: {}, wrongs: [] },
    at: '2026/09/01 10:00:00'
  });
  localStorage.setItem('petket_results', JSON.stringify(oldResults));
  window.App.renderSavedState();
`);

const updatedHistory = await evaluate(`document.querySelector('#historyPanel')?.innerText || ''`);
assert(updatedHistory.includes('旧版学生') && updatedHistory.includes('试卷 1'), '旧版记录应优雅默认显示为试卷 1');
console.log('✓ 15. 旧版无 paperId 记录向下兼容测试通过（默认识别为试卷 1）');

// 打开旧版报告
await evaluate(`window.App.openSavedResult('legacy_test_001')`);
await waitFor(`document.querySelector('#view-report')?.offsetParent!==null`, '旧版报告打开');
const legacyReportTitle = await evaluate(`document.querySelector('.report-title').textContent`);
assert(legacyReportTitle.includes('试卷 1'), `旧版报告应显示试卷 1：${legacyReportTitle}`);
console.log('✓ 16. 打开旧版报告正确渲染为试卷 1');

// 8. 390px 移动端无横向溢出测试
await call('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true
});
await evaluate(`window.App.show('info'); window.App.pickExam('PET');`);
await new Promise(r => setTimeout(r, 400));
const scrollWidth = await evaluate(`document.documentElement.scrollWidth`);
const clientWidth = await evaluate(`document.documentElement.clientWidth`);
assert(scrollWidth <= clientWidth, `390px 移动端发生横向溢出：scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
console.log(`✓ 17. 390px 移动端无横向滚动溢出（scrollWidth: ${scrollWidth}px, clientWidth: ${clientWidth}px）`);

console.log('\n========================================');
console.log('🎉 全部多套卷（Test1/Test2）验收测试通过！');
console.log('========================================');
ws.close();
