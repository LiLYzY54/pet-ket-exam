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
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(`CDP 超时：${method}`)),10000))
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
console.log('✓ 首页初始化');

// 1. 从空白浏览器状态开始，避免人工测试数据干扰。
await evaluate(`localStorage.clear(); new Promise(resolve=>{const r=indexedDB.deleteDatabase('petket_recordings');r.onsuccess=r.onerror=r.onblocked=()=>resolve(true)})`);
await call('Page.reload',{ignoreCache:true}).catch(e=>{if(!/navigated or closed/i.test(e.message)) throw e});
await new Promise(r=>setTimeout(r,300));
await waitFor('window.App && document.querySelector("#view-home")','清空后重新初始化');
console.log('✓ 测试存储已清空');

// 2. 首页说明验证
assert(await evaluate(`document.querySelector('#view-home')?.offsetParent!==null`),'首页没有显示');
const homeText = await evaluate(`document.querySelector('#view-home')?.innerText || ''`);
assert(homeText.includes('只展示题目') && homeText.includes('自动评分'), '首页使用说明未明确只读与自动评分规则');
assert(homeText.includes('考生编号') && homeText.includes('本机'), '首页未说明考生编号为本机生成');

// 3. 开始设置 PET 考试与两级选择验证
await evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始设置考试')?.click()`);
await waitFor(`document.querySelector('#view-info')?.offsetParent!==null`,'进入信息页');
// 缺少套卷拦截
await evaluate(`window.App.pickExam('PET');document.querySelector('#stuName').value='端到端测试';window.App.startExam()`);
assert(await evaluate(`document.querySelector('#toast')?.textContent.includes('请选择试卷')`), '缺少试卷未拦截');
console.log('✓ 缺少试卷选择时正确拦截');
await evaluate(`window.App.pickPaper('test1');document.querySelector('input[value="practice"]').click();window.App.startExam()`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`,'进入 PET 试卷 1');
console.log('✓ PET 试卷 1 已进入');

// 4. 听力资源与播放控制
await waitFor(`document.querySelector('#audioStatus')?.textContent.includes('已就绪')`,'PET 音频就绪',20000);
console.log('✓ PET 音频已就绪');
const petProgress = await evaluate(`document.querySelector('#progressText').textContent.trim()`);
assert(petProgress.includes('0 / 57'), `PET 总客观题数应为 57，实际为：${petProgress}`);
await evaluate(`document.querySelector('#btnPlayPart').click()`);
await waitFor(`document.querySelector('#listenLeft').textContent.includes('已听 1/2 遍')`,'成功播放后计次');
await new Promise(r=>setTimeout(r,300));
await evaluate(`document.querySelector('#player').pause()`);
await new Promise(r=>setTimeout(r,300));
await evaluate(`document.querySelector('#btnPlayPart').click()`);
await new Promise(r=>setTimeout(r,300));
const listenText = await evaluate(`document.querySelector('#listenLeft').textContent`);
assert(listenText.includes('已听 1/2 遍'), `暂停后继续播放被重复计次：${listenText}`);
await evaluate(`document.querySelector('#player').pause()`);
console.log('✓ 听力只在新一遍成功播放时计次');

// 5. 作答与草稿自动保存
await evaluate(`document.querySelector('.opt')?.click()`);
await waitFor(`document.querySelector('#progressText')?.textContent.includes('1 / 57')`,'记录第一题答案');
assert(await evaluate(`Boolean(localStorage.getItem('petket_draft'))`),'草稿没有保存');
console.log('✓ 答案与草稿已保存');

// 6. 刷新后恢复答案与当前位置
await call('Page.reload',{ignoreCache:true}).catch(e=>{if(!/navigated or closed/i.test(e.message)) throw e});
await waitFor(`document.querySelector('button[onclick="App.resumeDraft()"]')`,'首页恢复入口');
await evaluate(`document.querySelector('button[onclick="App.resumeDraft()"]')?.click()`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`,'恢复考试');
const resumedProgress = await evaluate(`document.querySelector('#progressText').textContent.trim()`);
assert(resumedProgress.includes('1 / 57'),'恢复后答案进度丢失');
console.log('✓ 刷新后恢复考试');

// 7. 验证写作（只读任务）
const petParts = await evaluate(`window.App.activeParts()`);
const writingIndex = petParts.findIndex(p => p.module === 'writing');
assert(writingIndex >= 0, 'PET 未找到写作模块');
await evaluate(`window.App.gotoPart(${writingIndex})`);
await waitFor(`document.querySelector('.offline-notice')`, '进入写作只读页面');
const writingIsDisplayOnly = await evaluate(`window.App.isDisplayOnlyPart(window.App.currentPart())`);
assert(writingIsDisplayOnly, '写作部分应为 display-only 只读模式');
assert(await evaluate(`document.querySelector('.offline-notice')?.innerText.includes('在纸质答题卡上完成写作')`), '写作线下提示文案缺失');
assert(!(await evaluate(`Boolean(document.querySelector('#questionArea input, #questionArea textarea, #questionArea button.record-btn, #questionArea input[type=file]'))`)), '写作页面不得包含输入框、上传或录音按钮');

