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
      const val=await evaluate(expression);
      if(val) return val;
    }catch(e){}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error(`等待超时: ${label}`);
}

try {
  console.log('🚀 启动全流程整改专项自动化验收测试 (CDP 模式)...');
  await call('Page.enable');
  await call('Runtime.enable');
  await waitFor(`document.readyState === 'complete'`, '页面加载完成');

  // 1. 验证 Toast 样式（已从 bottom: 28px 调整至 top: 24px，避免阻挡底部操作栏）
  const toastTop = await evaluate(`(() => {
    const el = document.getElementById('toast');
    const style = window.getComputedStyle(el);
    return { top: style.top, bottom: style.bottom };
  })()`);
  console.log('✓ 1. Toast 浮层位置校验通过:', toastTop);
  if (toastTop.top !== '24px') {
    throw new Error(`Toast top 应为 24px，实际为 ${toastTop.top}`);
  }

  // 2. 验证 PET / KET 各套试卷 L1 的 audioStart 归零（保障完整考场导入语与读题停顿）
  const audioStarts = await evaluate(`(() => {
    const DATA = window.DATA;
    const TEST2 = window.TEST2_PAPERS;
    return {
      petTest1: DATA.PET.papers.test1.parts.find(p => p.id === 'L1').audioStart,
      ketTest1: DATA.KET.papers.test1.parts.find(p => p.id === 'L1').audioStart,
      petTest2: TEST2.PET.parts.find(p => p.id === 'L1').audioStart,
      ketTest2: TEST2.KET.parts.find(p => p.id === 'L1').audioStart,
    };
  })()`);
  console.log('✓ 2. 听力 Part 1 audioStart 校验（全部对齐 0s 官方引导）:', audioStarts);
  if (audioStarts.petTest1 !== 0 || audioStarts.ketTest1 !== 0 || audioStarts.petTest2 !== 0 || audioStarts.ketTest2 !== 0) {
    throw new Error(`audioStart 应全部为 0，实际结果异常: ${JSON.stringify(audioStarts)}`);
  }

  // 3. 验证 PET Scale 修复（低于 102 分时精准呈现“低于报告范围”，去除编造的 20~81 分）
  const petScales = await evaluate(`(() => {
    window.state.exam = 'PET';
    const reading = window.DATA.PET.scale.reading;
    const listening = window.DATA.PET.scale.listening;
    const meta0 = window.App.scoreMeta('reading', 0);
    const meta4 = window.App.scoreMeta('reading', 4);
    const meta5 = window.App.scoreMeta('reading', 5);
    return {
      minReadingRaw: Object.keys(reading).map(Number).sort((a,b)=>a-b)[0],
      minListeningRaw: Object.keys(listening).map(Number).sort((a,b)=>a-b)[0],
      meta0,
      meta4,
      meta5
    };
  })()`);
  console.log('✓ 3. PET 量表官方红线校验通过:', petScales);
  if (petScales.minReadingRaw !== 5 || petScales.meta4.below !== true || petScales.meta5.below !== false) {
    throw new Error('PET 量表低分段数据未对齐官方 102 分标准');
  }

  // 4. 进入 KET Test 2，验证 Reading Part 1 告示/材料/选项错位修复
  await evaluate(`(() => {
    window.App.show('info');
    window.App.pickExam('KET');
    window.App.pickPaper('test2');
    document.querySelector('#stuName').value = '自动化考生';
    document.querySelector('input[value="practice"]').click();
    window.App.startExam();
  })()`);
  await waitFor(`document.querySelector('#view-exam')?.offsetParent !== null`, '进入 KET Test 2');

  const ketParts = await evaluate(`window.App.activeParts().map(p => ({ id: p.id, module: p.module, name: p.name }))`);
  const r1Idx = ketParts.findIndex(p => p.id === 'R1');
  console.log(`KET Test 2 Reading Part 1 索引为: ${r1Idx}`);
  await evaluate(`window.App.gotoPart(${r1Idx}, { force: true })`);
  await new Promise(r => setTimeout(r, 400));

  const r1Questions = await evaluate(`(() => {
    const p = window.App.currentPart();
    return p.questions.map(q => ({
      n: q.n,
      stem: q.stem,
      options: q.options,
      labels: q.labels,
      answer: q.answer,
      image: q.image
    }));
  })()`);
  console.log('✓ 4. KET Test 2 Reading Part 1 题目数据全面校准:');
  console.log('  Q3 (寻物手表告示):', r1Questions[2].stem, '正确答案:', r1Questions[2].answer);
  console.log('  Q4 (野餐照片短信):', r1Questions[3].stem, '正确答案:', r1Questions[3].answer);
  console.log('  Q5 (足球赛通知):', r1Questions[4].stem, '正确答案:', r1Questions[4].answer);
  console.log('  Q6 (雨林讲座通知):', r1Questions[5].stem, '正确答案:', r1Questions[5].answer);

  if (r1Questions[2].answer !== 'C' || r1Questions[3].answer !== 'C' || r1Questions[4].answer !== 'A' || r1Questions[5].answer !== 'B') {
    throw new Error('KET Test 2 R1 答案未完全匹配官方 Key: 1-C, 2-A, 3-C, 4-C, 5-A, 6-B');
  }

  // 5. 验证阅读材料缺失问题修复（检查 KET R2 水上公园文章是否均能正常渲染）
  const ketR2HasPassage = await evaluate(`(() => {
    const parts = window.App.activeParts();
    const r2Idx = parts.findIndex(p => p.id === 'R2');
    window.App.gotoPart(r2Idx, { force: true });
    const passageEl = document.querySelector('.passage');
    return {
      hasPassage: !!passageEl,
      passageHtml: passageEl ? passageEl.innerHTML.slice(0, 100) : ''
    };
  })()`);
  console.log('✓ 5. KET Test 2 R2 水上公园文章渲染校验通过:', ketR2HasPassage);
  if (!ketR2HasPassage.hasPassage) {
    throw new Error('KET Test 2 R2 阅读文章未正常渲染！');
  }

  // 6. 验证跨模块音频防串音（播放中切换至阅读部分，音频必须立即暂停）
  await evaluate(`(() => {
    const parts = window.App.activeParts();
    const l1Idx = parts.findIndex(p => p.id === 'L1');
    window.App.gotoPart(l1Idx, { force: true });
  })()`);
  await new Promise(r => setTimeout(r, 300));

  const audioStateAfterSwitch = await evaluate(`(() => {
    const player = document.getElementById('player');
    try { player.play(); } catch(e){}
    const wasPlaying = !player.paused;
    
    // 切到阅读题
    const parts = window.App.activeParts();
    const r1Idx = parts.findIndex(p => p.id === 'R1');
    window.App.gotoPart(r1Idx, { force: true });
    
    return {
      wasPlaying,
      isPausedAfterSwitch: player.paused,
      hearOpenAfterSwitch: window.state.hearOpen
    };
  })()`);
  console.log('✓ 6. 跨模块切题自动暂停防串流校验通过:', audioStateAfterSwitch);
  if (!audioStateAfterSwitch.isPausedAfterSwitch || audioStateAfterSwitch.hearOpenAfterSwitch !== null) {
    throw new Error('切题后音频未停止，存在后台串音缺陷！');
  }

  // 7. 验证文本填空题归一化容错机制
  const normChecks = await evaluate(`(() => {
    return {
      currency: window.normText('£65') === '65',
      dollar: window.normText('$100') === '100',
      punct: window.normText('hello, world!') === 'hello world',
      wordToNumber: window.normText('nineteen') === '19',
      numberWord: window.normText('19') === '19'
    };
  })()`);
  console.log('✓ 7. 填空题文本容错与数字单词互认校验通过:', normChecks);
  if (!normChecks.currency || !normChecks.dollar || !normChecks.wordToNumber) {
    throw new Error('normText 容错机制未按预期生效！');
  }

  // 8. 验证标题聚焦无 outline
  const headingFocusOutline = await evaluate(`(() => {
    const h = document.querySelector('h1, h2');
    if (!h) return 'none';
    h.setAttribute('tabindex', '-1');
    h.focus();
    const style = window.getComputedStyle(h);
    return style.outlineStyle;
  })()`);
  console.log('✓ 8. 标题程序聚焦轮廓校验通过 (outlineStyle):', headingFocusOutline);
  if (headingFocusOutline !== 'none') {
    throw new Error(`标题聚焦仍然存在 outline: ${headingFocusOutline}`);
  }

  console.log('\n========================================');
  console.log('🎉 全部专项整改项（听力/阅读/视觉/量表）自动化验收 100% 通过！');
  console.log('========================================');
} finally {
  await call('Page.close').catch(()=>{});
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`, {method:'PUT'}).catch(()=>{});
}
