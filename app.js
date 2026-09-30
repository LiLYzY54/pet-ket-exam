
/* PET/KET 模考 · app.js */
const $ = id => document.getElementById(id);
const VIEWS = ['home','authority','info','exam','check','report'];

const state = {
  exam: null,
  paperId: null,
  student: {name:'', place:'BEIJING', id:'', session:''},
  modules: [],
  answers: {}, flags: {}, offlineCompleted: {},
  listenCounts: {}, hearOpen: null,
  currentPart: 0, startedAt: null, results: null,
  mode: 'formal', moduleDeadlines: {}, timeWarned: {}, closedModules: {},
  role: 'student', currentView: 'home', resultId: null,
  audioSources: [], audioSourceIndex: 0, audioReady: false, audioFailed: false
};
if (typeof window !== 'undefined') window.state = state;

function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function escapeAttr(s){return escapeHtml(s)}
function toast(msg, ms=2200, kind='info'){
  const el=$('toast'); if(!el) return;
  el.textContent=msg; el.dataset.kind=kind; el.classList.add('show');
  clearTimeout(window.__tt); window.__tt=setTimeout(()=>el.classList.remove('show'), ms);
}
function ymd(d=new Date()){
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function fmtTime(sec){
  sec=Math.max(0, Math.floor(sec||0));
  return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
}
function normText(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/[.!,。]/g,'')}

function getExamData(exam){
  return (typeof DATA !== 'undefined' && DATA[exam || state.exam]) || null;
}
function getPaperData(exam, paperId){
  const e = getExamData(exam);
  if(!e || !e.papers) return null;
  const pid = paperId || (state && state.paperId) || 'test1';
  return e.papers[pid] || e.papers.test1 || null;
}
function getPaperMeta(exam, paperId){
  const ex = exam || state.exam;
  const pid = paperId || (state && state.paperId) || 'test1';
  const list = (window.PAPERS_CATALOG && window.PAPERS_CATALOG[ex]) || [];
  return list.find(p => p.id === pid) || {
    id: pid,
    label: pid === 'test2' ? '试卷 2' : '试卷 1',
    sourceLabel: pid === 'test2' ? 'Test2' : 'Test1',
    title: pid === 'test2' ? `${ex} Test 2` : `${ex} Test 1`
  };
}