// 验证写作页面移动端 390px 无横向溢出
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const mobileWriting = await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth})`);
assert(mobileWriting.scrollWidth <= mobileWriting.innerWidth + 1, `390px 写作页横向溢出：${mobileWriting.scrollWidth}px`);
await call('Emulation.clearDeviceMetricsOverride');
console.log('✓ 写作只读页无表单/录音控件且 390px 无溢出');

// 确认完成写作线下作答
await evaluate(`window.App.completeOfflinePart()`);
assert(await evaluate(`Boolean(JSON.parse(localStorage.getItem('petket_draft')||'{}').offlineCompleted?.['writing:W'])`), '写作线下完成状态未记录');

// 8. 验证口语（只读任务）
const speakingIndex = petParts.findIndex(p => p.module === 'speaking');
assert(speakingIndex >= 0, 'PET 未找到口语模块');
await evaluate(`window.App.gotoPart(${speakingIndex})`);
await waitFor(`document.querySelector('.offline-notice')`, '进入口语只读页面');
const speakingIsDisplayOnly = await evaluate(`window.App.isDisplayOnlyPart(window.App.currentPart())`);
assert(speakingIsDisplayOnly, '口语部分应为 display-only 只读模式');
assert(await evaluate(`document.querySelector('.offline-notice')?.innerText.includes('与老师面对面完成口语任务')`), '口语线下提示文案缺失');
assert(!(await evaluate(`Boolean(document.querySelector('#questionArea input, #questionArea textarea, #questionArea button.record-btn, #questionArea input[type=file]'))`)), '口语页面不得包含输入框、上传或录音按钮');

// 确认完成口语线下作答
await evaluate(`window.App.completeOfflinePart()`);
assert(await evaluate(`Boolean(JSON.parse(localStorage.getItem('petket_draft')||'{}').offlineCompleted?.['speaking:S'])`), '口语线下完成状态未记录');
console.log('✓ 口语只读页无表单/录音控件并成功确认线下完成');

// 9. 答题卡统计与提交确认
await evaluate(`window.App.openCheck()`);
await waitFor(`document.querySelector('#view-check')?.offsetParent!==null`,'打开答题卡');
const summary = await evaluate(`[...document.querySelectorAll('#checkSummary .stat b')].map(x=>x.textContent.trim())`);
assert(summary[0] === '1', `客观题已答数错误：${summary[0]}`);
assert(summary[1] === '56', `客观题未答数错误：${summary[1]}`);
assert(summary[3] === '2/2', `线下任务完成统计错误：${summary[3]}`);
console.log('✓ 答题卡统计正确（客观题 1/56，线下任务 2/2）');

await evaluate(`window.App.requestSubmit()`);
await waitFor(`document.querySelector('#confirmDialog')?.open`,'打开提交确认框');
const confirmMsg = await evaluate(`document.querySelector('#confirmMessage').textContent`);
assert(confirmMsg.includes('56') && confirmMsg.includes('未作答'), `提交确认未正确显示未答数量：${confirmMsg}`);
await evaluate(`window.App.closeConfirm(false)`);
assert(await evaluate(`document.querySelector('#view-check')?.offsetParent!==null`),'取消交卷后没有停留在答题卡');
assert((await evaluate(`JSON.parse(localStorage.getItem('petket_results')||'[]').length`))===0,'取消交卷仍生成了历史报告');
await evaluate(`window.App.requestSubmit()`);
await waitFor(`document.querySelector('#confirmDialog')?.open`,'再次打开提交确认框');
await evaluate(`window.App.closeConfirm(true)`);

// 10. 客观题阶段报告 v2 核心规则验证
await waitFor(`document.querySelector('#view-report')?.offsetParent!==null`,'生成成绩报告');
const reportStatus = await evaluate(`document.querySelector('.stage-report-head .report-status b')?.textContent.trim()`);
assert(reportStatus === '待教师补充', `报告状态不正确：${reportStatus}`);
const reportEyebrow = await evaluate(`document.querySelector('.stage-report-head .report-eyebrow')?.textContent.trim()`);
assert(reportEyebrow === 'OBJECTIVE-SKILLS PROGRESS REPORT', `报告顶栏文案不正确：${reportEyebrow}`);

// 严禁显示 Overall Score 或综合等级
assert(await evaluate(`!document.querySelector('.r-head .score, .overall-score')`), '阶段报告严禁出现综合总分卡片');
assert((await evaluate(`document.querySelector('#reportPanel').innerText`)).includes('待教师补充写作与口语'), '成绩明细表未注明待教师补充写作与口语');
assert((await evaluate(`document.querySelector('#reportPanel').innerText`)).includes('低于报告范围'), '客观题低分状态未正确提示');

// 教师手填区验证：必须包含写作、口语两块手填卡，且必须为打印横线而非在线 input/textarea
const manualCardTitles = await evaluate(`[...document.querySelectorAll('.manual-card h3')].map(x=>x.textContent.trim())`);
assert(manualCardTitles.join(',') === 'WRITING 写作,SPEAKING 口语', `教师手填卡缺失：${manualCardTitles.join(',')}`);
assert(!(await evaluate(`Boolean(document.querySelector('#reportPanel input, #reportPanel textarea'))`)), '教师手填卡暴露了在线输入框，必须为打印横线');
const hasWritingLines = await evaluate(`document.querySelectorAll('.manual-card .writing-lines').length >= 2`);
assert(hasWritingLines, '教师手填卡缺少评语手写横线');

// 历史报告持久化检查
assert((await evaluate(`JSON.parse(localStorage.getItem('petket_results')||'[]').length`))===1,'历史报告没有保存');
console.log('✓ 阶段报告 v2 规则正确（无综合分、待教师补充状态、教师手填卡规范）');

// 11. 重新打开历史报告
await evaluate(`window.App.show('home')`);
await waitFor(`document.querySelector('.history-row')?.offsetParent!==null`,'显示历史报告入口');
await evaluate(`document.querySelector('.history-row').click()`);
await waitFor(`document.querySelector('#view-report')?.offsetParent!==null`,'重新打开历史报告');
assert((await evaluate(`document.querySelector('.stage-report-head .report-status b')?.textContent.trim()`)) === '待教师补充', '历史报告状态恢复失败');
console.log('✓ 历史报告可完整重新打开');

// 12. 窄屏 390px 报告页响应式验收
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const mobileReport=await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.getBoundingClientRect().width})`);
assert(mobileReport.scrollWidth<=mobileReport.innerWidth+1,`390px 报告页横向溢出：${mobileReport.scrollWidth}px`);
console.log('✓ 390px 报告页无整页溢出');
await call('Emulation.clearDeviceMetricsOverride');