const App = {
  _confirmAction:null,
  askConfirm({title='请确认',message='',confirmText='确认',danger=true,onConfirm}){
    const dialog=$('confirmDialog');
    if(!dialog || typeof dialog.showModal!=='function'){
      if(window.confirm(message)) onConfirm?.();
      return;
    }
    App._confirmAction=onConfirm;
    $('confirmTitle').textContent=title;
    $('confirmMessage').textContent=message;
    $('confirmAccept').textContent=confirmText;
    $('confirmAccept').className=`btn ${danger?'danger-outline':''}`.trim();
    dialog.showModal();
    setTimeout(()=>$('confirmCancel')?.focus(),0);
  },
  closeConfirm(accepted){
    const dialog=$('confirmDialog'), action=App._confirmAction;
    App._confirmAction=null;
    if(dialog?.open) dialog.close();
    if(accepted) action?.();
  },
  show(name, options={}){
    VIEWS.forEach(v=>{
      const el=$('view-'+v);
      if(el) el.classList.toggle('hidden', v!==name);
    });
    state.currentView=name;
    App.renderSteps(name);
    if(options.history!==false && location.hash!==`#${name}`) history.pushState({view:name},'',`#${name}`);
    window.scrollTo({top:0, behavior:options.instant?'auto':'smooth'});
    if(name==='info') App.renderInfo();
    if(name==='home'){ App.renderHomeAuth(); App.renderSavedState() }
    if(name==='authority') App.renderAuthFull();
    setTimeout(()=>{
      const heading=$('view-'+name)?.querySelector('h2,h1');
      if(heading){ heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true}) }
    }, options.instant?0:180);
  },
  renderSteps(current){
    const order=['home','info','exam','report'];
    const labels={home:'首页', info:'信息', exam:'作答', report:'报告'};
    const curKey = current==='authority' ? 'home' : current==='check' ? 'exam' : current;
    $('stepBar').innerHTML = `<ol>`+order.map((k,i)=>{
      const ci=order.indexOf(curKey);
      const cls = k===curKey ? 'active' : (ci>i ? 'done' : '');
      const current=k===curKey?' aria-current="step"':'';
      return `<li class="step ${cls}"${current}>${labels[k]}</li>`;
    }).join('')+`</ol>`;
  },
  getDraft(){
    try{return JSON.parse(localStorage.getItem('petket_draft')||'null')}catch(e){return null}
  },
  getResults(){
    try{return JSON.parse(localStorage.getItem('petket_results')||'[]')}catch(e){return []}
  },
  renderSavedState(){
    const draft=App.getDraft(), resume=$('resumePanel');
    if(resume){
      resume.classList.toggle('hidden', !draft?.exam);
      if(draft?.exam){
        const saved=draft.savedAt?new Date(draft.savedAt).toLocaleString():'最近';
        const done=Object.keys(draft.answers||{}).filter(k=>String(draft.answers[k]||'').trim()).length;
        const pMeta=getPaperMeta(draft.exam, draft.paperId||'test1');
        resume.innerHTML=`<div><p class="eyebrow">未完成的考试</p><h2>继续 ${escapeHtml(draft.exam)} · ${escapeHtml(pMeta.label)}</h2>
          <p class="lede">${escapeHtml(draft.student?.name||'考生')} · 已保存 ${done} 题 · ${escapeHtml(saved)}</p></div>
          <div class="btn-row"><button class="btn" onclick="App.resumeDraft()">继续考试</button>
          <button class="btn ghost" onclick="App.discardDraft()">放弃草稿</button></div>`;
      }
    }
    const historyPanel=$('historyPanel'), results=App.getResults();
    if(historyPanel){
      historyPanel.classList.toggle('hidden', !results.length);
      if(results.length){
        const rows=results.slice(-5).reverse().map(r=>{
          const pMeta=getPaperMeta(r.exam, r.paperId||'test1');
          return `<button class="history-row" onclick="App.openSavedResult('${escapeAttr(r._id)}')">
            <span><b>${escapeHtml(r.exam||'考试')} · ${escapeHtml(pMeta.label)} · ${escapeHtml(r.student?.name||'考生')}</b><small>${escapeHtml(r.at||'')}</small></span>
            <span>查看报告 →</span></button>`;
        }).join('');
        historyPanel.innerHTML=`<div class="history-heading"><div><p class="eyebrow">本机记录</p><h2>历史报告</h2></div><div class="history-tools"><span class="quiet">最近 ${Math.min(results.length,5)} 份</span><button class="text-button" onclick="App.clearHistory()">清理记录</button></div></div>${rows}`;
      }
    }
  },
  clearHistory(){
    App.askConfirm({title:'清理本机历史记录',message:'将删除当前浏览器中的全部草稿、历史报告及旧版遗留录音。此操作无法恢复。',confirmText:'确认清理',onConfirm:()=>{
      localStorage.removeItem('petket_draft');
      localStorage.removeItem('petket_results');
      if(window.indexedDB){
        const req=indexedDB.deleteDatabase('petket_recordings');
        req.onerror=()=>toast('报告已清除，但部分录音未能删除',3600,'error');
      }
      App.renderSavedState(); toast('本机历史记录已清除');
    }});
  },
  setMode(mode){
    state.mode=mode==='practice'?'practice':'formal';
    document.querySelectorAll('.mode-card').forEach(card=>card.classList.toggle('active',card.querySelector('input')?.value===state.mode));
    App.renderSetupSummary();
  },
  renderSetupSummary(){
    const el=$('examSetupSummary'); if(!el) return;
    const btn=$('btnStartExam');
    if(!state.exam){
      el.innerHTML='<span>请先选择 PET 或 KET 考试级别。</span>';
      if(btn) btn.textContent='进入试卷作答';
      return;
    }
    if(!state.paperId){
      el.innerHTML=`<span>已选 ${state.exam}，请在下方选择试卷（试卷 1 或 试卷 2）。</span>`;
      if(btn) btn.textContent=`进入 ${state.exam} 试卷作答`;
      return;
    }
    const pMeta = getPaperMeta();
    const paper = getPaperData();
    const d = getExamData();
    const timing = paper?.timing || d?.timing || {};
    const mins = Math.round(Object.values(timing).reduce((a,b)=>a+b, 0)/60);
    const names = state.modules.map(id=>d.modules.find(m=>m.id===id)?.name.split(' ')[0]).filter(Boolean);
    el.innerHTML=`<b>${state.exam} · ${pMeta.label} · ${state.mode==='formal'?'正式模考':'练习模式'}</b><span>约 ${mins} 分钟 · ${names.join('、')}</span>`;
    if(btn) btn.textContent=`进入 ${state.exam} ${pMeta.label}`;
  },
  resumeDraft(){
    const d=App.getDraft(); if(!d?.exam || !DATA[d.exam]){ toast('没有可恢复的考试',2600,'error'); return }
    state.exam=d.exam; state.paperId=d.paperId||'test1'; state.student=d.student||state.student; state.modules=(DATA[d.exam].modules||[]).map(m=>m.id);
    state.answers=d.answers||{}; state.flags=d.flags||{}; state.offlineCompleted=d.offlineCompleted||{};
    state.listenCounts=d.listenCounts||{}; state.currentPart=Math.max(0,Number(d.currentPart)||0);
    state.startedAt=d.startedAt||Date.now(); state.mode=d.mode||'formal'; state.moduleDeadlines=d.moduleDeadlines||{};
    state.timeWarned=d.timeWarned||{}; state.closedModules=d.closedModules||{}; state.results=null; state.resultId=null; state.hearOpen=null;
    App.loadCues(); App.buildExam(); App.show('exam'); App.startTimer();
    toast('已恢复上次考试');
  },
  discardDraft(){
    App.askConfirm({title:'放弃未完成的考试？',message:'草稿中的答案、标记和考试进度将被删除，此操作无法恢复。',confirmText:'放弃草稿',onConfirm:()=>{
      try{localStorage.removeItem('petket_draft')}catch(e){}
      App.renderSavedState(); toast('草稿已删除');
    }});
  },
  openSavedResult(id){
    const saved=App.getResults().find(r=>r._id===id);
    if(!saved){ toast('没有找到这份报告',2600,'error'); return }
    state.exam=saved.exam; state.paperId=saved.paperId||'test1'; state.student=saved.student||state.student;
    state.modules=DATA[state.exam].modules.map(m=>m.id);
    state.answers=saved.answers||{}; state.flags=saved.flags||{}; state.offlineCompleted=saved.offlineCompleted||{};
    state.listenCounts=saved.listenCounts||{}; state.results=saved.results; state.resultId=saved._id;
    App.renderReport(); App.show('report');
  },
  /* ---------- 首页 / 权威 ---------- */
  homeTab(tab){
    App.show('authority');
  },
  homeStageIndex: 0,

  renderHeroSpotlight(){
    const sp=$('homeSpotlight');
    if(!sp) return;
    const docs=App.coverDocs();
    const cur=docs[App.homeStageIndex]||docs[0];
    if(!cur){
      sp.innerHTML=`<div class="sp-label"><strong>官方 Sample</strong><span>—</span></div><p class="sp-label">暂无封面</p>`;
      return;
    }
    sp.innerHTML=`<div class="sp-label"><strong>官方 Sample</strong><span>${App.homeStageIndex+1} / ${docs.length}</span></div>
      <img src="${cur.src}" alt="${escapeHtml(cur.t)}" />
      <div class="sp-label"><span>${escapeHtml(cur.t)}</span><span>题源示例</span></div>`;
  },

  coverDocs(){
    const map = window.AUTH_IMAGES || {};
    const get = k => map[k] || map[k+'.jpg'] || map[k+'.png'] || '';
    return [
      {k:'pet_reading_cover', t:'PET 阅读', s:'Preliminary for Schools · Reading Sample · 500/2414/0', src:get('pet_reading_cover')},
      {k:'pet_listening_cover', t:'PET 听力', s:'Preliminary for Schools · Listening Sample', src:get('pet_listening_cover')},
      {k:'pet_writing_cover', t:'PET 写作', s:'Preliminary for Schools · Writing Sample', src:get('pet_writing_cover')},
      {k:'ket_reading_cover', t:'KET 读写', s:'Key · Reading and Writing Sample · 500/2416/4', src:get('ket_reading_cover')},
      {k:'ket_listening_cover', t:'KET 听力', s:'Key · Listening Sample · 500/2416/4', src:get('ket_listening_cover')}
    ].filter(d=>d.src);
  },
  scaleBand(scale, exam){
    if(exam==='KET'){
      if(scale==null) return null;
      if(scale>=140) return {code:'A', label:'Grade A'};
      if(scale>=133) return {code:'B', label:'Grade B'};
      if(scale>=120) return {code:'C', label:'Grade C'};
      if(scale>=100) return {code:'D', label:'A1'};
      return {code:'D', label:'—'};
    }
    if(scale==null) return null;
    if(scale>=160) return {code:'A', label:'Grade A'};
    if(scale>=153) return {code:'B', label:'Grade B'};
    if(scale>=140) return {code:'C', label:'Grade C'};
    if(scale>=120) return {code:'D', label:'A2'};
    if(scale>=102) return {code:'D', label:'—'};
    return {code:'D', label:'—'};
  },
  scaleCardHTML(exam, moduleId, title){
    const table = DATA[exam].scale[moduleId];
    if(!table) return '';
    const keys = Object.keys(table).map(Number).sort((a,b)=>a-b);
    const rows = keys.map(raw=>{
      const sc = table[raw];
      const band = App.scaleBand(sc, exam);
      const bandText = band ? (band.code==='A'||band.code==='B'||band.code==='C' ? band.label : band.label) : '—';
      const bclass = band ? band.code : 'D';
      return `<tr data-band="${bclass}"><td>${raw}</td><td>${sc}</td><td class="band">${escapeHtml(bandText)}</td></tr>`;
    }).join('');
    return `<article class="scale-card">
      <header>
        <h4>${escapeHtml(title)}</h4>
        <span>${exam} · 卷面分 → Cambridge Scale</span>
      </header>
      <div class="bar-legend">
        <span class="pill-tag" style="background:#d9f2e5;color:#0f7a45">A 档</span>
        <span class="pill-tag" style="background:#d9e5fb;color:#143d9e">B 档</span>
        <span class="pill-tag" style="background:#fff0c8;color:#7a5200">C 档</span>
        <span class="pill-tag" style="background:#fad9d9;color:#9b2c2c">A2/A1</span>
      </div>
      <div class="table-wrap">
      <table>
        <thead><tr><th style="width:34%">卷面分</th><th style="width:33%">Scale</th><th style="width:33%">等级</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <p class="note">教学用换算参考；正式成绩以官方报告为准。Answer Key 不在首页展示。</p>
    </article>`;
  },
  renderHomeAuth(){
    App.renderHeroSpotlight();
  },
  homeShow(i){
    App.homeStageIndex=i;
    App.renderHomeAuth();
  },
  renderScaleCards(){
    const grid=$('scaleGrid');
    if(!grid) return;
    const cards=[];
    // PET
    cards.push(App.scaleCardHTML('PET','reading','PET 阅读 Reading'));
    cards.push(App.scaleCardHTML('PET','listening','PET 听力 Listening'));
    cards.push(App.scaleCardHTML('PET','writing','PET 写作 Writing'));
    cards.push(App.scaleCardHTML('PET','speaking','PET 口语 Speaking'));
    // KET
    cards.push(App.scaleCardHTML('KET','reading','KET 阅读 Reading'));
    cards.push(App.scaleCardHTML('KET','listening','KET 听力 Listening'));
    cards.push(App.scaleCardHTML('KET','writing','KET 写作 Writing'));
    cards.push(App.scaleCardHTML('KET','speaking','KET 口语 Speaking'));
    grid.innerHTML=cards.filter(Boolean).join('');
  },
  renderAuthFull(){
    const map = window.AUTH_IMAGES || {};
    const get = k => map[k] || map[k+'.jpg'] || map[k+'.png'] || '';
    const covers = App.coverDocs().map(d=>`<figure class="auth-item"><div class="title-row"><h4>${d.t}</h4><span class="meta">封面</span></div><img src="${d.src}" alt="${d.t}"/><div class="src-chip">来源：官方 Sample</div></figure>`).join('');
    // 统一用 HTML 换算卡，不放参差不齐的截图
    const rubrics = [
      ['pet_writing_rubric.png','PET 写作评分标准'],
      ['ket_speaking_rubric1.png','KET 口语标准 1'],
      ['ket_speaking_rubric2.png','KET 口语标准 2']
    ].map(([k,t])=>{
      const src=get(k);
      return src?`<figure class="auth-item"><div class="title-row"><h4>${t}</h4><span class="meta">评分细则</span></div><img src="${src}" alt="${t}"/><div class="src-chip">来源：项目文件夹</div></figure>`:'';
    }).join('');
    const scales = ['reading','listening','writing','speaking'].map(id=>{
      const pet=App.scaleCardHTML('PET', id, 'PET '+({reading:'阅读',listening:'听力',writing:'写作',speaking:'口语'}[id]));
      const ket=App.scaleCardHTML('KET', id, 'KET '+({reading:'阅读',listening:'听力',writing:'写作',speaking:'口语'}[id]));
      return pet+ket;
    }).join('');
    $('authFullGrid').innerHTML = `
      <div class="auth-item wide" style="padding:0;border:none;background:transparent">
        <div class="title-row" style="padding:0 0 8px"><h3 style="margin:0">官方试卷封面</h3><span class="meta">Sample</span></div>
        <div class="auth-grid" style="margin-top:0">${covers}</div>
      </div>
      <div class="auth-item wide" style="padding:0;border:none;background:transparent">
        <div class="title-row" style="padding:16px 0 8px;border-top:1px solid var(--color-border)"><h3 style="margin:0">分数换算（统一 HTML 卡）</h3><span class="meta">卷面分 → Scale</span></div>
        <div class="scale-grid" style="margin-top:0;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${scales}</div>
      </div>
      <div class="auth-item wide" style="padding:0;border:none;background:transparent">
        <div class="title-row" style="padding:16px 0 8px;border-top:1px solid var(--color-border)"><h3 style="margin:0">评分细则原图</h3><span class="meta">Rubrics</span></div>
        <div class="auth-grid" style="margin-top:0">${rubrics}</div>
      </div>
      <div class="hint" style="grid-column:1/-1">首页与本页均不展示 Answer Key，避免学生查看标准答案。</div>
    `;
  },
  /* ---------- 首页 / 权威 ---------- */

  renderInfo(){
    // 考生信息：级别选择 + 试卷选择 + 固定考试内容
    const exams = ['PET','KET'];
    const pick = $('examPick');
    if(pick){
      pick.innerHTML = exams.map(ex=>{
        const active = state.exam===ex;
        return `<button type="button" class="exam-card ${active?'active':''}" onclick="App.pickExam('${ex}')" aria-pressed="${active}">
          <div class="badge">${ex==='PET'?'Preliminary':'Key'}</div>
          <h3>${ex} 模考</h3>
          <p>${ex==='PET'?'Preliminary English Test (B1) · 包含多套试卷':'Key English Test (A2) · 包含多套试卷'}</p>
        </button>`;
      }).join('');
    }

    const paperPick = $('paperPick');
    if(paperPick){
      if(!state.exam){
        paperPick.innerHTML = `<div class="paper-empty-hint">请先在上方选择考试级别（PET 或 KET）</div>`;
      }else{
        const catalog = (window.PAPERS_CATALOG && window.PAPERS_CATALOG[state.exam]) || [];
        const draft = App.getDraft();
        const results = App.getResults();
        paperPick.innerHTML = catalog.map(p => {
          const active = state.paperId === p.id;
          const hasDraft = draft && draft.exam === state.exam && (draft.paperId || 'test1') === p.id;
          const count = results.filter(r => r.exam === state.exam && (r.paperId || 'test1') === p.id).length;
          let statusText = '未开始';
          if(hasDraft) statusText = '有未完成草稿';
          else if(count > 0) statusText = `本机已完成 ${count} 次`;

          return `<button type="button" class="paper-card ${active?'active':''}" onclick="App.pickPaper('${p.id}')" aria-pressed="${active}">
            <div class="paper-card__header">
              <h4>${escapeHtml(p.label)}</h4>
              <span class="paper-src">${escapeHtml(p.sourceLabel)}</span>
            </div>
            <div class="paper-desc">${escapeHtml(p.description)}</div>
            <div class="paper-meta">客观题 ${p.objCount} 题 · 预计 ${escapeHtml(p.durationDesc)}</div>
            <span class="paper-status">${escapeHtml(statusText)}</span>
          </button>`;
        }).join('');
      }
    }

    const box = $('moduleChecks');
    if(!box) return;
    if($('stuName') && state.student.name) $('stuName').value=state.student.name;
    if($('stuPlace') && state.student.place) $('stuPlace').value=state.student.place;
    document.querySelectorAll('input[name="examMode"]').forEach(r=>r.checked=r.value===state.mode);
    document.querySelectorAll('.mode-card').forEach(card=>card.classList.toggle('active',card.querySelector('input')?.value===state.mode));
    if(!state.exam){
      box.innerHTML = `<p class="quiet">请先在上方选择 PET 或 KET，再查看固定考试内容。</p>`;
      App.renderSetupSummary();
      return;
    }
    const mods = DATA[state.exam].modules || [];
    state.modules = mods.map(m=>m.id);
    box.innerHTML = `<div class="module-grid" role="list" aria-label="本次考试内容">` + mods.map(m=>{
      const tag = m.auto ? '在线作答 · 自动评分' : '只读题目 · 线下完成';
      return `<div class="module-chip fixed on" role="listitem">
        <span class="module-chip__name">${escapeHtml(m.name)}</span>
        <span class="module-chip__tag">${tag}</span>
      </div>`;
    }).join('') + `</div>
    <p class="quiet module-summary"><b>无需上传：</b>网站不会收集作文、口语录音或语音识别内容。</p>`;
    App.renderSetupSummary();
  },
  pickExam(ex){
    if(state.exam!==ex){
      state.exam=ex;
      state.paperId=null;
      state.modules=[];
    }
    App.ensureExamId(true);
    App.renderInfo();
    App.renderSetupSummary();
  },
  pickPaper(paperId){
    state.paperId=paperId;
    App.renderInfo();
    App.renderSetupSummary();
  },
  ensureExamId(force){
    const inp=$('stuId'); if(!inp || !state.exam) return;
    if(inp.value && !force) return inp.value;
    const letter=state.exam==='KET'?'K':'P';
    const day=ymd();
    const key=`petket_seq_${state.exam}_${day}`;
    let n=0; try{n=parseInt(localStorage.getItem(key)||'0',10)||0}catch(e){}
    inp.value=`${day}${letter}${String(n+1).padStart(4,'0')}`;
    return inp.value;
  },
  startExam(){
    if(!state.exam){
      toast('请先选择 PET 或 KET',2600,'error');
      $('examPick')?.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
    if(!state.paperId){
      toast('请选择试卷',2600,'error');
      $('paperSection')?.scrollIntoView({behavior:'smooth',block:'center'});
      $('paperPick')?.querySelector('button')?.focus();
      return;
    }
    const name=$('stuName').value.trim();
    if(!name){ toast('请填写考生姓名',2600,'error'); $('stuName').focus(); return }

    // 检查是否有其它试卷的未完成草稿
    const draft = App.getDraft();
    if(draft && draft.exam && (draft.exam !== state.exam || (draft.paperId || 'test1') !== state.paperId)){
      const draftMeta = getPaperMeta(draft.exam, draft.paperId || 'test1');
      App.askConfirm({
        title: '覆盖未完成草稿？',
        message: `当前有一份未完成的 ${draft.exam} · ${draftMeta.label}。开始新试卷会删除该草稿。`,
        confirmText: '开始新试卷',
        danger: true,
        onConfirm: () => {
          try{ localStorage.removeItem('petket_draft'); }catch(e){}
          App._doStartExam(name);
        }
      });
      return;
    }
    App._doStartExam(name);
  },
  _doStartExam(name){
    App.ensureExamId(false);
    let sid=($('stuId').value||'').trim();
    const letter=state.exam==='KET'?'K':'P';
    const day=ymd();
    const skey=`petket_seq_${state.exam}_${day}`;
    if(sid.startsWith(day+letter)){
      try{const num=parseInt(sid.slice(day.length+1),10)||0; const cur=parseInt(localStorage.getItem(skey)||'0',10)||0; if(num>cur) localStorage.setItem(skey,String(num));}catch(e){}
    }
    state.student={
      name,
      place:$('stuPlace').value.trim()||'BEIJING',
      id:sid||`${day}${letter}0001`,
      session:$('stuSession').value.trim()||day
    };
    state.modules = (DATA[state.exam].modules||[]).map(m=>m.id);
    state.answers={}; state.flags={}; state.offlineCompleted={};
    state.listenCounts={}; state.hearOpen=null;
    state.results=null;
    state.currentPart=0;
    state.startedAt=Date.now();
    state.moduleDeadlines={}; state.timeWarned={}; state.closedModules={}; state.resultId=null;
    state.audioSourceIndex=0; state.audioReady=false; state.audioFailed=false;
    App.loadCues();
    App.buildExam();
    App.show('exam');
    App.startTimer();
    App.saveDraft();
    const pMeta = getPaperMeta();
    toast(`已进入 ${state.exam} ${pMeta.label}：客观题在线作答，写作与口语线下完成`);
  },
  activeParts(){
    const order={listening:0,reading:1,writing:2,speaking:3};
    const paper = getPaperData();
    const parts = (paper && paper.parts) || (DATA[state.exam] && DATA[state.exam].parts) || [];
    return parts.filter(p=>state.modules.includes(p.module))
      .slice().sort((a,b)=>(order[a.module]??9)-(order[b.module]??9));
  },
  qKey(m,pid,n){return `${m}:${pid}:${n}`},
  currentPart(){return App.activeParts()[state.currentPart]},
  buildExam(){
    const d=DATA[state.exam], paper=getPaperData(), pMeta=getPaperMeta(), parts=App.activeParts();
    $('examTitle').textContent=`${state.exam} · ${pMeta.label}`;
    $('examSub').textContent=`${paper.title} · ${state.student.name} · ${state.student.id} · 听力每部分 2 遍`;
    const modShort={listening:'听力',reading:'阅读',writing:'写作',speaking:'口语'};
    const grouped=parts.reduce((groups,p,i)=>{
      const last=groups[groups.length-1];
      if(!last || last.module!==p.module) groups.push({module:p.module,items:[]});
      groups[groups.length-1].items.push({p,i});
      return groups;
    },[]);
    $('partNav').innerHTML=grouped.map(group=>`<div class="part-nav__group" role="group" aria-label="${modShort[group.module]}部分">
      <span class="part-nav__label">${modShort[group.module]}</span>
      ${group.items.map(({p,i})=>`<button type="button" class="chip ${i===state.currentPart?'active':''}" onclick="App.gotoPart(${i})" aria-pressed="${i===state.currentPart}">${p.name.replace(/^Part\s*/,'P')}</button>`).join('')}
    </div>`).join('');
    App.syncAudio();
    if(parts[state.currentPart]?.audioPart) App.seekPart(false);
    App.renderPart();
    App.updateProgress();
  },
  gotoPart(i, options={}){
    const parts=App.activeParts(), target=parts[i];
    if(!target || i<0 || i>=parts.length) return;
    const current=App.currentPart();
    if(state.mode==='formal' && current && target.module!==current.module){
      const moduleOrder={listening:0,reading:1,writing:2,speaking:3};
      const movingBack=(moduleOrder[target.module]??9)<(moduleOrder[current.module]??9);
      if(movingBack || state.closedModules?.[target.module]){
        toast('上一模块已结束，正式模考不能返回修改',3000,'error'); return;
      }
      const currentIsModuleEnd=!parts.slice(state.currentPart+1).some(p=>p.module===current.module);
      if(!options.force && !currentIsModuleEnd){
        toast('正式模考请先完成当前模块，再进入下一模块',3000,'error'); return;
      }
      state.closedModules[current.module]=true;
    }
    const targetDeadline=target&&state.moduleDeadlines?.[target.module];
    if(state.mode==='formal' && targetDeadline && targetDeadline<=Date.now()){
      toast('该模块已结束，正式模考不能返回修改',3000,'error'); return;
    }
    const prev=current;
    if(prev && prev.audioPart && state.hearOpen===prev.id) state.hearOpen=null;
    state.currentPart=i;
    App.buildExam();
    App.saveDraft();
    window.scrollTo({top:0,behavior:'smooth'});
  },
  prevPart(){ if(state.currentPart>0) App.gotoPart(state.currentPart-1) },
  nextPart(){ if(state.currentPart<App.activeParts().length-1) App.gotoPart(state.currentPart+1) },
  isDisplayOnlyPart(p){ return !!(p&&(p.responseMode==='display-only'||p.open)) },
  offlineKey(p){ return `${p.module}:${p.id}` },
  completeOfflinePart(){
    const p=App.currentPart(); if(!App.isDisplayOnlyPart(p)) return;
    state.offlineCompleted[App.offlineKey(p)]=true;
    App.saveDraft(); App.updateProgress();
    if(state.currentPart<App.activeParts().length-1) App.nextPart(); else App.openCheck();
  },
  renderPart(){
    const p=App.currentPart(), area=$('questionArea');
    if(!p){ area.innerHTML=''; return }
    const displayOnly=App.isDisplayOnlyPart(p);
    const completed=displayOnly&&!!state.offlineCompleted[App.offlineKey(p)];
    let html=`<div class="part-intro ${displayOnly?'display-only-intro':''}"><b>${escapeHtml(p.name)}</b><br>${escapeHtml(p.instruction||(displayOnly?'请阅读题目并在线下完成':'开放任务'))}</div>`;
    if(displayOnly) html+=`<div class="offline-notice" role="note">
      <div class="offline-notice__icon" aria-hidden="true">✎</div>
      <div><b>${p.module==='speaking'?'请与老师面对面完成口语任务':'请在纸质答题卡上完成写作'}</b>
      <p>本页面只展示题目，不会收集文字、图片、文件或录音。完成后点击页面底部按钮继续。</p></div>
    </div>`;
    if(p.passageHtml) html+=`<div class="passage md">${p.passageHtml}</div>`;
    else if(p.passage) html+=`<div class="passage" style="white-space:pre-wrap">${escapeHtml(p.passage)}</div>`;
    p.questions.forEach(q=>{
      const key=App.qKey(p.module,p.id,q.n);
      const ans=state.answers[key], flag=!!state.flags[key];
      html+=`<fieldset class="q ${displayOnly?'offline-task':''} ${flag?'flagged':''}" id="q-${p.id}-${q.n}" tabindex="-1">
        <legend class="sr-only">第 ${q.n} 题</legend>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div><span class="q-num">Q${q.n}</span> <span class="quiet">${q.type==='mc'?'单选':q.type==='text'?'填空':p.module==='speaking'?'口语题目 · 线下完成':'写作题目 · 线下完成'}</span>
          ${q.stem?`<p class="q-stem">${escapeHtml(q.stem)}</p>`:''}</div>
          ${displayOnly?'<span class="offline-badge">只读题目</span>':`<button type="button" class="chip ${flag?'active':''}" onclick="App.flag('${key}')" aria-pressed="${flag}" aria-label="${flag?'取消标记':'标记'}第 ${q.n} 题">${flag?'已标记':'标记'}</button>`}
        </div>`;
      if(q.image) html+=`<div class="q-image"><img src="${escapeAttr(q.image)}" alt="第 ${q.n} 题题图：${escapeAttr(q.stem||'请结合题干选择答案')}"/></div>`;
      if(q.type==='mc'){
        const labels=q.labels||q.options;
        const letterOnly=q.options.every((o,i)=>/^[A-H]$/i.test((labels[i]||o||'').trim())|| (labels[i]||o)===String.fromCharCode(65+i));
        html+=`<div class="options ${letterOnly?'trio':''}">`+q.options.map((o,idx)=>{
          const letter=String.fromCharCode(65+idx);
          const text=labels[idx]||o;
          const sel=ans===letter||ans===o;
          return `<button type="button" class="opt ${letterOnly?'letter-only':''} ${sel?'selected':''}" onclick="App.pick('${key}','${letter}')" aria-pressed="${sel}" aria-label="第 ${q.n} 题，选项 ${letter}${letterOnly?'':`：${escapeAttr(text)}`}"><span class="letter">${letter}</span><span class="txt">${escapeHtml(text)}</span></button>`;
        }).join('')+`</div>`;
        if(letterOnly) html+=`<div class="quiet" style="margin-top:8px">点击 A / B / C 作答</div>`;
      } else if(q.type==='text'){
        html+=`<label class="sr-only" for="answer-${p.id}-${q.n}">第 ${q.n} 题答案</label><input id="answer-${p.id}-${q.n}" class="text-answer" aria-label="第 ${q.n} 题答案" placeholder="输入答案（不区分大小写）" value="${escapeAttr(ans||'')}" oninput="App.setText('${key}', this.value)" />`;
      } else if(q.type==='essay'){
        if(q.promptHtml) html+=`<div class="passage md">${q.promptHtml}</div>`;
      }
      html+=`</fieldset>`;
    });
    if(displayOnly) html+=`<div class="offline-complete ${completed?'is-complete':''}">
      <div><b>${completed?'已确认线下完成':'完成纸笔或面试作答后继续'}</b><p>${completed?'该状态已保存在本机草稿中。':'网站只记录完成状态，不记录主观题内容。'}</p></div>
      <button type="button" class="btn ${completed?'soft':''}" onclick="App.completeOfflinePart()">${completed?'继续下一部分':'我已完成线下作答，继续'}</button>
    </div>`;
    area.innerHTML=html;
  },
  pick(key,letter){ state.answers[key]=letter; App.renderPart(); App.updateProgress(); App.saveDraft() },
  setText(key,val){ state.answers[key]=val; App.updateProgress(); App.saveDraft() },
  flag(key){ state.flags[key]=!state.flags[key]; App.renderPart(); App.saveDraft(); toast(state.flags[key]?'已标记':'取消标记',1000) },
  answeredCount(){
    let total=0,done=0;
    App.activeParts().forEach(p=>p.questions.forEach(q=>{
      if(q.type==='essay'||App.isDisplayOnlyPart(p)) return;
      total++;
      const key=App.qKey(p.module,p.id,q.n);
      if(String(state.answers[key]||'').trim()) done++;
    }));
    return {total,done};
  },
  updateProgress(){
    const {total,done}=App.answeredCount();
    const p=App.currentPart(), offline=App.isDisplayOnlyPart(p);
    const status=offline?(state.offlineCompleted[App.offlineKey(p)]?' · 线下任务已确认':' · 题目已查看'):'';
    $('progressText').textContent=`已答 ${done} / ${total}${status}`;
    $('progressFill').style.width=total?(done/total*100)+'%':'0%';
  },
  /* audio */
  loadCues(){
    try{
      const paperId = state.paperId || 'test1';
      const key = 'petket_cues_' + state.exam + '_' + paperId;
      const raw = localStorage.getItem(key) || (paperId === 'test1' ? localStorage.getItem('petket_cues_' + state.exam) : null);
      const map = JSON.parse(raw || '{}');
      const paper = getPaperData();
      const parts = paper?.parts || DATA[state.exam].parts || [];
      parts.forEach(pt=>{
        if(pt.audioPart && map[pt.id]){
          if(map[pt.id].start!=null) pt.audioStart=map[pt.id].start;
          if(map[pt.id].end!=null) pt.audioEnd=map[pt.id].end;
        }
      });
    }catch(e){}
  },
  ensureAudioSrc(){
    const player=$('player');
    const paper = getPaperData();
    const paperId = state.paperId || 'test1';
    const key = state.exam + '_' + paperId;
    const raw = (window.AUDIO_SOURCES && (window.AUDIO_SOURCES[key] || window.AUDIO_SOURCES[state.exam])) || [paper?.audio, paper?.audioAlt];
    const list=[...new Set(raw.filter(Boolean))];
    if(!list.length){ App.setAudioFailed('未配置听力音频'); return }
    if(state.audioSources.join('|')!==list.join('|')){
      state.audioSources=list; state.audioSourceIndex=0; state.audioReady=false; state.audioFailed=false;
      App.loadAudioSource(0);
    }else if(!player.getAttribute('src')) App.loadAudioSource(state.audioSourceIndex||0);
  },
  loadAudioSource(index){
    const player=$('player');
    if(index>=state.audioSources.length){ App.setAudioFailed('听力音频加载失败，请检查网络或联系老师'); return }
    state.audioSourceIndex=index; state.audioReady=false; state.audioFailed=false;
    player.src=state.audioSources[index]; player.load();
    const status=$('audioStatus'); if(status){ status.className='audio-status loading'; status.textContent='正在加载听力音频…' }
    $('btnRetryAudio')?.classList.add('hidden');
    App.updateListenUI();
  },
  handleAudioError(){
    const next=state.audioSourceIndex+1;
    if(next<state.audioSources.length) App.loadAudioSource(next);
    else App.setAudioFailed('听力音频加载失败，本次未扣除播放次数');
  },
  handleAudioReady(){
    state.audioReady=true; state.audioFailed=false;
    const status=$('audioStatus'); if(status){ status.className='audio-status ready'; status.textContent='音频已就绪' }
    App.updateListenUI();
  },
  setAudioFailed(message){
    state.audioReady=false; state.audioFailed=true; state.hearOpen=null;
    const status=$('audioStatus'); if(status){ status.className='audio-status error'; status.textContent=message }
    $('btnRetryAudio')?.classList.remove('hidden'); App.updateListenUI();
  },
  retryAudio(){
    state.audioSources=[]; state.audioSourceIndex=0; state.audioFailed=false; state.audioReady=false;
    App.ensureAudioSrc();
  },
  syncAudio(){
    const p=App.currentPart();
    const ap=!!(p&&p.audioPart);
    $('audioWrap').classList.toggle('hidden', !ap);
    if(!ap) return;
    App.ensureAudioSrc();
    const start=p.audioStart??0, end=p.audioEnd;
    const range=end!=null?`${fmtTime(start)} – ${fmtTime(end)}`:`从 ${fmtTime(start)} 起`;
    $('audioCue').textContent=`本部分音频 ${range} · 每部分最多听 2 遍（官方）`;
    App.updateListenUI();
  },
  listenLimit(){
    const paper = getPaperData();
    return paper?.listenLimit ?? DATA[state.exam]?.listenLimit ?? 2;
  },
  partHeard(id){ return state.listenCounts[id]||0 },
  listensLeft(id){ return Math.max(0, App.listenLimit()-App.partHeard(id)) },
  updateListenUI(){
    const p=App.currentPart(); if(!p||!p.audioPart) return;
    const used=App.partHeard(p.id), left=App.listensLeft(p.id), lim=App.listenLimit();
    const btn=$('btnPlayPart');
    if(state.audioFailed){
      $('listenLeft').innerHTML=`<b>已听 ${used}/${lim} 遍</b> · 音频未就绪，播放次数未扣除`;
      btn.disabled=true; btn.textContent='音频不可用';
    }else if(!state.audioReady){
      $('listenLeft').innerHTML=`<b>已听 ${used}/${lim} 遍</b> · 正在准备音频`;
      btn.disabled=true; btn.textContent='正在加载…';
    }else if(left<=0){
      $('listenLeft').innerHTML=`<b>已听 ${used}/${lim} 遍</b> · 次数已用完`;
      btn.disabled=true; btn.textContent='次数已用完';
    }else{
      $('listenLeft').innerHTML=`<b>已听 ${used}/${lim} 遍</b> · 还可听 ${left} 遍`+(state.hearOpen===p.id?' · 本遍进行中':'');
      btn.disabled=false; btn.textContent=`播本部分（剩 ${left}）`;
    }
  },
  seekPart(play){
    const p=App.currentPart(); if(!p||!p.audioPart) return;
    const player=$('player');
    const t=p.audioStart??0;
    if(player.readyState>=1){ try{player.currentTime=t}catch(e){}; if(play) App.playPart() }
  },
  playPart(){
    const p=App.currentPart(); if(!p||!p.audioPart) return;
    const player=$('player');
    if(state.audioFailed){ toast('音频未加载成功，请点击“重新加载音频”',3000,'error'); return }
    if(!state.audioReady){ toast('音频仍在加载，请稍候',2200); return }
    if(state.hearOpen===p.id){ player.play().catch(()=>{}); App.updateListenUI(); return }
    if(App.listensLeft(p.id)<=0){ toast('本部分听力次数已用完'); return }
    App.seekPart(false);
    player.play().catch(err=>{
      if(err && (err.name==='AbortError'||/interrupted by a call to pause/i.test(err.message))) return;
      App.setAudioFailed('浏览器未能播放音频，本次未扣除播放次数');
    });
  },
  nextListenPart(){
    App.nextPart();
  },
  calibrate(which,val){
    const p=App.currentPart(); if(!p||!p.audioPart) return;
    const n=parseInt(val,10); if(Number.isNaN(n)||n<0) return;
    if(which==='start') p.audioStart=n; else p.audioEnd=n;
  },
  saveCues(){
    const map={};
    const paper = getPaperData();
    const paperId = state.paperId || 'test1';
    const parts = paper?.parts || DATA[state.exam].parts || [];
    parts.forEach(pt=>{ if(pt.audioPart) map[pt.id]={start:pt.audioStart,end:pt.audioEnd} });
    try{
      localStorage.setItem('petket_cues_'+state.exam+'_'+paperId, JSON.stringify(map));
      toast('时间点已保存');
    }catch(e){ toast('保存失败'); }
  },
  /* timer */
  startTimer(){
    clearInterval(window.__timer);
    App.ensureDeadline();
    const tick=()=>{
      const s=Math.floor((Date.now()-state.startedAt)/1000);
      $('timerText').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
      App.updateCountdown();
    };
    tick(); window.__timer=setInterval(tick,1000);
  },
  ensureDeadline(){
    const paper = getPaperData();
    const d = DATA[state.exam];
    const p = App.currentPart();
    const mod = p ? p.module : 'listening';
    const dur = (paper?.timing && paper.timing[mod]) || (d?.timing && d.timing[mod]) || 0;
    if(!dur) return null;
    state.moduleDeadlines=state.moduleDeadlines||{};
    if(!state.moduleDeadlines[mod]) state.moduleDeadlines[mod]=Date.now()+dur*1000;
    return state.moduleDeadlines[mod];
  },
  updateCountdown(){
    const endsAt=App.ensureDeadline();
    const el=$('countdownText');
    const mod=App.currentPart()?.module;
    if(!endsAt || !mod){ el.textContent='倒计时 —'; return }
    const left=Math.max(0,Math.floor((endsAt-Date.now())/1000));
    const label=({listening:'听力剩余',reading:'阅读剩余',writing:'写作剩余',speaking:'口语剩余'}[mod]||'剩余');
    el.textContent=`${label} ${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;
    if(left===0 && !state.timeWarned[mod+':0']){
      state.timeWarned[mod+':0']=true; App.saveDraft();
      if(state.mode==='formal'){
        const parts=App.activeParts();
        const next=parts.findIndex((p,i)=>i>state.currentPart && p.module!==mod);
        toast(label.replace('剩余','')+'时间到，正在进入下一模块',3000,'error');
        if(next>=0) setTimeout(()=>App.gotoPart(next,{force:true}),400); else setTimeout(()=>App.openCheck(),400);
      }else toast(label.replace('剩余','')+'时间到，练习模式可继续作答',3200);
    }
  },
  /* check + submit */
  pendingOfflineParts(){
    return App.activeParts().filter(p=>App.isDisplayOnlyPart(p)&&!state.offlineCompleted[App.offlineKey(p)]);
  },
  openCheck(){
    const parts=App.activeParts(), {done,total}=App.answeredCount();
    const offlineParts=parts.filter(p=>App.isDisplayOnlyPart(p));
    const offlineDone=offlineParts.filter(p=>state.offlineCompleted[App.offlineKey(p)]).length;
    $('checkSummary').innerHTML=`
      <div class="stat"><b>${done}</b><span>客观题已答</span></div>
      <div class="stat"><b>${total-done}</b><span>客观题未答</span></div>
      <div class="stat"><b>${Object.values(state.flags).filter(Boolean).length}</b><span>已标记</span></div>
      <div class="stat"><b>${offlineDone}/${offlineParts.length}</b><span>线下任务已确认</span></div>`;
    const modName={listening:'听力 Listening',reading:'阅读 Reading & Writing',writing:'写作 Writing',speaking:'口语 Speaking'};
    const groups=[];
    parts.forEach((p,pi)=>{
      let g=groups.find(x=>x.module===p.module);
      if(!g){ g={module:p.module, parts:[]}; groups.push(g) }
      g.parts.push({p,pi});
    });
    const modOrder={listening:0,reading:1,writing:2,speaking:3};
    groups.sort((a,b)=>modOrder[a.module]-modOrder[b.module]);
    let list='';
    groups.forEach(g=>{
      list+=`<div style="margin-top:18px"><div style="font-weight:700;border-bottom:2px solid var(--color-accent);padding-bottom:6px">${modName[g.module]}</div>`;
      g.parts.forEach(({p,pi})=>{
        if(App.isDisplayOnlyPart(p)){
          const completed=!!state.offlineCompleted[App.offlineKey(p)];
          list+=`<div class="check-offline-row">
            <div><b>${escapeHtml(p.name)}</b><div class="quiet">${p.module==='speaking'?'与老师面对面完成':'在纸质答题卡上完成'}</div></div>
            <button type="button" class="chip ${completed?'done':''}" aria-label="${escapeAttr(p.name)}，${completed?'已确认':'待确认'}" onclick="App.gotoPart(${pi});App.show('exam')">${completed?'✓ 已确认':'查看题目'}</button>
          </div>`;
          return;
        }
        const qs=p.questions;
        const ans=qs.filter(q=>{
          const key=App.qKey(p.module,p.id,q.n);
          return !!String(state.answers[key]||'').trim();
        }).length;
        list+=`<div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--color-border)">
          <div style="flex:0 0 170px;font-size:13px;font-weight:650">${escapeHtml(p.name)}<div class="quiet">${ans}/${qs.length} 已答</div></div>
          <div style="flex:1;display:flex;flex-wrap:wrap;gap:8px">`;
        qs.forEach(q=>{
          const key=App.qKey(p.module,p.id,q.n);
          const v=String(state.answers[key]||'').trim();
          const cls=state.flags[key]?'active':(v?'done':'');
          const style=state.flags[key]?'background:#fff6df;border-color:#e0c36a':(v?'background:var(--color-ok-bg);border-color:#b6e4c7':'background:var(--color-muted)');
          const status=state.flags[key]?'已标记':(v?'已作答':'未作答');
          list+=`<button type="button" class="chip ${cls}" style="${style};min-width:42px;height:40px" aria-label="第 ${q.n} 题，${status}" title="${status}" onclick="App.gotoPart(${pi});App.show('exam');setTimeout(()=>{const el=document.getElementById('q-${p.id}-${q.n}');el?.scrollIntoView({behavior:'smooth',block:'center'});el?.focus({preventScroll:true})},180)">${q.n}<span class="sr-only"> ${status}</span></button>`;
        });
        list+=`</div></div>`;
      });
      list+=`</div>`;
    });
    $('checkList').innerHTML=list;
    const left=total-done;
    const pending=offlineParts.length-offlineDone;
    $('checkHint').innerHTML=(left||pending)
      ? `${left?`还有 <b>${left}</b> 道客观题未作答；未答按错误计。`:''}${left&&pending?' ':''}${pending?`还有 <b>${pending}</b> 个线下任务未确认。`:''}`
      : `客观题和线下任务均已确认，可以提交并生成阶段报告。`;
    App.show('check');
  },
  requestSubmit(){
    const {done,total}=App.answeredCount(), left=total-done;
    const flagged=Object.values(state.flags).filter(Boolean).length;
    const offlinePending=App.pendingOfflineParts().length;
    const risks=[left?`${left} 道客观题未作答`:'',flagged?`${flagged} 题已标记`:'',offlinePending?`${offlinePending} 个线下任务未确认`:''].filter(Boolean).join('，');
    const message=risks
      ? `当前还有${risks}。确认交卷后将不能修改答案，是否继续？`
      : '确认交卷并生成客观题阶段报告吗？交卷后将不能修改答案。';
    App.askConfirm({title:'确认交卷？',message,confirmText:'确认交卷',onConfirm:()=>App.doSubmit()});
  },
  confirmSubmit(){ App.requestSubmit() },
  isCorrect(q,val){
    if(q.type==='mc'){
      if(!val) return false;
      if(val===q.answer) return true;
      const idx=q.options.findIndex((o,i)=>String.fromCharCode(65+i)===q.answer);
      return idx>=0 && (val===q.options[idx] || (q.labels && val===q.labels[idx]));
    }
    if(q.type==='text'){
      if(!val) return false;
      const v=normText(val);
      return (q.answers||[]).some(a=>normText(a)===v);
    }
    return false;
  },
  doSubmit(){
    toast('正在评分…');
    const parts=App.activeParts();
    const byModule={}, typeStats={}, wrongs=[];
    parts.forEach(p=>{
      if(p.open) return;
      p.questions.forEach(q=>{
        const key=App.qKey(p.module,p.id,q.n);
        const val=state.answers[key];
        const ok=App.isCorrect(q,val);
        if(!byModule[p.module]) byModule[p.module]={raw:0,total:0,byPart:{}};
        byModule[p.module].total++;
        if(!byModule[p.module].byPart[p.id]) byModule[p.module].byPart[p.id]={name:p.name,raw:0,total:0};
        byModule[p.module].byPart[p.id].total++;
        const tk=`${p.module}|${p.id}`;
        if(!typeStats[tk]) typeStats[tk]={name:p.name,module:p.module,total:0,correct:0};
        typeStats[tk].total++;
        if(ok){
          byModule[p.module].raw++;
          byModule[p.module].byPart[p.id].raw++;
          typeStats[tk].correct++;
        }else{
          wrongs.push({part:p.name,n:q.n,stem:q.stem||'',user:val||'（空）',correct:q.type==='mc'?q.answer:(q.answers||[]).join(' / ')});
        }
      });
    });
    state.results={
      version:3,
      exam:state.exam,
      paperId:state.paperId||'test1',
      status:'objective_complete',
      byModule,
      typeStats,
      wrongs,
      at:new Date().toLocaleString()
    };
    try{localStorage.removeItem('petket_draft')}catch(e){}
    clearInterval(window.__timer);
    App.renderReport();
    App.show('report');
    App.persistResult();
    toast('客观题阶段报告已生成',2500);
  },
  rawToScale(module, raw){
    const table=DATA[state.exam].scale[module];
    if(!table || raw==null) return null;
    const r=Math.max(0,Math.round(raw));
    if(table[r]!=null) return table[r];
    const keys=Object.keys(table).map(Number).sort((a,b)=>a-b);
    if(r<keys[0]) return Number(table[keys[0]])-1;
    let best=null;
    keys.forEach(k=>{ if(k<=r) best=table[k] });
    return best;
  },
  scoreMeta(module, raw){
    const table=DATA[state.exam].scale[module];
    if(!table || raw==null) return {scale:null,below:false,label:'尚未评分'};
    const keys=Object.keys(table).map(Number).sort((a,b)=>a-b), minRaw=keys[0], minScale=Number(table[minRaw]);
    const below=Number(raw)<minRaw;
    return {scale:App.rawToScale(module,raw),below,minScale,label:below?`低于报告范围（<${minScale}）`:String(App.rawToScale(module,raw))};
  },
  levelClass(s){ if(s==null) return 'lv-d'; if(s>=160) return 'lv-a'; if(s>=140) return 'lv-b'; if(s>=120) return 'lv-c'; return 'lv-d' },
  rateBadge(pct){
    const cls=pct>=80?'rate-hi':pct>=60?'rate-mid':'rate-lo';
    return `<span class="rate-badge ${cls}">${pct}%</span>`;
  },
  tipsFor(moduleId, byPart){
    const entries=Object.entries(byPart||{}).map(([id,st])=>({id,name:st.name,pct:st.total?Math.round(st.raw/st.total*100):0}));
    const sorted=[...entries].sort((a,b)=>a.pct-b.pct);
    const tips=[];
    const worst=sorted[0], best=sorted[sorted.length-1];
    if(moduleId==='listening'){
      if(worst && worst.pct<60){
        tips.push(`优先突破「${worst.name}」（${worst.pct}%）：听前圈关键词；关注 but / however / actually 之后的信息。`);
        if(/填空|Gap/i.test(worst.name)) tips.push('填空：预判词性；第一遍缩写、第二遍补拼写；注意单复数与专名大写。');
        if(/长|综合|匹配/i.test(worst.name)) tips.push('长对话/匹配：分清说话人；推理必须有音频依据。');
      }
      if(best && best.pct>=80) tips.push(`优势「${best.name}」（${best.pct}%）：保持预读与听完再选的习惯。`);
      tips.push('每日 15 分钟泛听真题音频，适应语速与连读。');
    } else if(moduleId==='reading'){
      if(worst && worst.pct<60){
        tips.push(`优先突破「${worst.name}」（${worst.pct}%）。`);
        if(/匹配|人物|信息/i.test(worst.name)) tips.push('匹配：先圈全部条件（含否定词），全满足才选。');
        if(/完形|选择/i.test(worst.name) && !/句子/.test(worst.name)) tips.push('完形：回看错题，整理近义词与固定搭配。');
        if(/句子|补全|开放/i.test(worst.name)) tips.push('补全：介词/连词/代词专项；不确定先跳过。');
        if(/长文|阅读/i.test(worst.name)) tips.push('长文：原文划证据句，禁止主观脑补。');
      }
      if(best && best.pct>=80) tips.push(`优势「${best.name}」（${best.pct}%）：保持定位与同义替换敏感度。`);
    }
    tips.push('训练铁律：选择题写出匹配关键词后再锁定答案。');
    return tips;
  },
  sectionHtml(moduleId, scores){
    const d=DATA[state.exam], r=state.results;
    const info=r.byModule?.[moduleId];
    const mod=d.modules.find(m=>m.id===moduleId);
    if(!mod) return '';
    const score=scores[moduleId]||{}, scale=score.scale, raw=score.raw;
    const byPart=(info&&info.byPart)||{};
    const entries=Object.entries(byPart).map(([id,st])=>({id,name:st.name,raw:st.raw,total:st.total,pct:st.total?Math.round(st.raw/st.total*100):0}));
    const strength=entries.filter(e=>e.pct>=80);
    const mid=entries.filter(e=>e.pct>=60 && e.pct<80);
    const weak=entries.filter(e=>e.pct<60);
    const tips=App.tipsFor(moduleId, byPart);
    const title={listening:'LISTENING 听力',reading:'READING 阅读与读写',writing:'WRITING 写作',speaking:'SPEAKING 口语'}[moduleId]||moduleId;
    let h=`<div class="r-section"><h3>${title}</h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0">
        <b style="font-size:28px;font-variant-numeric:tabular-nums">${scale!=null?(score.below?`&lt;${score.minScale}`:scale):'—'}</b>
        <span class="pill ${App.levelClass(scale)}">${scale!=null?(score.below?'低于报告范围':d.reportTemplate.band(scale)):'尚未评分'}</span>
        <span class="quiet">原始分 ${raw!=null?raw:'—'} / ${mod.maxRaw}</span>
      </div>`;
    if(entries.length){
      h+=`<div class="performance-grid">`;
      h+=`<div class="r-card ok"><h4>优势</h4><ul>`+(strength.length?strength.map(e=>`<li><b>${escapeHtml(e.name)}</b>：${e.raw}/${e.total}（${e.pct}%）${App.rateBadge(e.pct)}</li>`).join(''):'<li class="quiet">暂无 ≥80% 板块</li>')+`</ul></div>`;
      h+=`<div class="r-card warn"><h4>待提升</h4><ul>`+(weak.length?weak.map(e=>`<li><b>${escapeHtml(e.name)}</b>：${e.raw}/${e.total}（${e.pct}%）${App.rateBadge(e.pct)}</li>`).join(''):mid.length?mid.map(e=>`<li><b>${escapeHtml(e.name)}</b>：${e.raw}/${e.total}（${e.pct}%）${App.rateBadge(e.pct)}</li>`).join(''):'<li class="quiet">当前没有明显薄弱板块</li>')+`</ul></div>`;
      h+=`</div>`;
      h+=`<div class="r-card recommendations"><h4>下一步建议</h4><ul>`+tips.slice(0,3).map(t=>`<li>${escapeHtml(t)}</li>`).join('')+`</ul></div>`;
    }
    return h+`</div>`;
  },
  typeTableHtml(moduleId, title){
    let rows='';
    Object.entries(state.results.typeStats||{}).forEach(([k,st])=>{
      if(k.split('|')[0]!==moduleId) return;
      const pct=st.total?Math.round(st.correct/st.total*100):0;
      rows+=`<tr><td>${escapeHtml(st.name)}</td><td>${st.total}</td><td>${st.correct}</td><td>${st.total-st.correct}</td><td>${pct}%</td></tr>`;
    });
    if(!rows) return '';
    return `<div class="r-section"><h3>By Question Type · ${title}</h3><div class="table-scroll" tabindex="0" aria-label="${title}题型成绩表，可横向滚动">
      <table class="rt"><tr><th>Question Type</th><th>Total</th><th>Correct</th><th>Incorrect</th><th>Scoring Rate</th></tr>${rows}</table></div></div>`;
  },
  teacherFormHtml(moduleId, title){
    const mod=DATA[state.exam].modules.find(m=>m.id===moduleId);
    return `<section class="manual-card" aria-label="${title}教师填写区">
      <div class="manual-card__head"><div><span>TEACHER ASSESSMENT</span><h3>${title}</h3></div><b>教师填写</b></div>
      <div class="manual-score-row">
        <div class="manual-field"><span>原始分 Raw score</span><i></i><em>/ ${mod?.maxRaw??'—'}</em></div>
        <div class="manual-field"><span>Cambridge English Scale</span><i></i></div>
        <div class="manual-field"><span>CEFR</span><i></i></div>
      </div>
      <div class="manual-block"><span>分项评价</span><div class="writing-lines compact"></div></div>
      <div class="manual-block"><span>教师评语</span><div class="writing-lines"></div></div>
      <div class="manual-signoff">
        <div><span>批改教师</span><i></i></div><div><span>批改日期</span><i></i></div><div><span>签名</span><i></i></div>
      </div>
    </section>`;
  },
  renderReport(){
    const d=DATA[state.exam], r=state.results||{};
    const paperId=state.paperId||r.paperId||'test1';
    const pMeta=getPaperMeta(state.exam, paperId);
    const scores={};
    ['listening','reading'].forEach(id=>{
      const mod=d.modules.find(m=>m.id===id), info=r.byModule?.[id];
      scores[id]={raw:info?.raw??0,total:mod?.maxRaw??info?.total??0,...App.scoreMeta(id,info?.raw??0)};
    });
    const scoreCard=id=>{
      const mod=d.modules.find(m=>m.id===id), s=scores[id];
      return `<div class="stat objective-stat"><span class="stat-kicker">自动评分</span><b>${s.below?`&lt;${s.minScale}`:s.scale}</b><span>${escapeHtml(mod?.name||id)}<br>${s.below?'低于报告范围':d.reportTemplate.band(s.scale)}<br>原始 ${s.raw} / ${mod?.maxRaw??s.total}</span></div>`;
    };
    let html=`<div class="report-summary-page">
      <div class="r-head stage-report-head">
        <div>
          <div class="report-eyebrow">OBJECTIVE-SKILLS PROGRESS REPORT</div>
          <div class="report-title">${escapeHtml(d.reportTemplate.examName||d.title)} · ${escapeHtml(pMeta.label)}</div>
          <div class="kv">
            <span>Candidate name</span><b>${escapeHtml(state.student.name)}</b>
            <span>Place of entry</span><b>${escapeHtml(state.student.place)}</b>
            <span>Local reference</span><b>${escapeHtml(state.student.id)}</b>
            <span>Session</span><b>${escapeHtml(state.student.session)}</b>
            <span>Exam &amp; Paper</span><b>${escapeHtml(state.exam)} · ${escapeHtml(pMeta.label)} <small style="font-weight:normal;color:#64748b">(${escapeHtml(paperId)})</small></b>
          </div>
        </div>
        <div class="report-status">
          <span>REPORT STATUS</span><b>待教师补充</b>
          <p>客观题阶段报告</p><time>${escapeHtml(r.at||'')}</time>
        </div>
      </div>
      <div class="report-section-heading"><div><p class="eyebrow">AUTO-SCORED</p><h2>听力与阅读成绩</h2></div><p>当前仅展示两个客观题分项结果。</p></div>
      <div class="stats objective-stats">${scoreCard('listening')}${scoreCard('reading')}</div>
      <div class="report-section-heading manual-heading"><div><p class="eyebrow">OFFLINE ASSESSMENT</p><h2>教师批改填写区</h2></div><p>写作与口语由教师线下批改后填写。</p></div>
      <div class="manual-grid">${App.teacherFormHtml('writing','WRITING 写作')}${App.teacherFormHtml('speaking','SPEAKING 口语')}</div>
    </div>
    <div class="report-analysis">
      <div class="analysis-heading"><p class="eyebrow">OBJECTIVE-SKILLS ANALYSIS</p><h2>客观题分析与学习建议</h2></div>
      ${App.sectionHtml('listening', scores)}
      ${App.sectionHtml('reading', scores)}
      <div class="r-section report-detail"><h3>详细成绩</h3>
        <div class="report-detail__scale"><h4>客观题 Cambridge English Scale</h4>
          <div class="table-scroll" tabindex="0" aria-label="听力与阅读 Cambridge English Scale 成绩表，可横向滚动"><table class="rt objective-scale-table">
            <tr><th>Listening 听力</th><th>Reading 阅读</th><th>报告状态</th></tr>
            <tr><td>${scores.listening.below?`&lt;${scores.listening.minScale}`:scores.listening.scale}</td><td>${scores.reading.below?`&lt;${scores.reading.minScale}`:scores.reading.scale}</td><td>待教师补充写作与口语</td></tr>
          </table></div>
          <div class="quiet">声明：本分析仅供教学参考，不代表真实考试成绩或官方证书。</div>
        </div>
        ${App.typeTableHtml('listening','Listening 听力')}
        ${App.typeTableHtml('reading','Reading 阅读与读写')}
      </div>
      <div class="note"><b>Statement</b><br>${escapeHtml(d.reportTemplate.statement)}</div>
      <details class="wrong-details" open><summary>错题明细 <span>${(r.wrongs||[]).length} 题</span></summary><div class="wrong-list">`;
    html += (r.wrongs||[]).length ? r.wrongs.map(w=>`
      <div class="r-card"><div class="q-num">${escapeHtml(w.part)} · Q${w.n}</div>
      <div style="margin-top:6px">${escapeHtml(w.stem)}</div>
      <div class="quiet" style="margin-top:6px">你的答案：<b style="color:var(--color-bad)">${escapeHtml(w.user)}</b>　正确：<b style="color:var(--color-ok)">${escapeHtml(String(w.correct))}</b></div></div>`).join('')
      : '<div class="hint">客观题全部正确或未作答客观题。</div>';
    html+=`</div></details></div>
      <div class="btn-row report-actions">
        <button class="btn" onclick="window.print()">打印 / 保存为 PDF</button>
        <button class="btn ghost" onclick="App.show('home')">返回首页</button>
      </div>`;
    $('reportPanel').innerHTML=html;
  },
  restart(){
    App.askConfirm({title:'开始新的考试？',message:'当前报告已保存在本机历史记录中。继续后将返回首页。',confirmText:'返回首页',onConfirm:()=>{
      location.hash='home'; location.reload();
    }});
  },
  saveDraft(){
    if(!state.exam||state.results) return;
    try{
      localStorage.setItem('petket_draft', JSON.stringify({
        version:3, exam:state.exam, paperId:state.paperId||'test1', student:state.student, modules:state.modules,
        answers:state.answers, flags:state.flags, offlineCompleted:state.offlineCompleted,
        listenCounts:state.listenCounts, currentPart:state.currentPart, startedAt:state.startedAt,
        mode:state.mode,moduleDeadlines:state.moduleDeadlines,timeWarned:state.timeWarned,closedModules:state.closedModules,savedAt:Date.now()
      }));
      const status=$('saveStatus'); if(status) status.textContent=`已自动保存 ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    }catch(e){
      const status=$('saveStatus'); if(status) status.textContent='保存失败';
      toast('自动保存失败，请勿关闭页面并联系老师',4000,'error');
    }
  },
  persistResult(){
    try{
      const list=JSON.parse(localStorage.getItem('petket_results')||'[]');
      const id=state.resultId||`${state.student.id}|${Date.now()}`; state.resultId=id;
      const item={ version:3, _id:id, exam:state.exam, paperId:state.paperId||'test1', student:state.student, modules:state.modules, answers:state.answers,
        flags:state.flags, offlineCompleted:state.offlineCompleted, listenCounts:state.listenCounts,
        results:state.results, at:state.results?.at };
      const at=list.findIndex(x=>x._id===id); if(at>=0) list[at]=item; else list.push(item);
      localStorage.setItem('petket_results', JSON.stringify(list));
    }catch(e){ toast('报告保存失败，请立即打印或保存为 PDF',4000,'error') }
  }
};