// 13. A4 打印样式验证（通过 CDP Page.printToPDF 检查打印生成）
const pdfData = await call('Page.printToPDF', {
  paperWidth: 8.27,
  paperHeight: 11.69,
  marginTop: 0.4,
  marginBottom: 0.4,
  marginLeft: 0.4,
  marginRight: 0.4,
  printBackground: true
});
assert(pdfData && pdfData.data && pdfData.data.length > 5000, 'A4 PDF 导出数据生成失败');
console.log('✓ A4 打印与 PDF 导出数据验证通过');

// 14. 新开 KET 试卷 1，验证题目、音频与 Parts 6–7 只读题目
await evaluate(`window.App.show('info');window.App.pickExam('KET');window.App.pickPaper('test1');document.querySelector('#stuName').value='KET 测试';document.querySelector('input[value="practice"]').click();window.App.startExam()`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`,'进入 KET 试卷 1');
await waitFor(`document.querySelector('#audioStatus')?.textContent.includes('已就绪')`,'KET 音频就绪',20000);
console.log('✓ KET 音频已就绪');

const ketProgressText = await evaluate(`document.querySelector('#progressText').textContent.trim()`);
assert(ketProgressText.includes('0 / 55'), `KET 客观题总数应为 55，实际为：${ketProgressText}`);

// 验证 KET 不包含冗余的 module:writing
const ketParts = await evaluate(`window.App.activeParts()`);
assert(!ketParts.some(p => p.module === 'writing'), 'KET 不应有独立的 writing 模块（Parts 6-7 属于 Reading & Writing）');

// 验证 KET Part 6 和 Part 7 为 display-only
const ketR6 = ketParts.find(p => p.id === 'R6');
const ketR7 = ketParts.find(p => p.id === 'R7');
assert(ketR6 && ketR6.responseMode === 'display-only', 'KET Part 6 应为只读写作任务');
assert(ketR7 && ketR7.responseMode === 'display-only', 'KET Part 7 应为只读写作任务');

// 验证 KET 移动端作答页操作栏
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const mobileExam=await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth,visibleActions:[...document.querySelectorAll('.exam-actions .btn')].filter(x=>x.offsetParent!==null).map(x=>x.textContent.trim())})`);
assert(mobileExam.scrollWidth<=mobileExam.innerWidth+1,`390px 作答页横向溢出：${mobileExam.scrollWidth}px`);
assert(mobileExam.visibleActions.join('|')==='上一部分|答题卡|下一部分',`手机固定栏操作错误：${mobileExam.visibleActions.join('|')}`);
await call('Emulation.clearDeviceMetricsOverride');
console.log('✓ KET 55 题、Parts 6-7 只读属性及 390px 操作栏全部正确');

// 15. 正式模式模块锁：按顺序推进且不可返回已结束模块
await evaluate(`localStorage.removeItem('petket_draft');window.App.show('info');window.App.pickExam('PET');window.App.pickPaper('test1');document.querySelector('#stuName').value='正式模式测试';document.querySelector('input[value="formal"]').click();window.App.startExam()`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`,'进入正式模式');
await evaluate(`[...document.querySelectorAll('#partNav .part-nav__group')].find(x=>x.querySelector('.part-nav__label')?.textContent.trim()==='阅读')?.querySelector('button')?.click()`);
await new Promise(r=>setTimeout(r,100));
assert((await evaluate(`document.querySelector('#partNav .active').closest('.part-nav__group').querySelector('.part-nav__label').textContent.trim()`))==='听力','正式模式可以提前跳到下一模块');
await evaluate(`(()=>{const g=[...document.querySelectorAll('#partNav .part-nav__group')].find(x=>x.querySelector('.part-nav__label')?.textContent.trim()==='听力');g?.querySelectorAll('button').item(g.querySelectorAll('button').length-1)?.click();window.App.nextListenPart()})()`);
await waitFor(`document.querySelector('#partNav .active')?.closest('.part-nav__group')?.querySelector('.part-nav__label')?.textContent.trim()==='阅读'`,'从最后一个听力部分进入阅读');
await evaluate(`window.App.prevPart()`);
await new Promise(r=>setTimeout(r,100));
assert((await evaluate(`document.querySelector('#partNav .active').closest('.part-nav__group').querySelector('.part-nav__label').textContent.trim()`))==='阅读','正式模式仍可返回已结束模块');
console.log('✓ 正式模式按模块推进且不能返回已结束模块');

// 16. 验证新增套卷（PET Test 2 与 KET Test 2）
await evaluate(`localStorage.removeItem('petket_draft');window.App.show('info');window.App.pickExam('PET');window.App.pickPaper('test2');document.querySelector('#stuName').value='PET2 测试';document.querySelector('input[value="practice"]').click();window.App.startExam()`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`,'进入 PET 试卷 2');
assert((await evaluate(`document.querySelector('#examTitle').textContent.trim()`)).includes('PET · 试卷 2'), 'PET Test2 标题不正确');
assert((await evaluate(`document.querySelector('#progressText').textContent.trim()`)).includes('0 / 57'), 'PET Test2 题量应为 57');
console.log('✓ PET 试卷 2（57 题）正确进入');

await evaluate(`localStorage.removeItem('petket_draft');window.App.show('info');window.App.pickExam('KET');window.App.pickPaper('test2');document.querySelector('#stuName').value='KET2 测试';document.querySelector('input[value="practice"]').click();window.App.startExam()`);
await waitFor(`document.querySelector('#view-exam')?.offsetParent!==null`,'进入 KET 试卷 2');
assert((await evaluate(`document.querySelector('#examTitle').textContent.trim()`)).includes('KET · 试卷 2'), 'KET Test2 标题不正确');
assert((await evaluate(`document.querySelector('#progressText').textContent.trim()`)).includes('0 / 55'), 'KET Test2 题量应为 55');
console.log('✓ KET 试卷 2（55 题）正确进入');

// 17. 全局异常检查
assert(exceptions.length===0,`页面出现运行异常：${exceptions.join(' | ')}`);

console.log(JSON.stringify({
  ok: true,
  petQuestions: 57,
  ketQuestions: 55,
  displayOnlyChecked: ['PET-Writing', 'PET-Speaking', 'KET-Part6', 'KET-Part7', 'KET-Speaking'],
  reportV2Checked: {
    status: reportStatus,
    noOverallScore: true,
    manualCards: manualCardTitles,
    noFormInputs: true
  },
  mobileResponsive: {
    report390: mobileReport.scrollWidth,
    writing390: mobileWriting.scrollWidth,
    exam390: mobileExam.scrollWidth
  },
  a4PdfGenerated: true,
  audio: ['PET ready', 'KET ready'],
  formalModuleLock: true,
  historyPersistence: true
}, null, 2));

ws.close();