/* audio event guards */
function bindAudio(){
  const player=$('player');
  if(player.dataset.bound==='true') return; player.dataset.bound='true';
  player.addEventListener('loadedmetadata', ()=>{
    App.handleAudioReady();
    const p=App.currentPart(); if(p?.audioPart){try{player.currentTime=p.audioStart??0}catch(e){}}
  });
  player.addEventListener('error', ()=>App.handleAudioError());
  player.addEventListener('play', ()=>{
    const p=App.currentPart(); if(!p||!p.audioPart) return;
    if(state.hearOpen!==p.id){
      if(App.listensLeft(p.id)<=0){ player.pause(); App.updateListenUI(); return }
      state.listenCounts[p.id]=App.partHeard(p.id)+1; state.hearOpen=p.id;
      App.saveDraft();
    }
    App.updateListenUI();
  });
  player.addEventListener('pause', ()=>App.updateListenUI());
  player.addEventListener('ended', ()=>{ state.hearOpen=null; App.updateListenUI() });
  player.addEventListener('timeupdate', ()=>{
    const p=App.currentPart(); if(!p||!p.audioPart) return;
    if(p.audioEnd!=null && player.currentTime>=p.audioEnd && !player.paused){
      player.pause(); state.hearOpen=null; App.updateListenUI();
    }
  });
}

/* init */
function initApp(){
  if(window.__petketReady) return; window.__petketReady=true;
  App.renderHomeAuth();
  bindAudio();
  $('confirmDialog')?.addEventListener('cancel',e=>{e.preventDefault();App.closeConfirm(false)});
  history.replaceState({view:'home'},'',location.pathname+location.search+'#home');
  App.show('home',{history:false,instant:true});
  window.addEventListener('popstate',e=>{
    const view=e.state?.view||location.hash.replace('#','')||'home';
    const safe=(view==='exam'||view==='check'||view==='report')&&!state.exam?'home':view;
    App.show(VIEWS.includes(safe)?safe:'home',{history:false,instant:true});
  });
  window.addEventListener('beforeunload',e=>{
    if(state.exam&&!state.results&&state.currentView!=='home'){ App.saveDraft(); e.preventDefault(); e.returnValue='' }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.exam&&!state.results) App.saveDraft()});
}
window.App = App;
document.addEventListener('DOMContentLoaded',initApp);
if(document.readyState!=='loading') initApp();
