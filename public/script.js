/* ══ 全域狀態 ══════════════════════════════════ */
/* ── 自訂確認框（取代 window.confirm）── */
function customConfirm(name){
  return new Promise(resolve=>{
    const ov=document.getElementById('custom-confirm-overlay');
    const msg=document.getElementById('custom-confirm-msg');
    msg.innerHTML='確定要「<strong>'+name+'</strong>」嗎？';
    ov.classList.add('show');
    const ok=document.getElementById('confirm-ok-btn');
    const cancel=document.getElementById('confirm-cancel-btn');
    function cleanup(result){
      ov.classList.remove('show');
      ok.removeEventListener('click',onOk);
      cancel.removeEventListener('click',onCancel);
      resolve(result);
    }
    function onOk(){cleanup(true);}
    function onCancel(){cleanup(false);}
    ok.addEventListener('click',onOk);
    cancel.addEventListener('click',onCancel);
    ov.addEventListener('click',e=>{if(e.target===ov)cleanup(false);},{once:true});
  });
}

const S={
  cfg:null,
  rptY:new Date().getFullYear(), rptM:new Date().getMonth()+1,
  selDate:(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})(  ),
  calY:new Date().getFullYear(), calM:new Date().getMonth()+1,
  monthRecs:[],
  addType:'expense', addItems:[], selCat:'',
  subPageKey:'', subCatType:'expense', subCatParent:null, // for nested categories
  subCatPath:[], // path stack for category depth control
  catParentForAdd:null, // temporary parent used by the add‑category overlay
  editingAccId:null, // current account being edited
  accFilter:'', // when set will filter home records
  pieChart:null, rptView:'overview',
  rptCatType:'expense', // expense | income
  transferCat:'deposit',
  subAccGroup:'', // 帳戶子頁目前顯示的分組 id
  newCatIcon:null,
  newAccIcon:null,
  accIconPreviewSize:40,
  catIconPreviewSize:32,
};

if(window.Chart && window.ChartDataLabels) Chart.register(ChartDataLabels);

// Draw simple leader lines from doughnut slices to labels
if(window.Chart){
  const leaderLinesPlugin={
    id:'leaderLines',
    afterDraw(chart){
      if(chart.config.type!=='doughnut') return;
      const ctx=chart.ctx;
      const meta=chart.getDatasetMeta(0);
      const dataset=chart.data.datasets[0];
      if(!meta?.data) return;
      ctx.save();
      ctx.strokeStyle='rgba(0,0,0,0.18)';
      ctx.lineWidth=1;
      meta.data.forEach((arc,idx)=>{
        const val=dataset.data[idx];
        if(!val) return;
        const angle=(arc.startAngle+arc.endAngle)/2;
        const r=arc.outerRadius;
        const x0=arc.x+Math.cos(angle)*(r+2);
        const y0=arc.y+Math.sin(angle)*(r+2);
        const x1=arc.x+Math.cos(angle)*(r+18);
        const y1=arc.y+Math.sin(angle)*(r+18);
        ctx.beginPath();
        ctx.moveTo(x0,y0);
        ctx.lineTo(x1,y1);
        ctx.stroke();
      });
      ctx.restore();
    }
  };
  Chart.register(leaderLinesPlugin);
}

/* ══ 工具 ══════════════════════════════════════ */
const fmt     = n=>Number(n).toLocaleString('zh-TW',{minimumFractionDigits:0});
const pad     = n=>String(n).padStart(2,'0');
const todayStr = () => {
  // use local date instead of UTC to avoid off-by-one due to timezone
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const nowTime = ()=>new Date().toTimeString().slice(0,5);
const DOW_CH  = ['日','一','二','三','四','五','六'];

function resolveIconUrl(icon){
  if(!icon) return '';
  if(icon.startsWith('data:')||icon.startsWith('http')||icon.startsWith('https')||icon.startsWith('/')) return icon;
  // allow specifying just the file name (e.g. "早餐.png") to load from /icon/
  if(icon.includes('/')||icon.includes('\\')){
    return encodeURI('/' + icon);
  }
  return encodeURI('/icon/' + icon);
}

function updateAccIconPreview(){
  const preview=document.getElementById('nacc-icon-preview');
  if(!preview) return;
  const sz = S.accIconPreviewSize || 40;
  preview.innerHTML = S.newAccIcon ? `<img src="${S.newAccIcon}" style="height:${sz}px;width:${sz}px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">` : '';
}
function updateCatIconPreview(){
  const preview=document.getElementById('ncat-icon-preview');
  if(!preview) return;
  const sz = S.catIconPreviewSize || 32;
  preview.innerHTML = S.newCatIcon ? `<img src="${S.newCatIcon}" style="height:${sz}px;width:${sz}px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : '';
}

function toast(msg, duration){
  document.querySelectorAll('._toast_el').forEach(e=>e.remove());
  const el=document.createElement('div');
  el.className='_toast_el';
  el.textContent=msg;
  el.setAttribute('style',
    'position:fixed !important;' +
    'top:50% !important;' +
    'left:50% !important;' +
    'transform:translate(-50%, -50%) !important;' +
    'background:#1e293b !important;' +
    'color:#fff !important;' +
    'padding:12px 22px !important;' +
    'border-radius:28px !important;' +
    'font-size:14px !important;' +
    'font-weight:500 !important;' +
    'z-index:2147483647 !important;' +
    'max-width:85vw !important;' +
    'text-align:center !important;' +
    'box-shadow:0 6px 24px rgba(0,0,0,0.4) !important;' +
    'pointer-events:none !important;'
  );
  document.documentElement.appendChild(el);
  setTimeout(()=>{ el.remove(); }, duration||2500);
}

async function api(url,opts={}){
  const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  if(!r.ok){
    const text=await r.text();
    throw new Error(text||r.statusText);
  }
  return r.json();
}

async function ensureBuiltinIcons(){
  if(!S.builtinIcons){
    try{ S.builtinIcons = await api('/api/icons'); }catch(e){ S.builtinIcons=[]; }
  }
}

// 【需求 2】圖示選擇新視窗
// 內建圖示選擇（含分類 tab）
const ICON_CATS=['食','衣','住','行','生活支出','學','娛樂','3C產品','醫療','其他','收入','帳戶','轉帳'];
let _iconCurCat=ICON_CATS[0]; // 預設選第一個分類
function openIconPicker(type){
  const el=document.getElementById('icon-picker');
  el.style.display='flex'; S._ipt=type; _iconCurCat=ICON_CATS[0];
  requestAnimationFrame(()=>el.classList.add('show'));
  renderIconCatTabs(); loadIconsForCat(_iconCurCat);
}
function renderIconCatTabs(){
  const bar=document.getElementById('icon-cat-tabs');
  if(!bar) return;
  bar.innerHTML=ICON_CATS.map(c=>
    `<button class="rpt-tab${c===_iconCurCat?' on':''}" onclick="switchIconCat('${c}')" style="padding:6px 10px;font-size:12px">${c}</button>`
  ).join('');
}
function switchIconCat(cat){
  _iconCurCat=cat;
  renderIconCatTabs();
  loadIconsForCat(cat);
}
function loadIconsForCat(cat){
  const list=document.getElementById('icon-list');
  list.innerHTML='<div style="padding:16px;color:var(--t3);font-size:13px;text-align:center">載入中...</div>';
  fetch('/api/icons'+(cat?'?category='+encodeURIComponent(cat):''))
    .then(r=>r.json()).then(files=>{
      if(!files.length){
        list.innerHTML='<div style="padding:24px;color:var(--t3);font-size:13px;text-align:center">此分類尚無圖示<br><small>/icon/'+(cat||'')+'/ 放置圖片</small></div>';
        return;
      }
      list.innerHTML=files.map(f=>
        `<div onclick="selectIcon('${f}')" style="text-align:center;cursor:pointer;padding:5px;border:1px solid var(--border);border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:2px;height:72px;">
          <img src="/icon/${f}" width="38" height="38" style="object-fit:contain;flex-shrink:0;">
          <div style="font-size:9px;color:var(--t3);width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${f.split('/').pop().replace(/\.png$/i,'').replace(/\.jpg$/i,'').replace(/\.svg$/i,'')}</div>
        </div>`).join('');
    }).catch(()=>{
      list.innerHTML='<div style="padding:24px;color:var(--t3);font-size:13px;text-align:center">載入失敗</div>';
    });
}
function selectIcon(filename,type){
  const t=(typeof type==='string'&&type)?type:S._ipt;
  if(t==='category'){S.newCatIcon='/icon/'+filename;updateCatIconPreview();}
  else{S.newAccIcon='/icon/'+filename;updateAccIconPreview();}
  closeIconPicker(); toast('圖示已選取 ✓');
}
function closeIconPicker(){const el=document.getElementById('icon-picker');el.classList.remove('show');setTimeout(()=>{el.style.display='none';},300);}


/* ══ 頁面導覽 ══════════════════════════════════ */
function goPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni[data-pg]').forEach(n=>n.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelector(`.ni[data-pg="${name}"]`)?.classList.add('active');
  if(name==='report')   renderReport();
  if(name==='accounts') renderAccounts();
}
document.querySelectorAll('.ni[data-pg]').forEach(el=>
  el.addEventListener('click',()=>goPage(el.dataset.pg)));

const openOverlay  = id=>{
  const el=document.getElementById(id);
  if(!el) return;
  // detail page behaves like bottom sheet but still uses show class
  el.classList.add('show');
};
const closeOverlay = id=>{
  const el=document.getElementById(id);
  if(!el) return;
  el.classList.remove('show');
};

/* ══════════════════════════════════════════════
   帳戶總覽（已調整為上下雙容器設計 + 金額左移）
══════════════════════════════════════════════ */
let ACC_GROUPS=[];

function renderAccounts(){
  const container=document.getElementById('acc-groups');
  const summary=document.getElementById('acc-summary');
  const accs=S.cfg.accounts||[];
  const posTotal = accs.reduce((s,a)=>s+Math.max(0,parseFloat(a.balance)||0),0);
  const negTotal = accs.reduce((s,a)=>s+Math.max(0,-(parseFloat(a.balance)||0)),0);
  const debtItems = advLoad('debt');
  // 【修正 Bug 1】總負債應使用「剩餘未還金額」（總額 - 已還），而非原始負債總額
  const debtTotal = debtItems.reduce((s,d)=>s+Math.max(0,(parseFloat(d.amount)||0)-(parseFloat(d.paid)||0)),0);
  const displayDebt = Math.max(negTotal, debtTotal);
  const globalTotal = posTotal - displayDebt;

  const netColor = globalTotal >= 0 ? '#22C55E' : 'var(--red)';
  const netDisplay = globalTotal >= 0 ? fmt(globalTotal) : fmt(Math.abs(globalTotal));

  summary.innerHTML = `
    <div class="acc-net-container">
      <div class="acc-net-left">
        <div class="title">淨資產</div>
        <div class="currency">TWD</div>
      </div>
      <div class="acc-net-amount" style="color:${netColor}">${netDisplay}</div>
    </div>
    <!-- 好看的標籤容器 -->
    <div class="acc-break-container">
      <div class="acc-assets">
        <div class="acc-break-tag">
          <span class="label">總資產</span>
          <span class="amt" style="color:var(--blue)">${fmt(posTotal)}</span>
        </div>
      </div>
      <div class="acc-liab">
        <div class="acc-break-tag">
          <span class="label">總負債</span>
          <span class="amt" style="color:var(--red)">${fmt(displayDebt)}</span>
        </div>
      </div>
    </div>`;

  container.innerHTML='';

  const groups=ACC_GROUPS;
  const accountGroups = groups.map(grp=>({
    ...grp,
    accs: accs.filter(a=>a.group===grp.id)
  }));
  const ungrouped = accs.filter(a=>!groups.some(g=>g.id===a.group));
  if(ungrouped.length){
    accountGroups.push({id:'g_other',name:'其他',color:'#8B909A',accs:ungrouped});
  }

  accountGroups.forEach(grp=>{
    const grpAccs=grp.accs;
    const total=grpAccs.reduce((s,a)=>s+(parseFloat(a.balance)||0),0);

    const card=document.createElement('div'); card.className='grp-card';
    card.innerHTML=`
      <div class="grp-header" data-gid="${grp.id}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:10px;height:10px;border-radius:50%;background:${grp.color}"></div>
          <div class="grp-title">${grp.name}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="grp-total" style="color:var(--blue);">NT$ ${fmt(total)}</div>
          <div class="grp-arrow">▼</div>
        </div>
      </div>
      <div class="grp-body">
        ${grpAccs.length
          ? grpAccs.map(a=>{
              const dotColor = a.color || grp.color;
              const bal = parseFloat(a.balance)||0;
              const balColor = bal>=0? 'var(--acc)' : 'var(--red)';
              const accIcon = a.icon ? `<img class="acc-icon" src="${resolveIconUrl(a.icon)}" alt="${a.name}" style="border-color:${dotColor};">` : `<div class="acc-dot" style="background:${dotColor}"></div>`;
              return `<div class="acc-row" data-aid="${a.id}">${accIcon}<div class="acc-name">${a.name}</div><div class="acc-bal" style="color:${balColor};cursor:pointer">NT$ ${fmt(a.balance||0)}</div></div>`;
            }).join('')
          : `<div class="empty-grp">尚無帳戶，可至功能 › 設定 › ${grp.name} 新增</div>`
        }
      </div>`;

    const hdr=card.querySelector('.grp-header');
    const body=card.querySelector('.grp-body');
    const arrow=card.querySelector('.grp-arrow');
    body.querySelectorAll('.acc-row').forEach(row=>{
      const aid=row.dataset.aid;
      row.querySelector('.acc-bal').style.cursor='pointer';
      row.querySelector('.acc-bal').addEventListener('click',e=>{
        e.stopPropagation();
        S.accFilter = aid;
        goPage('home');
      });
    });
    body.classList.add('open'); arrow.classList.add('open');
    hdr.addEventListener('click',()=>{
      body.classList.toggle('open'); arrow.classList.toggle('open');
    });
    container.appendChild(card);
  });
}
/* ══════════════════════════════════════════════
   帳戶頁 資產/負債 切換
══════════════════════════════════════════════ */
let _accTab = 'asset';
function switchAccTab(tab){
  _accTab = tab;
  document.getElementById('acc-tab-asset')?.classList.toggle('on', tab==='asset');
  document.getElementById('acc-tab-debt')?.classList.toggle('on', tab==='debt');
  document.getElementById('acc-groups').style.display = tab==='asset' ? '' : 'none';
  document.getElementById('acc-debt-section').style.display = tab==='debt' ? '' : 'none';
  if(tab==='debt') renderDebtSection();
}

/* ── 負債分類 ── */
const DEBT_CATS=[
  {id:'loan',      name:'貸款',     color:'#DC2626', expenseCatId:'other'},
  {id:'installment',name:'分期付款',    color:'#7C3AED', expenseCatId:'other'},
  {id:'Borrow_money',     name:'借錢',     color:'#0EA5E9', expenseCatId:'other'},
  {id:'Credit_card_debt',name:'信用卡債', color:'#F59E0B', expenseCatId:'other'},
];
function flatDebtCats(arr){
  return (arr||[]).reduce((a,c)=>{a.push(c);if(c.children)a=a.concat(flatDebtCats(c.children));return a;},[]);
}
function findDebtCat(id){
  return flatDebtCats(DEBT_CATS).find(c=>c.id===id)||{id,name:id,color:'#8B909A'};
}

/* ── 負債列表（已新增「帳戶」顯示 + 開始日期與時間） ── */
function renderDebtSection(){
  const el = document.getElementById('acc-debt-section');
  const items = advLoad('debt');
  const total = items.reduce((s,d)=>s+(parseFloat(d.amount)||0),0);
  
  let html = '';

  // 新增負債按鈕
  html += '<button onclick="openDebtOverlay()" style="width:100%;padding:14px;margin-bottom:20px;background:var(--sf2);border:1px dashed var(--border);border-radius:var(--rs);color:var(--t2);font-size:15px;font-weight:600;cursor:pointer;font-family:var(--sans);transition:.15s;">＋ 新增負債</button>';

  if(!items.length){
    html += '<div class="empty-tip" style="padding:32px 0;text-align:center">尚無負債記錄</div>';
  } else {
    html += items.map((d,i)=>{
      const cat = findDebtCat(d.category);
      const paid = parseFloat(d.paid||0);
      const amt = parseFloat(d.amount||0);
      const pct = amt>0?Math.min(100,Math.round(paid/amt*100)):0;
      const remain = Math.max(0,amt-paid);
      const barColor = pct>=100?'var(--acc)':pct>=70?'#FFD166':'var(--red)';

      // 【本次新增】顯示已選帳戶名稱
      const accName = d.account 
        ? (S.cfg.accounts||[]).find(a=>a.id===d.account)?.name || '未設定' 
        : '未設定';
      const accountInfo = `<div style="font-size:11px;color:var(--t3);margin-top:4px;">帳戶：${accName}</div>`;

      // 開始日期與時間
      let startInfo = '';
      if(d.startDate){
        startInfo = `<div style="font-size:11px;color:var(--t3);margin-top:4px;">開始：${d.startDate} ${d.startTime||'00:00'}</div>`;
      }

      // 【修正 Bug 3】判斷是否已清償（已還金額 >= 負債總額）
      const isCleared = (pct >= 100);

      // 若剛完成清償且有綁定固定支出，自動移除對應的 recurring 項目
      if(isCleared && d.fixedDay){
        const recs = advLoad('recurring');
        const ri = recs.findIndex(r => r.note && r.note.includes(d.name) && r.periodUnit === 'month');
        if(ri >= 0){ recs.splice(ri,1); advSave('recurring',recs); }
      }

      // 已清償時顯示精美綠色徽章
      const clearedBadge = isCleared
        ? '<span class="debt-cleared-badge">✓ 已清償</span>'
        : '';

      return '<div class="debt-card'+(isCleared?' cleared':'')+'">'
        +'<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">'
        +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;">'
        +'<span style="width:10px;height:10px;border-radius:50%;background:'+cat.color+';flex-shrink:0;display:inline-block;"></span>'
        +'<span style="font-weight:700;font-size:15px;'+(isCleared?'text-decoration:line-through;opacity:.55;':'')+'">'+escHtml(d.name||cat.name)+'</span>'
        +'<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:rgba(220,38,38,0.1);color:var(--red);">'+cat.name+'</span>'
        +clearedBadge
        +'</div>'
        +'<div style="display:flex;gap:6px;flex-shrink:0;" onclick="event.stopPropagation()">'
        +'<button onclick="openDebtOverlay('+i+')" style="padding:4px 10px;border-radius:999px;background:var(--sf2);color:var(--t2);border:1px solid var(--border);font-size:12px;cursor:pointer;">✎</button>'
        +'<button onclick="deleteDebt('+i+')" class="row-del-btn" style="width:28px;height:28px;">✕</button>'
        +'</div></div>'
        +'<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);margin-bottom:8px;">'
        +'<span>總額 <strong style="color:var(--red);font-family:var(--mono);">NT$ '+fmt(amt)+'</strong></span>'
        +'<span>月還款 <strong style="color:var(--t1);font-family:var(--mono);">NT$ '+fmt(d.payment||0)+'</strong></span>'
        +'</div>'
        // 【修正 Bug 2】進度條高度從 4px 增至 8px，加動畫，更易辨識
        +'<div style="height:8px;background:var(--sf2);border-radius:4px;margin-bottom:8px;overflow:hidden;">'
        +'<div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:4px;transition:width .4s;"></div></div>'
        +'<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);">'
        +'<span>已還 <strong style="font-family:var(--mono);color:var(--t2);">'+pct+'%</strong>'+(remain>0?' · 剩 <strong style="font-family:var(--mono);color:var(--red);">NT$ '+fmt(remain)+'</strong>':'')+'</span>'
        +(d.fixedDay&&!isCleared?'<span>每月 '+d.fixedDay+' 日還款</span>':'')
        +'</div>'
        +(d.endDate?'<div style="font-size:11px;color:var(--t3);margin-top:4px;">截止：'+d.endDate+'</div>':'')
        +startInfo
        +accountInfo
        +(d.note?'<div style="font-size:11px;color:var(--t3);margin-top:2px;">備註：'+escHtml(d.note)+'</div>':'')
        +'</div>';
    }).join('');
  }
  
  el.innerHTML = html;
}

function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ── 負債分類選擇格 ── */
let _debtCatSel='', _debtCatParent=null;
function renderDebtCatGrid(parent){
  _debtCatParent=parent||null;
  const cats=parent?parent.children:DEBT_CATS;
  const grid=document.getElementById('debt-cat-grid');
  if(!grid) return;
  grid.innerHTML='';
  if(parent){
    const back=document.createElement('div');
    back.className='debt-cat-chip';
    back.innerHTML='◀ 返回';
    back.addEventListener('click',()=>renderDebtCatGrid(null));
    grid.appendChild(back);
  }
  cats.forEach(c=>{
    const chip=document.createElement('div');
    chip.className='debt-cat-chip'+(_debtCatSel===c.id?' on':'');
    chip.style.borderColor=c.color;
    chip.style.color=_debtCatSel===c.id?c.color:'';
    chip.textContent=c.name+(c.children?' ›':'');
    chip.addEventListener('click',()=>{
      if(c.children){renderDebtCatGrid(c);}
      else{_debtCatSel=c.id;renderDebtCatGrid(parent);}
    });
    grid.appendChild(chip);
  });
}

/* ── 開啟負債表單（已新增「帳戶」下拉選單） ── */
/* ── 負債表單：獨立 Overlay 頁（Item 1 全面重寫）── */
function openDebtOverlay(idx){
  const items=advLoad('debt');
  const d=(idx!==undefined&&idx!==null&&idx>=0)?items[idx]:null;
  _debtCatSel=d?d.category:'';
  _debtCatParent=null;

  // 使用 adv-page overlay（reuse）
  const body=document.getElementById('adv-body');
  document.getElementById('adv-title').textContent=d?'編輯負債':'新增負債';
  document.getElementById('adv-add-btn').style.display='none';

  const accOpts=(S.cfg.accounts||[]).map(a=>`<option value="${a.id}" ${d&&d.account===a.id?'selected':''}>${a.name}</option>`).join('');

  body.innerHTML=`<div style="padding:4px 0">
    <!-- 【Item 1】返回按鈕字放大 -->
    <button onclick="renderDebtSection();document.getElementById('adv-page').classList.remove('show')"
      style="background:none;border:none;color:var(--blue);font-size:16px;font-weight:600;cursor:pointer;margin-bottom:16px;display:flex;align-items:center;gap:6px;">
      ◀ 返回列表</button>

    <div class="fg" style="margin-bottom:10px;"><label>名稱／描述</label>
      <input type="text" class="finp" id="debt-name" value="${d?escHtml(d.name||''):''}" placeholder="例：國泰房貸、信用卡欠款"></div>

    <div class="fg" style="margin-bottom:10px;"><label>分類</label>
      <div id="debt-cat-grid" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>

    <div class="fg" style="margin-bottom:10px;"><label>帳戶</label>
      <select class="fsel" id="debt-account">${accOpts}</select></div>

    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <div class="fg" style="flex:1;"><label>開始日期</label>
        <input type="date" class="finp" id="debt-startdate" value="${d?d.startDate||'':''}" ></div>
      <div class="fg" style="flex:1;"><label>時間</label>
        <input type="time" class="finp" id="debt-starttime" value="${d?d.startTime||'':''}" ></div>
    </div>

    <div class="fg" style="margin-bottom:10px;"><label>負債總額</label>
      <input type="number" class="finp" id="debt-amount" value="${d?d.amount||'':''}" placeholder="0" inputmode="decimal"></div>

    <div class="fg" style="margin-bottom:10px;"><label>月還款金額</label>
      <input type="number" class="finp" id="debt-payment" value="${d?d.payment||'':''}" placeholder="0" inputmode="decimal"></div>

    <div class="fg" style="margin-bottom:10px;"><label>已還金額（選填）</label>
      <input type="number" class="finp" id="debt-paid" value="${d?d.paid||0:0}" placeholder="0" inputmode="decimal"></div>

    <!-- 【Item 1】週期功能（與固定支出相同） -->
    <div class="fg" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="debt-fixed-chk" style="width:18px;height:18px;cursor:pointer;"
          ${d&&d.fixedDay?'checked':''} onchange="toggleDebtFixedDay()">
        <label for="debt-fixed-chk" style="font-size:13px;color:var(--t1);cursor:pointer;">固定還款（自動新增至固定支出）</label>
      </div>
      <div id="debt-fixed-day-row" style="margin-top:10px;display:${d&&d.fixedDay?'block':'none'};">
        <div class="fg" style="margin-bottom:8px;"><label>每月還款日</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:13px;color:var(--t2);">每月</span>
            <input type="number" class="finp" id="debt-fixed-day" value="${d?d.fixedDay||'':''}"
              placeholder="15" min="1" max="31" inputmode="numeric" style="width:80px;">
            <span style="font-size:13px;color:var(--t2);">日</span>
          </div>
        </div>
        <!-- 週期功能 -->
        <div class="fg" style="margin-bottom:8px;"><label>還款週期</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:13px;color:var(--t2);">每</span>
            <input type="number" class="finp" id="debt-period-n" value="${d?d.periodN||1:1}"
              min="1" inputmode="numeric" style="width:70px;">
            <select class="fsel" id="debt-period-unit" style="flex:1">
              <option value="day" ${d&&d.periodUnit==='day'?'selected':''}>天</option>
              <option value="week" ${d&&d.periodUnit==='week'?'selected':''}>週</option>
              <option value="month" ${(!d||!d.periodUnit||d.periodUnit==='month')?'selected':''}>月</option>
              <option value="year" ${d&&d.periodUnit==='year'?'selected':''}>年</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="fg" style="margin-bottom:10px;"><label>截止日期（選填）</label>
      <input type="date" class="finp" id="debt-end-date" value="${d?d.endDate||'':''}" ></div>

    <div class="fg" style="margin-bottom:16px;"><label>備註（選填）</label>
      <input type="text" class="finp" id="debt-note" value="${d?escHtml(d.note||''):''}" placeholder="選填"></div>

    <div class="acc-btns">
      <button class="acc-btn" onclick="document.getElementById('adv-page').classList.remove('show');renderDebtSection()">取消</button>
      <button class="acc-btn ok" onclick="saveDebtFromOverlay(${idx!==undefined&&idx!==null&&idx>=0?idx:-1})">儲存</button>
    </div>
  </div>`;

  renderDebtCatGrid();
  openOverlay('adv-page');
}

function saveDebtFromOverlay(idx){ saveDebt(idx); document.getElementById('adv-page').classList.remove('show'); }

/* ── 儲存負債 ── */
async function saveDebt(idx){
  const items = advLoad('debt');
  const isEdit = (idx >= 0);

  const name = document.getElementById('debt-name').value.trim();
  if(!name){ toast('請輸入名稱'); return; }

  if(!_debtCatSel){ toast('請選擇負債分類'); return; }

  const amount = parseFloat(document.getElementById('debt-amount').value)||0;
  if(!amount){ toast('請輸入負債總額'); return; }

  const newDebt = {
    name,
    category: _debtCatSel,
    account: document.getElementById('debt-account').value || '',
    amount,
    payment: parseFloat(document.getElementById('debt-payment').value)||0,
    paid: parseFloat(document.getElementById('debt-paid').value)||0,
    fixedDay: document.getElementById('debt-fixed-chk').checked
      ? parseInt(document.getElementById('debt-fixed-day').value)||15 : null,
    // 【Item 1】週期欄位
    periodN: parseInt(document.getElementById('debt-period-n')?.value)||1,
    periodUnit: document.getElementById('debt-period-unit')?.value||'month',
    endDate: document.getElementById('debt-end-date').value||'',
    startDate: document.getElementById('debt-startdate').value||'',
    startTime: document.getElementById('debt-starttime').value||'',
    note: document.getElementById('debt-note').value.trim()
  };

  if(isEdit){
    items[idx] = newDebt;
    toast('已更新負債');
  } else {
    items.push(newDebt);
    toast('已新增負債');
  }

  advSave('debt', items);

  if(newDebt.fixedDay){
    await autoAddDebtToRecurring(newDebt);
  }

  renderDebtSection();
  renderAccounts();
}


function toggleDebtFixedDay(){
  const chk=document.getElementById('debt-fixed-chk');
  document.getElementById('debt-fixed-day-row').style.display=chk.checked?'block':'none';
}

/* ── 自動把負債的「固定還款」轉成 recurring 固定支出項目 ── */
/* 避免每次儲存都重複新增，會先檢查是否已存在同名 recurring */
async function autoAddDebtToRecurring(debt){
  let recurring = advLoad('recurring');
  
  // 檢查是否已經有這筆負債的固定還款（用 name 判斷）
  const existingIndex = recurring.findIndex(r => 
    r.note && r.note.includes(debt.name) && r.periodUnit === 'month'
  );
  
  const recurringItem = {
    type: 'expense',
    category: debt.category || 'other',
    amount: debt.payment || 0,
    startdate: debt.startDate || todayStr(),
    time: debt.startTime || '00:00',
    // 【Item 1】使用負債設定的週期
    periodN: debt.periodN || 1,
    periodUnit: debt.periodUnit || 'month',
    note: '固定還款：' + debt.name,
    endDate: debt.endDate || '',
    account: debt.account || '',  // 【修正 Bug 2】將負債帳戶帶入固定支出，避免顯示「未設定」
    lastRun: ''   // 讓 checkRecurring 自動判斷是否需要執行
  };
  
  if(existingIndex >= 0){
    // 已存在 → 更新
    recurring[existingIndex] = recurringItem;
  } else {
    // 不存在 → 新增
    recurring.push(recurringItem);
  }
  
  advSave('recurring', recurring);
  
  // 【修正 Bug 1b】await 等待 checkRecurring 完成，確保帳戶餘額更新後再重繪
  await checkRecurring();
}

function deleteDebt(i){
  const items=advLoad('debt');
  const d=items[i];
  customConfirm(d.name||'此負債').then(ok=>{
    if(!ok) return;
    // 移除關聯固定支出
    if(d._id){
      const recs=advLoad('recurring');
      const ri=recs.findIndex(r=>r._debtId===d._id);
      if(ri>=0){recs.splice(ri,1);advSave('recurring',recs);}
    }
    items.splice(i,1);
    advSave('debt',items);
    renderDebtSection();
    renderAccounts();
    toast('已刪除');
  });
}

/* ══════════════════════════════════════════════
   首頁
══════════════════════════════════════════════ */
async function renderHome(){
  // load records for current calendar month
  const y=S.calY, m=S.calM;
  let url=`/api/records?year=${y}&month=${String(m).padStart(2,'0')}`;
  const rA=await api(url);
  S.monthRecs = rA;
  renderMonthCalendar();
  renderDateHeader();
  renderDayRecs(S.selDate);
}

function renderDayRecs(ds){
  const list=document.getElementById('rec-list');
  // sort ascending by time so earliest items appear at top
  let recs=S.monthRecs.filter(r=>r.date===ds).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  // if an account filter is active, remove unrelated records
  if(S.accFilter){
    recs = recs.filter(r=>r.account===S.accFilter || r.to_account===S.accFilter);
  }
  if(!recs.length){ list.innerHTML='<div class="empty-tip">✨ 這天沒有記錄<br>點 ＋ 開始記帳</div>'; return; }
  list.innerHTML='';
  function flat(arr){return arr.reduce((a,c)=>{a.push(c);if(c.children) a=a.concat(flat(c.children));return a;},[]);}  
  const cats=[...flat(S.cfg.categories.expense||[]),...flat(S.cfg.categories.income||[]),...flat(S.cfg.categories.transfer||[])];
  recs.forEach(r=>{
    let catName=''; let catColor='#8B909A';
    let subText='';
    let acc; // will hold account object for non-transfer types
    if(r.type==='transfer'){
      const it=r.items[0]||{};
      const fromAcc=(S.cfg.accounts||[]).find(a=>a.id===it.from)||{name:it.from};
      const toAcc=(S.cfg.accounts||[]).find(a=>a.id===it.to)||{name:it.to};
      const transferCat=(S.cfg.categories?.transfer||[]).find(c=>c.id===r.category||c.id===it.category);
      const transferLabel = transferCat?`[${transferCat.name}] `:'';
      catColor = transferCat?.color||'#4CC9F0';
      catName=`${transferLabel}${fromAcc.name} → ${toAcc.name}`;
      subText=`${fmt(it.amount)}`;
    } else {
      if(r.category){
        const cc=cats.find(c=>c.id===r.category);
        if(cc){ catName=cc.name; catColor=cc.color||'#8B909A'; }
      }
      acc=(S.cfg.accounts||[]).find(a=>a.id===r.account);
      if(r.items && r.items.length){
        if(r.items.length>1){
          subText=`共 ${r.items.length} 項`;
        } else {
          const it=r.items[0];
          if(it.qty && it.price){
            subText=`${it.qty}×${fmt(it.price)}`;
          } else if(it.amount){
            subText=`${fmt(it.amount)}`;
          }
        }
      }
    }
    const row=document.createElement('div'); row.className='rec-row';
    row.innerHTML=`
      <div class="rec-l">
        <div class="rec-date">${r.time||''}</div>
        <div class="rec-cat" style="background:${catColor}">${catName}</div>
      </div>
      <div class="rec-r">
        <div class="rec-amt${r.type==='expense'?' exp':r.type==='income'?' inc':''}">NT$ ${fmt(r.amount)}</div>
        <div class="rec-sub">${subText}</div>
      </div>`;
    row.addEventListener('click',()=>openDetail(r));
    list.appendChild(row);
  });
}

function renderMonthCalendar(){
  const y=S.calY, m=S.calM;
  const first=new Date(y,m-1,1);
  const startDay=first.getDay();
  const daysInMonth=new Date(y,m,0).getDate();
  const grid=document.getElementById('month-grid');
  grid.innerHTML='';
  // header row
  const dowNames=['日','一','二','三','四','五','六'];
  const row1=document.createElement('div'); row1.className='month-row';
  dowNames.forEach(d=>{const c=document.createElement('div');c.className='month-cell month-dow';c.textContent=d;row1.appendChild(c);});
  grid.appendChild(row1);
  let day=1;
  for(let r=0;r<6;r++){
    const row=document.createElement('div'); row.className='month-row';
    for(let c=0;c<7;c++){
      const cell=document.createElement('div'); cell.className='month-cell';
      if(r===0 && c<startDay){cell.textContent='';}
      else if(day>daysInMonth){cell.textContent='';}
      else{
        cell.textContent=day;
        const ds=`${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        // 標註今日與當前選中
        if(ds===todayStr()) cell.classList.add('today');
        if(ds===S.selDate) cell.classList.add('sel');
        // 若該日有任何記錄，顯示左上角小點
        if(S.monthRecs.some(r=>r.date===ds)){
          const dot=document.createElement('div'); dot.className='rec-dot-small';
          cell.appendChild(dot);
        }
        cell.addEventListener('click',()=>{
          S.selDate=ds;
          // if user somehow clicks a date from another month (shouldn't happen since
          // out-of-month cells are blank) update the calendar state and fetch new records
          if(new Date(ds).getMonth()+1!==S.calM){
            S.calY=new Date(ds).getFullYear();
            S.calM=new Date(ds).getMonth()+1;
            renderHome(); // load records for the new month
            return;
          }
          renderDateHeader();
          renderDayRecs(ds);
          renderMonthCalendar();
        });
        day++;
      }
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

function renderDateHeader(){
  const d=new Date(S.selDate+'T00:00:00');
  const dow=DOW_CH[d.getDay()];
  document.getElementById('sd-big').textContent=
    `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
  document.getElementById('sd-dow').textContent=`星期${dow}`;
  const td=todayStr();
  let label = S.selDate===td ? `今日記錄（${d.getMonth()+1}月${d.getDate()}日）` : `${d.getMonth()+1} 月 ${d.getDate()} 日記錄`;
  document.getElementById('day-label').textContent=label;
  const filtEl=document.getElementById('acc-filter');
  if(S.accFilter){
    const acc=S.cfg.accounts.find(a=>a.id===S.accFilter);
    if(acc){
      filtEl.textContent=`[${acc.name} ✕]`;
      filtEl.style.display='inline';
      filtEl.onclick=()=>{ S.accFilter=''; renderHome(); };
    } else {
      filtEl.style.display='none';
    }
  } else {
    filtEl.style.display='none';
  }
}

/* ══════════════════════════════════════════════
   清理存錢筒 logs（解決首頁刪除後詳情頁仍顯示的 bug）
══════════════════════════════════════════════ */
async function cleanupPiggyLogs() {
  const records = await api('/api/records');
  let piggies = advLoad('piggy');
  let changed = false;
  for (let i = 0; i < piggies.length; i++) {
    const p = piggies[i];
    const filtered = (p.logs || []).filter(l =>
      records.some(r => r.type === 'piggy' && (r.piggyName === p.name || r.note === p.name) && r.date === l.date)
    );
    if (filtered.length !== (p.logs || []).length) changed = true;
    p.logs = filtered;
    p.saved = filtered.reduce((sum, l) => sum + (l.amount || 0), 0);
  }
  if (changed) advSave('piggy', piggies);
}

function renderDayRecs(ds){
  const list=document.getElementById('rec-list');
  // sort ascending by time so earliest items appear at top
  let recs=S.monthRecs.filter(r=>r.date===ds).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  if(S.accFilter)recs=recs.filter(r=>r.account===S.accFilter||r.to_account===S.accFilter);
  if(!recs.length){ list.innerHTML='<div class="empty-tip">✨ 這天沒有記錄<br>點 ＋ 開始記帳</div>'; return; }
  list.innerHTML='';
  function flat(arr){return arr.reduce((a,c)=>{a.push(c);if(c.children) a=a.concat(flat(c.children));return a;},[]);}  
  const cats=[...flat(S.cfg.categories.expense||[]),...flat(S.cfg.categories.income||[]),...flat(S.cfg.categories.transfer||[])];
  recs.forEach(r=>{
    let catName=''; let catColor='#8B909A';
    let subText='';
    let acc; // will hold account object for non-transfer types
    let transferTag=null;
    let catIconHTML='';
    if(r.type==='transfer'){
      const it=r.items[0]||{};
      const fromAcc=(S.cfg.accounts||[]).find(a=>a.id===it.from)||{name:it.from};
      const toAcc=(S.cfg.accounts||[]).find(a=>a.id===it.to)||{name:it.to};
      const transferCat=(S.cfg.categories?.transfer||[]).find(c=>c.id===r.category||c.id===it.category);
      const transferLabel = transferCat?transferCat.name:'';
      const transferColor = transferCat?.color||'#4CC9F0';
      catName=`${fromAcc.name} → ${toAcc.name}`;
      catColor = transferColor;
      subText=r.time||'';
      transferTag={label:transferLabel,color:transferColor};
      // 優先用轉帳類別圖示，其次用 fromAcc 圖示
      const iconSrc = transferCat?.icon ? resolveIconUrl(transferCat.icon)
        : fromAcc?.icon ? resolveIconUrl(fromAcc.icon) : null;
      if(iconSrc){
        catIconHTML=`<img class="rec-cat-icon" src="${iconSrc}" alt="${transferLabel}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;flex-shrink:0;border:none">`;
      }
    } else if(r.type==='adjust'){
      const accObj=(S.cfg.accounts||[]).find(a=>a.id===r.account)||{name:r.account};
      catName='調整';
      catColor='#9B5DE5';
      subText=`${r.time||''} · ${accObj.name}`;
      if(r.note) subText+=` · ${r.note}`;
    } else if(r.type==='piggy'){

      catName=r.piggyName||'存錢筒';
      catColor='#F59E0B';
      catIconHTML='<img class="rec-cat-icon" src="/icon/存錢筒.png" style="width:36px;height:36px;object-fit:cover;border-radius:8px;flex-shrink:0;border:none">';
      acc=(S.cfg.accounts||[]).find(a=>a.id===r.account)||{name:r.account};
      // 💡 piggy 類型在時間後面顯示帳戶名（表示從哪個帳戶扣錢），而不是備註
      subText=r.time?`<span class="rec-inline-chip">${r.time}</span>`:'';
      if(acc && acc.name) subText+= ` · <span class="rec-inline-chip">${acc.name}</span>`;
    } else {
      // use item category if present
      const firstCatId = r.items && r.items[0] && r.items[0].category;
      // 【修正 Bug 2】找不到時補查 DEBT_CATS（負債固定還款的分類 ID 如 borrow/loan 不在一般分類裡）
      const catObj = cats.find(c=>c.id===firstCatId) || cats.find(c=>c.id===r.category)
        || flatDebtCats(DEBT_CATS).find(c=>c.id===firstCatId) || flatDebtCats(DEBT_CATS).find(c=>c.id===r.category)
        || {name:r.category,color:'#8B909A'};
      catName=catObj.name;
      catColor=catObj.color;
      acc=(S.cfg.accounts||[]).find(a=>a.id===r.account)||{name:r.account};
      // build meta tags (merchant on left, project+account on right)
      const timeLabel = r.time ? `<span class="rec-sub-chip"><strong>${r.time}</strong></span>` : '';
      const merchantLabel = r.merchant ? `<span class="rec-sub-chip">${(S.cfg.merchants||[]).find(m=>m.id===r.merchant)?.name||r.merchant}</span>` : '';
      const expertLabel = r.expert ? `<span class="rec-sub-chip">${(S.cfg.experts||[]).find(e=>e.id===r.expert)?.name||r.expert}</span>` : '';
      const accountLabel = acc && acc.name ? `<span class="rec-sub-chip">${acc.name}</span>` : '';
      const left = [timeLabel, merchantLabel].filter(Boolean).join('');
      const right = [expertLabel, accountLabel].filter(Boolean).join('');
      subText = `<div class="rec-sub-left">${left}</div><div class="rec-sub-right">${right}</div>`;
      if(r.note) catName+=` · ${r.note}`;
      if(catObj.icon)catIconHTML='<img class="rec-cat-icon" src="'+resolveIconUrl(catObj.icon)+'" style="width:36px;height:36px;object-fit:cover;border-radius:8px;flex-shrink:0;border:none">';
    }
    var nd=r.note||'',dn=catName.replace(/ · .*$/,'');
    var typeColors={expense:'var(--red)',income:'var(--acc)',transfer:'var(--blue)',adjust:'#9B5DE5',piggy:'#F59E0B'};
    var tc=typeColors[r.type]||'#8B909A';
    var ac=r.type==='expense'?'r':r.type==='income'?'g':r.type==='adjust'?'a':r.type==='piggy'?'g':'b';
    var sg=r.type==='expense'?'-':r.type==='income'?'+':r.type==='adjust'?'±':r.type==='piggy'?'<img src="/icon/piggy-bank.png" width="17" height="17" style="object-fit:contain;vertical-align:middle;margin-right:3px;"> ':'⇄';
    var hi=!!catIconHTML;
    var ic='';
    if(r.type!=='transfer'&&r.type!=='adjust'){
      var tch=r.time?'<span class="rec-inline-chip">'+r.time+'</span>':'';
      var mn=(S.cfg.merchants||[]).find(function(m){return m.id===r.merchant;});
      var mch=mn?'<span class="rec-inline-chip">'+(mn.name||mn)+'</span>':'';
      ic=[tch,mch].filter(Boolean).join('');
    }else ic=r.time?'<span class="rec-inline-chip">'+r.time+'</span>':'';
    var tr='';
    if(r.type!=='transfer'&&r.type!=='adjust'){
      var en=(S.cfg.experts||[]).find(function(e){return e.id===r.expert;});
      var an=acc&&acc.name?acc.name:'';
      var tgs=[];
      if(en)tgs.push('<span class="rec-tag exp">'+(en.name||en)+'</span>');
      if(an)tgs.push('<span class="rec-tag acc">'+an+'</span>');
      if(tgs.length)tr='<div class="rec-tag-row">'+tgs.join('')+'</div>';
    }
    var nh='';
    if(r.note){
      nh='<div class="rec-note">'+r.note+'</div>';
    } else if(r.type==='expense'||r.type==='income'){
      var itemNotes=(r.items||[]).map(function(it){return it.note||'';}).filter(Boolean);
      if(itemNotes.length===1){
        nh='<div class="rec-note">'+itemNotes[0]+'</div>';
      } else if(itemNotes.length===2){
        nh='<div class="rec-note">'+itemNotes.join('、')+'</div>';
      } else if(itemNotes.length>=3){
        nh='<div class="rec-note">有多項內容</div>';
      }
    }
    var sn=(r.type==='transfer'||r.type==='adjust')?catName:dn;
    var item=document.createElement('div');
    item.className='rec-item'+(hi?' has-icon':'');
        var ttag=transferTag?'<span class="rec-transfer-tag" style="background:'+transferTag.color+';display:block;margin-top:3px;">'+transferTag.label+'</span>':'';
    item.innerHTML='<div class="rec-type-dot" style="background:'+tc+'"></div>'
      +(catIconHTML||'<div class="rec-dot" style="background:'+catColor+'"></div>')
      +'<div class="rec-info"><div class="rec-name"><span>'+sn+'</span>'+ic+'</div>'+nh+'</div>'
      +'<div class="rec-right"><div class="rec-amt '+ac+'">'+sg+fmt(r.amount)+'</div>'+tr+ttag+'</div>';
    item.dataset.id = r.id;
    let pt;
    item.addEventListener('touchstart',()=>{pt=setTimeout(()=>delRec(r.id),650);},{passive:true});
    item.addEventListener('touchend',()=>clearTimeout(pt));
    item.addEventListener('mousedown',()=>{pt=setTimeout(()=>delRec(r.id),650);});
    item.addEventListener('mouseup',()=>clearTimeout(pt));
    list.appendChild(item);
  });
  // detail-edit-btn 只綁一次（移出 forEach）
  const editBtn=document.getElementById('detail-edit-btn');
  if(editBtn&&!editBtn._bound){
    editBtn._bound=true;
    editBtn.addEventListener('click',()=>{
      closeOverlay('detail-page');
      if(S.editRec) openAddPage(S.editRec);
    });
  }
}

async function delRec(id){
  if(!confirm('確定刪除？')) return;  
  try {
    // 1️⃣ 先取得記錄詳情（檢查是否為存錢筒類型）
    const allRecs = await api('/api/records');
    const rec = allRecs.find(r => r.id === id);    
    // 2️⃣ 如果是存錢筒記錄，同時刪除 localStorage 中的 logs
    if(rec && rec.type === 'piggy') {
      const piggies = advLoad('piggy');
      const piggyIdx = rec.piggyId;     
      if(piggies[piggyIdx]) {
        const pg = piggies[piggyIdx];
        // 從 logs 中移除該筆記錄
        if(pg.logs && pg.logs.length > 0) {
          pg.logs = pg.logs.filter(log => 
            !(log.date === rec.date && log.amount === rec.amount)
          );
          // 同時減少 saved 金額
          pg.saved = Math.max(0, (pg.saved || 0) - rec.amount);
          advSave('piggy', piggies);
        }
      }
    }    
    // 3️⃣ 刪除後端記錄
    await api(`/api/records/${id}`, {method: 'DELETE'});    
    toast('已刪除');
    await renderHome();
    await loadCfg();
    if(document.getElementById('page-accounts').classList.contains('active')) renderAccounts();
  } catch(err) {
    toast('刪除失敗：' + (err.message || err));
  }
}

document.getElementById('cal-prev').addEventListener('click',()=>{
  S.calM--; if(S.calM<1){S.calM=12;S.calY--;}
  // adjust selDate to first of new month and refresh
  S.selDate=`${S.calY}-${String(S.calM).padStart(2,'0')}-01`;
  renderHome();
});
document.getElementById('cal-next').addEventListener('click',()=>{
  S.calM++; if(S.calM>12){S.calM=1;S.calY++;}
  S.selDate=`${S.calY}-${String(S.calM).padStart(2,'0')}-01`;
  renderHome();
});

// detail overlay close
if(document.getElementById('detail-close')){
  document.getElementById('detail-close').addEventListener('click',()=>{
    document.getElementById('detail-page').classList.remove('show');
  });
}
// no need to override openOverlay; detail-page uses same show class logic

/* ══════════════════════════════════════════════
   報表
══════════════════════════════════════════════ */
function flattenCats(arr){return (arr||[]).reduce(function(a,c){a.push(c);if(c.children)a=a.concat(flattenCats(c.children));return a;},[]);}
async function renderReport(){
  var y=S.rptY,m=S.rptM;
  document.getElementById('rpt-label').textContent=y+' 年 '+m+' 月';
  var d=await api('/api/report?year='+y+'&month='+m);
  var pal=['#FF5F6D','#FF9A5C','#FFD166','#06D6A0','#4CC9F0','#4895EF','#7B5EA7','#F72585'];
  var maxV=Math.max(d.total_expense,d.total_income,1);
  var net=d.net,nc=net>=0?'var(--acc)':'var(--red)';
  document.getElementById('rv-overview').innerHTML=
    '<div class="hbar-row"><div class="hbar-label"><span class="hl-name">支出</span><span class="hl-val" style="color:var(--red)">-NT$ '+fmt(d.total_expense)+'</span></div><div class="hbar-track"><div class="hbar-fill" style="width:'+(d.total_expense/maxV*100).toFixed(1)+'%;background:var(--red)"></div></div></div>'
    +'<div class="hbar-row"><div class="hbar-label"><span class="hl-name">收入</span><span class="hl-val" style="color:var(--acc)">+NT$ '+fmt(d.total_income)+'</span></div><div class="hbar-track"><div class="hbar-fill" style="width:'+(d.total_income/maxV*100).toFixed(1)+'%;background:var(--acc)"></div></div></div>'
    +'<div class="rpt-divider"></div><div class="rpt-total"><span class="rt-lbl">總計結餘</span><span class="rt-val" style="color:'+nc+'">'+(net>=0?'+':'')+'NT$ '+fmt(Math.abs(net))+'</span></div>';
  var cf=flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]);
  var topCats=S.cfg.categories&&S.cfg.categories.expense||[];
  // 將 cat_breakdown 聚合到大類別（包含子類別金額加總）
  var bd=d.cat_breakdown||{};
  var topMap={};
  topCats.forEach(function(top){
    var ids=[top.id].concat((top.children||[]).map(function(c){return c.id;}));
    var sum=ids.reduce(function(a,cid){return a+(bd[cid]||0);},0);
    if(sum>0) topMap[top.id]=sum;
  });
  // 也加入沒有大類別對應的
  Object.entries(bd).forEach(function(e){
    var cid=e[0],v=e[1];
    var isChild=topCats.some(function(top){return (top.children||[]).some(function(c){return c.id===cid;});});
    if(!isChild&&!topMap[cid]) topMap[cid]=v;
  });
  var ce=Object.entries(topMap).sort(function(a,b){return b[1]-a[1];}).slice(0,3);
  var allTotal=Object.values(topMap).reduce(function(a,b){return a+b;},0)||1;
  // 計算每個類別的筆數（從 records）
  var catCountMap={};
  (d.records||[]).forEach(function(r){
    if(r.type!=='expense') return;
    var items=r.items&&r.items.length?r.items:[{category:r.category}];
    items.forEach(function(it){
      var cid=it.category||r.category;
      if(cid) catCountMap[cid]=(catCountMap[cid]||0)+1;
    });
  });
  var coe=document.getElementById('rv-ov-cat');
  if(ce.length){
    // 3 個獨立環形圖（SVG 進度環）
    var rings=ce.map(function(e,i){
      var cid=e[0],v=e[1];
      var c=cf.find(function(x){return x.id===cid;})||{name:cid,color:pal[i]};
      var pct=(v/allTotal*100);
      var color=c.color||pal[i];
      // SVG 環形參數
      var R=38, stroke=7, cx2=45, cy2=45, size=90;
      var circ=2*Math.PI*R;
      var dash=(pct/100*circ).toFixed(2);
      var gap=(circ-dash).toFixed(2);
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1">'
        +'<div style="position:relative;width:'+size+'px;height:'+size+'px">'
        +'<svg width="'+size+'" height="'+size+'" style="transform:rotate(-90deg)">'
        // 背景環
        +'<circle cx="'+cx2+'" cy="'+cy2+'" r="'+R+'" fill="none" stroke="'+color+'22" stroke-width="'+stroke+'"/>'
        // 進度環
        +'<circle cx="'+cx2+'" cy="'+cy2+'" r="'+R+'" fill="none" stroke="'+color+'" stroke-width="'+stroke+'"'
        +' stroke-dasharray="'+dash+' '+gap+'" stroke-linecap="round"/>'
        +'</svg>'
        // 中心百分比
        +'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:var(--t2)">'+pct.toFixed(1)+'%</div>'
        +'</div>'
        +'<div style="text-align:center"><div style="font-size:13px;color:var(--t1)">'+c.name+'</div>'
        +'<div style="font-size:13px;color:var(--red);font-family:var(--mono)">$'+fmt(v)+'</div>'
        +'</div>'
        +'</div>';
    }).join('');
    coe.innerHTML='<div class="rpt-section-title">類別</div>'
      +'<div style="display:flex;justify-content:space-around;align-items:flex-start;padding:4px 0">'+rings+'</div>';
  }else{coe.innerHTML='<div class="rpt-section-title">類別</div><div class="empty-tip" style="padding:12px 0">尚無資料</div>';}
  var t3=((d.records||[]).filter(function(r){return r.type==='expense';}).sort(function(a,b){return b.amount-a.amount;})).slice(0,3);
  document.getElementById('rv-ov-top3').innerHTML='<div class="rpt-section-title">TOP 3</div>'
    +(t3.length?t3.map(function(r,i){var fid=r.items&&r.items[0]&&r.items[0].category;var c=cf.find(function(x){return x.id===fid;})||cf.find(function(x){return x.id===r.category;})||{name:r.category,color:'#8B909A'};
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><div style="display:flex;align-items:center;gap:10px"><span style="width:22px;height:22px;border-radius:50%;background:'+(c.color||'#8B909A')+';display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0">'+(i+1)+'</span><div><div style="font-weight:500">'+c.name+'</div><div style="font-size:11px;color:var(--t3)">'+r.date+(r.note?' · '+r.note:'')+'</div></div></div><span style="font-family:var(--mono);color:var(--red)">-'+fmt(r.amount)+'</span></div>';
    }).join(''):'<div class="empty-tip" style="padding:12px 0">尚無資料</div>');
  var me=Object.entries(d.merchant_breakdown||{}).sort(function(a,b){return b[1].total-a[1].total;}).slice(0,3);
  document.getElementById('rv-ov-mer').innerHTML='<div class="rpt-section-title">商家</div>'
    +(me.length?me.map(function(e){var mid=e[0],ev=e[1];var mr=(S.cfg.merchants||[]).find(function(m){return m.id===mid;});
      return '<div class="mer-row"><div style="font-weight:500">'+(mr&&mr.name||mid)+' <span style="color:var(--t3);font-size:12px;font-weight:400">( '+ev.count+' )</span></div><div class="mv">-'+fmt(ev.total)+'</div></div>';
    }).join(''):'<div class="empty-tip" style="padding:12px 0">尚無資料</div>');
  function renderCatReport(drillParent){
    var ii=S.rptCatType==='income';
    var topCats2=S.cfg.categories&&S.cfg.categories[ii?'income':'expense']||[];
    var bd2=ii?(d.inc_breakdown||{}):(d.cat_breakdown||{});
    var lb=[],vl=[],cl=[],ic=[],cnt=[],catObjs=[];
    if(!drillParent){
      // 大類別模式
      topCats2.forEach(function(top,i){
        var ids=[top.id].concat((top.children||[]).map(function(c){return c.id;}));
        var sum=ids.reduce(function(a,cid){return a+(bd2[cid]||0);},0);
        if(sum<=0) return;
        lb.push(top.name); vl.push(sum);
        cl.push(top.color||pal[i%pal.length]);
        ic.push(top.icon||null);
        cnt.push(ids.reduce(function(a,cid){return a+(catCountMap[cid]||0);},0));
        catObjs.push(top);
      });
    } else {
      // 細分類模式（drillParent 是大類別物件）
      var children=drillParent.children||[];
      // 如果大類別本身也有紀錄，加進去
      if(bd2[drillParent.id]){
        lb.push(drillParent.name+'(本身)'); vl.push(bd2[drillParent.id]);
        cl.push(drillParent.color||'#8B909A'); ic.push(drillParent.icon||null);
        cnt.push(catCountMap[drillParent.id]||0); catObjs.push(drillParent);
      }
      children.forEach(function(c,i){
        var v=bd2[c.id]||0; if(!v) return;
        lb.push(c.name); vl.push(v);
        cl.push(c.color||pal[i%pal.length]); ic.push(c.icon||null);
        cnt.push(catCountMap[c.id]||0); catObjs.push(c);
      });
    }
    if(S.pieChart){S.pieChart.destroy();S.pieChart=null;}
    var ce2=document.getElementById('rv-cat');
    var totalAmt=vl.reduce(function(a,b){return a+b;},0);
    ce2.innerHTML='<div class="cat-toggle"><button class="cat-toggle-btn'+(S.rptCatType==='expense'?' on':'')+'" data-type="expense">支出</button><button class="cat-toggle-btn'+(S.rptCatType==='income'?' on':'')+'" data-type="income">收入</button></div>'
      +'<div style="position:relative;width:260px;height:260px;margin:0 auto 14px;overflow:visible"><canvas id="pie-chart"></canvas>'
      // 中心顯示總金額
      +'<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">'
      +'<div style="font-size:11px;color:var(--t3);margin-bottom:2px">'+(ii?'收入':'支出')+'</div>'
      +'<div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--t1)">'+fmt(totalAmt)+'</div>'
      +'</div></div>'
      +'<div id="cat-table"></div>';
    ce2.querySelectorAll('.cat-toggle-btn').forEach(function(b){b.addEventListener('click',function(){S.rptCatType=b.dataset.type;renderCatReport();});});
    var cx=document.getElementById('pie-chart').getContext('2d');
    S.pieChart=new Chart(cx,{type:'doughnut',data:{labels:vl.length?lb:['無資料'],datasets:[{data:vl.length?vl:[1],backgroundColor:vl.length?cl:['#e0e0e0'],borderWidth:vl.length?2:0,borderColor:'#fff'}]},
      options:{responsive:true,maintainAspectRatio:false,
        layout:{padding:{top:36,bottom:36,left:48,right:48}},cutout:'60%',
        plugins:{legend:{display:false},datalabels:{color:'#111',anchor:'end',align:'end',offset:18,clamp:false,clip:false,
          backgroundColor:'rgba(255,255,255,0.92)',borderColor:'rgba(0,0,0,0.08)',borderWidth:1,borderRadius:6,
          formatter:function(v,c){
            if(!vl.length) return '';
            var s=c.chart.data.datasets[0].data.reduce(function(a,b){return a+b;},0);
            if(!s) return '';
            var lbl=c.chart.data.labels[c.dataIndex];
            if(!lbl||lbl==='無資料') return '';
            return lbl+'\n'+(v/s*100).toFixed(1)+'%';
          },
          font:{weight:'600',size:10},padding:5,display:function(c){return vl.length>0&&c.dataset.data[c.dataIndex]>0;}}},
        animation:{duration:vl.length?500:0}}});
    setTimeout(function(){if(S.pieChart){S.pieChart.resize();S.pieChart.update();}},50);
    var ts=vl.reduce(function(a,b){return a+b;},0)||1;
    var tableEl=document.getElementById('cat-table');
    if(!vl.length){ tableEl.innerHTML='<div class="empty-tip">尚無資料</div>'; }
    else {
      tableEl.innerHTML='';
      var ts2=vl.reduce(function(a,b){return a+b;},0)||1;
      // 若是細分類模式，加返回按鈕
      if(drillParent){
        var backRow=document.createElement('div');
        backRow.style.cssText='display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--blue);font-weight:500;';
        backRow.innerHTML='◀ 返回大類別';
        backRow.addEventListener('click',function(){renderCatReport(null);});
        tableEl.appendChild(backRow);
        // 顯示大類別名稱
        var titleRow=document.createElement('div');
        titleRow.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 0 12px;font-size:14px;font-weight:700;color:var(--t1);';
        var ih0=drillParent.icon?'<img src="'+resolveIconUrl(drillParent.icon)+'" style="width:24px;height:24px;border-radius:5px;object-fit:cover;">':'<span style="width:12px;height:12px;border-radius:50%;background:'+(drillParent.color||'#8B909A')+';display:inline-block;margin-right:4px;"></span>';
        titleRow.innerHTML=ih0+'<span style="display:inline-flex;align-items:center;padding:3px 12px;border-radius:999px;font-size:14px;font-weight:700;color:#fff;background:'+(drillParent.color||'#8B909A')+'">'+drillParent.name+'</span>'+'<span style="font-size:13px;color:var(--t3);font-weight:400;margin-left:6px">細分類</span>';
        tableEl.appendChild(titleRow);
      }
      vl.forEach(function(v,i){
        var p=(v/ts2*100).toFixed(1);
        var ac=ii?'var(--acc)':'var(--red)';
        var ih=ic[i]?'<img src="'+resolveIconUrl(ic[i])+'" style="width:22px;height:22px;border-radius:6px;margin-right:8px;object-fit:cover">':'<span class="cat-table-dot" style="background:'+cl[i]+'"></span>';
        var countBadge=cnt[i]?'<span style="color:var(--t3);font-size:11px;margin-left:4px">( '+cnt[i]+' )</span>':'';
        var hasChildren=!drillParent&&catObjs[i]&&(catObjs[i].children||[]).length>0;
        var arrow=hasChildren?'<span style="color:var(--t3);font-size:12px;margin-left:auto;padding-left:8px;">›</span>':'';
        var row=document.createElement('div');
        row.className='cat-table-row';
        if(hasChildren) row.style.cursor='pointer';
        row.innerHTML=ih+'<span class="cat-table-label">'+lb[i]+countBadge+'</span>'+arrow+'<span class="cat-table-val" style="color:'+ac+'">'+fmt(v)+' ('+p+'%)</span>';
        if(hasChildren){
          row.addEventListener('click',function(){renderCatReport(catObjs[i]);});
        }
        tableEl.appendChild(row);
      });
    }
  }
  renderCatReport(null);
  var mb=d.merchant_breakdown||{};var mH='';
  if(!Object.keys(mb).length)mH='<div class="empty-tip">尚無商家記錄</div>';
  else Object.entries(mb).sort(function(a,b){return b[1].total-a[1].total;}).forEach(function(e){var mid=e[0],ev=e[1];var mr=(S.cfg.merchants||[]).find(function(m){return m.id===mid;});mH+='<div class="mer-row"><div>'+(mr&&mr.name||mid)+' <span style="color:var(--t3);font-size:12px">( '+ev.count+' )</span></div><div class="mv">-'+fmt(ev.total)+'</div></div>';});
  document.getElementById('rv-merchant').innerHTML=mH;
}
async function renderYearlyReport(){
  var y=S.rptY;
  document.getElementById('rpt-yr-label').textContent=y+' 年';
  var ms=await Promise.all(Array.from({length:12},function(_,i){return api('/api/report?year='+y+'&month='+(i+1));}));
  var ex=ms.map(function(m){return m.total_expense;}),ic=ms.map(function(m){return m.total_income;});
  var el=document.getElementById('rv-yearly');
  el.innerHTML='<div style="position:relative;height:220px;overflow:visible"><canvas id="yr-bar"></canvas></div>'
    +'<div style="display:flex;justify-content:center;gap:16px;font-size:12px;margin-top:8px"><span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:var(--red);display:inline-block"></span>支出</span><span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:var(--acc);display:inline-block"></span>收入</span></div>'
    +'<div class="rpt-divider" style="margin-top:10px"></div>'
    +'<div class="rpt-total"><span class="rt-lbl">全年支出</span><span class="rt-val" style="color:var(--red)">-NT$ '+fmt(ex.reduce(function(a,b){return a+b;},0))+'</span></div>'
    +'<div class="rpt-total" style="margin-top:6px"><span class="rt-lbl">全年收入</span><span class="rt-val" style="color:var(--acc)">+NT$ '+fmt(ic.reduce(function(a,b){return a+b;},0))+'</span></div>';
  if(S.yrBarChart){S.yrBarChart.destroy();S.yrBarChart=null;}
  S.yrBarChart=new Chart(document.getElementById('yr-bar').getContext('2d'),{type:'bar',
    data:{labels:['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
      datasets:[{label:'支出',data:ex,backgroundColor:'rgba(220,38,38,0.75)',borderRadius:4},{label:'收入',data:ic,backgroundColor:'rgba(22,163,74,0.75)',borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},datalabels:{display:false}},
      scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{ticks:{font:{size:10},callback:function(v){return v>=1000?Math.round(v/1000)+'k':v;}},grid:{color:'rgba(0,0,0,0.05)'}}}}});
}
document.querySelectorAll('#rpt-big-tabs .rpt-tab[data-bigv]').forEach(function(t){t.addEventListener('click',function(){
  document.querySelectorAll('#rpt-big-tabs .rpt-tab').forEach(function(x){x.classList.remove('on');}); t.classList.add('on');
  var v=t.dataset.bigv;
  document.getElementById('rpt-monthly').style.display=v==='monthly'?'':'none';
  document.getElementById('rpt-yearly').style.display=v==='yearly'?'':'none';
  if(v==='yearly') renderYearlyReport();
});});
document.querySelectorAll('#rpt-small-tabs .rpt-tab[data-rv]').forEach(function(t){t.addEventListener('click',function(){
  document.querySelectorAll('#rpt-small-tabs .rpt-tab').forEach(function(x){x.classList.remove('on');}); t.classList.add('on'); S.rptView=t.dataset.rv;
  document.getElementById('rv-overview-wrap').style.display=S.rptView==='overview'?'':'none';
  ['cat','merchant','trend'].forEach(function(v){document.getElementById('rv-'+v).style.display=v===S.rptView?'':'none';});
  if(S.rptView==='cat'&&S.pieChart){S.pieChart.resize();S.pieChart.update();}
  if(S.rptView==='trend') renderTrendChart();
});});
document.getElementById('rpt-prev').addEventListener('click',function(){S.rptM--;if(S.rptM<1){S.rptM=12;S.rptY--;}renderReport();});
document.getElementById('rpt-next').addEventListener('click',function(){S.rptM++;if(S.rptM>12){S.rptM=1;S.rptY++;}renderReport();});
document.getElementById('rpt-yr-prev').addEventListener('click',function(){S.rptY--;renderYearlyReport();});
document.getElementById('rpt-yr-next').addEventListener('click',function(){S.rptY++;renderYearlyReport();});

/* ══════════════════════════════════════════════
   新增記錄
══════════════════════════════════════════════ */
/* 日期 badge */
function syncDateBadge(dateVal, timeVal){
  var dv=dateVal!==undefined ? dateVal : document.getElementById('f-date').value;
  var tv=timeVal!==undefined ? timeVal : document.getElementById('f-time').value;
  var bd=document.getElementById('dbdtxt');
  var bt=document.getElementById('dbttxt');
  if(bd){if(dv){var p=dv.split('-'),dw=['日','一','二','三','四','五','六'][new Date(dv+'T00:00:00').getDay()];bd.textContent=parseInt(p[1])+'月'+parseInt(p[2])+'日（'+dw+'）';}else bd.textContent='—';}
  if(bt)bt.textContent=tv||'—';
  // 設定隱藏 input 值
  var fd=document.getElementById('f-date');
  var ft=document.getElementById('f-time');
  if(fd&&dv&&dateVal!==undefined) fd.value=dv;
  if(ft&&tv&&timeVal!==undefined) ft.value=tv;
  // 同步可見的 input
  var fdv=document.getElementById('f-date-vis');
  var ftv=document.getElementById('f-time-vis');
  if(fdv&&dv) fdv.value=dv;
  if(ftv&&tv) ftv.value=tv;
  if(fd&&!fd._sb){fd._sb=1;fd.addEventListener('change',function(){syncDateBadge();});}
  if(ft&&!ft._sb){ft._sb=1;ft.addEventListener('change',function(){syncDateBadge();});}
}

/* ══════════════════════════════════════════════
   新增記錄頁 - 存錢筒模式專用調整
   【本次修改】：存錢筒頁面完全隱藏「記帳項目」欄
══════════════════════════════════════════════ */
function openAddPage(record=null){
  // track editing record
  if(record){
    S.editRec = record;
  } else {
    S.editRec = null;
  }
  // optional record for editing
  if(record){
    S.addType=record.type||'expense';
    if(S.addType==='transfer'){
      S.transferCat = record.category||'deposit';
    }
    // prepare items
    if(S.addType==='transfer'){
      S.addItems = (record.items||[]).map(it=>({from:it.from||'',to:it.to||'',amount:it.amount||0}));
    } else if(S.addType==='adjust'){
      S.addItems = (record.items||[]).map(it=>({amount:it.amount||0}));
    } else {
      S.addItems = (record.items||[]).map(it=>({
        qty:it.qty||'1',price:it.price||'',note:it.note||'',category:it.category||'',
        categoryName: (S.cfg.categories[S.addType]||[]).flatMap(c=>[c].concat(c.children||[])).find(x=>x.id===it.category)?.name||''
      }));
    }
    S.selCat=record.items&&record.items[0]?record.items[0].category:'';
  } else {
    S.addType='expense'; S.addItems=[{qty:'1',price:'',note:'',category:'',categoryName:''}]; S.selCat='';
    _selPiggy=null;
  }
  document.querySelectorAll('.type-tab[data-t]').forEach(t=>
    t.className='type-tab'+(t.dataset.t===S.addType?` on ${S.addType}`:''));
  fillAddSelects(S.addType);
  renderTransferTypes();
  renderModalCats(S.addType);
  document.getElementById('cat-section').style.display='none';
  // apply new layout visibility應用新的版面可見性

  // 【新增】存錢筒 / 轉帳模式時隱藏記帳項目欄
  document.querySelectorAll('.items-section').forEach(el=>{
    el.style.display = (S.addType==='piggy') ? 'none' : '';
  });

  applyTypeLayout(S.addType); // 【統一版面邏輯】
  // date/time/note
  if(record){
    document.getElementById('f-date').value=record.date||todayStr();
    document.getElementById('f-time').value=record.time||nowTime();
    document.getElementById('f-note').value=record.note||'';
    document.getElementById('f-acc').value=record.account||'';
    const _toAccEl = document.getElementById('f-to-acc');
    if(_toAccEl) _toAccEl.value=record.to_account||'';
    document.getElementById('f-mer').value=record.merchant||'';
    const _expEl = document.getElementById('f-exp');
    if(_expEl) _expEl.value=record.expert||'';
    // 轉帳備註
    const _ftn=document.getElementById('f-transfer-note');
    if(_ftn) _ftn.value=record.note||'';
  } else {
    document.getElementById('f-date').value=S.selDate||todayStr();
    document.getElementById('f-time').value=nowTime();
    document.getElementById('f-note').value='';
    const _ftn=document.getElementById('f-transfer-note');
    if(_ftn) _ftn.value='';
  }
  // 轉帳備註欄位顯示控制
  const _transferNoteRow=document.getElementById('transfer-note-row');
  if(_transferNoteRow) _transferNoteRow.style.display=(S.addType==='transfer')?'':'none';
  document.getElementById('info-body').classList.remove('open');
  document.getElementById('info-toggle').classList.remove('open');
  renderPiggyTypeSection();
  renderAddItems(); calcTotal();
  // 直接傳值給 syncDateBadge，不靠讀取 input
  var _d=record?(record.date||todayStr()):(S.selDate||todayStr());
  var _t=record?(record.time||nowTime()):nowTime();
  syncDateBadge(_d, _t);
  openOverlay('add-page');
}

function renderTransferTypes(){
  const container=document.getElementById('transfer-type');
  const grid=document.getElementById('transfer-type-grid');
  if(S.addType!=='transfer'){
    container.style.display='none';
    return;
  }
  container.style.display='block';
  let types = S.cfg.categories?.transfer || [];
  if(!types.length){
    types=[
      {id:'deposit',name:'存款',color:'#2ECC8F',icon:'/icon/轉帳/存款.png'},
      {id:'withdraw',name:'提款',color:'#FF5F6D',icon:'/icon/轉帳/提款.png'},
      {id:'transfer',name:'轉帳',color:'#4CC9F0',icon:'/icon/轉帳/轉帳.png'},
    ];
  }
  // default selection
  if(!S.transferCat && types.length) S.transferCat=types[0].id;
  grid.innerHTML='';
  types.forEach(t=>{
    const chip=document.createElement('div');
    chip.className='cat-chip'+(S.transferCat===t.id? ' on':'');
    chip.style.borderColor=t.color||'';
    chip.style.color=t.color||'';
    chip.style.background = t.color ? `${t.color}22` : '';
    const iconHtml=t.icon?`<img src="${resolveIconUrl(t.icon)}" style="width:20px;height:20px;object-fit:contain;margin-right:4px;vertical-align:middle;">`:'';
    chip.innerHTML=iconHtml+`<span>${t.name}</span>`;
    chip.addEventListener('click',()=>{
      S.transferCat=t.id;
      grid.querySelectorAll('.cat-chip').forEach(c=>c.classList.remove('on'));
      chip.classList.add('on');
    });
    grid.appendChild(chip);
  });
}

/* 分類格格 */
function renderModalCats(type, parent){
  // keep track of the type we're currently browsing/adding to
  S.subCatType = type;
  // 如果是轉帳型別，強制使用三個固定子類別
  if(type==='transfer' && !parent){
    const fixed=[
      {id:'deposit',name:'存款',color:'#2ECC8F',icon:'/icon/轉帳/存款.png'},
      {id:'withdraw',name:'提款',color:'#FF5F6D',icon:'/icon/轉帳/提款.png'},
      {id:'transfer',name:'轉帳',color:'#4CC9F0',icon:'/icon/轉帳/轉帳.png'},
    ];
    S.cfg.categories.transfer=fixed; // 保證後續也有資料
  }

  const cats=(parent&&parent.children)?parent.children:(S.cfg.categories[type]||[]);
  const grid=document.getElementById('modal-cat-grid');
  grid.innerHTML='';

  // 如果有上層，加入返回按鈕（只有當該層確實有子分類時才顯示）
  if(parent && parent.children && parent.children.length){
    const back=document.createElement('div'); back.className='cat-chip';
    back.innerHTML='<span>◀ 返回</span>';
    back.addEventListener('click',()=>renderModalCats(type));
    grid.appendChild(back);
  }

  cats.forEach(c=>{
    const chip=document.createElement('div'); chip.className='cat-chip';
    chip.dataset.id=c.id;
    chip.style.setProperty('--chip-c', c.color||'#8B909A');
    const iconHtml = c.icon ? `<img class="cat-icon" src="${c.icon}" alt="${c.name}" />` : '';
    chip.innerHTML=`${iconHtml}<span>${c.name}</span>`;
    chip.addEventListener('click',()=>{
      if(c.children&&c.children.length){
        renderModalCats(type,c);
        return;
      }
      // if selecting for a specific item, assign there
      if(S.selItemForCat!==null && S.addItems[S.selItemForCat]){
        const idx=S.selItemForCat;
        S.addItems[idx].category=c.id;
        S.addItems[idx].categoryName=c.name;
        S.selItemForCat=null;
        renderAddItems();
        // 【修正 Bug 3a】分類改變後立即刷新備註標籤
        renderItemNoteTags(idx);
        document.getElementById('cat-section').style.display='none';
        return;
      }
      S.selCat=c.id;
      grid.querySelectorAll('.cat-chip').forEach(ch=>{
        ch.className='cat-chip'; ch.style.borderColor=''; ch.style.background=''; ch.style.color='';
      });
      chip.classList.add(`on-${type}`);
      document.getElementById('cat-section').style.display='none';
    });
    grid.appendChild(chip);
  });
  // always provide add button at end
  const addChip=document.createElement('div'); addChip.className='cat-chip';
  addChip.innerHTML='<span>＋ 新增</span>';
  addChip.addEventListener('click',()=>{
    S.catParentForAdd = parent || null;
    document.getElementById('ncat-name').value='';
    document.getElementById('ncat-color').value='#8B909A';
    initCatPalette();
    document.getElementById('add-cat-overlay').classList.add('show');
  });
  grid.appendChild(addChip);
  // 若已選的分類在新類型中存在，自動標記
  if(S.selCat){
    const existing=grid.querySelector(`[data-id="${S.selCat}"]`);
    if(existing) existing.classList.add(`on-${type}`);
    else S.selCat='';
  }
}

// 存錢筒選擇器（新增記錄頁）
let _selPiggy=null; // 選中的存錢筒 index

/* ── 統一版面顯示邏輯（Items 3-8 全面整合）────────────────── */
function applyTypeLayout(type){
  const get = id => document.getElementById(id);
  const show = (id,v) => { const el=get(id); if(el) el.style.display=v?'':'none'; };

  // 所有欄位先全關
  show('standalone-acc',    false);
  show('standalone-mer',    false);
  show('standalone-exp',    false);  // 【新增】專案獨立欄
  show('standalone-to-acc', false);  // 【新增】轉入帳戶獨立欄
  show('piggy-note-row',    false);
  show('transfer-note-row', false);
  show('total-disp',        false);
  show('info-section',      false);  // 永久隱藏「其他資訊」摺疊欄
  show('cat-section',       false);

  // items-section：除存錢筒外都顯示
  document.querySelectorAll('.items-section').forEach(el=>{
    el.style.display = (type==='piggy') ? 'none' : '';
  });
  get('add-item-btn').style.display = (type==='expense') ? 'block' : 'none';

  if(type==='transfer'){
    // 【Item 6】轉帳：items-list 渲染轉出/轉入/金額，只顯示備註欄
    show('transfer-note-row', true);
    // total-disp 隱藏（改用 items-list 內的金額欄）
  } else if(type==='adjust'){
    // 【Item 7】調整：items-list 渲染帳戶+金額（帳戶在最上方）
    // total-disp 隱藏
  } else if(type==='piggy'){
    show('piggy-note-row', true);
    // total-disp 隱藏
  } else if(type==='income'){
    // 【Item 5】收入
    show('standalone-acc', true);
    show('standalone-mer', true);
    show('standalone-exp', true);  // 專案移出至商家下方
    show('total-disp',     true);
  } else {
    // 【Item 4】支出
    show('standalone-acc', true);
    show('standalone-mer', true);
    show('standalone-exp', true);  // 專案移出至商家下方
    show('total-disp',     true);
  }
}

function fillAddSelects(type){
  const ao=(S.cfg.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  const fAccEl=document.getElementById('f-acc');
  fAccEl.innerHTML=ao;
  fAccEl.onchange = ()=>{ if(S.addType==='adjust') renderAddItems(); };
  document.getElementById('f-to-acc').innerHTML=ao;

  // merchant label + field type handling
  const merLabel=document.querySelector('#standalone-mer .fg label');
  if(merLabel) merLabel.textContent=(type==='income')?'收入來源':'商家';
  let merEl=document.getElementById('f-mer');
  if(type==='income'){
    if(merEl&&merEl.tagName==='SELECT'){
      const inp=document.createElement('input');
      inp.type='text'; inp.className='finp'; inp.id='f-mer'; inp.placeholder='選填';
      merEl.replaceWith(inp);
    }
  } else {
    if(merEl&&merEl.tagName==='INPUT'){
      const sel=document.createElement('select');
      sel.className='fsel'; sel.id='f-mer';
      merEl.replaceWith(sel);
      merEl=document.getElementById('f-mer');
    }
    if(merEl) merEl.innerHTML='<option value="">（不指定）</option>'+(S.cfg.merchants||[]).map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  }
  // 更新 standalone-exp 的 f-exp 選項（已移出 info-section）
  const expEl=document.getElementById('f-exp');
  if(expEl&&expEl.tagName==='SELECT'){
    expEl.innerHTML='<option value="">（不指定）</option>'+(S.cfg.experts||[]).map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  }
  // 更新 standalone-to-acc 的 f-to-acc 選項（轉帳時直接在 items-list 渲染，此行備援）
  const toAccEl=document.getElementById('f-to-acc');
  if(toAccEl&&toAccEl.tagName==='SELECT'){
    const ao2=(S.cfg.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    toAccEl.innerHTML=ao2;
  }
}

document.getElementById('info-toggle').addEventListener('click',()=>{
  document.getElementById('info-body').classList.toggle('open');
  document.getElementById('info-toggle').classList.toggle('open');
});
document.querySelectorAll('.type-tab[data-t]').forEach(t=>t.addEventListener('click',()=>{
  S.addType=t.dataset.t;
  document.querySelectorAll('.type-tab[data-t]').forEach(x=>x.className='type-tab');
  t.classList.add('on',t.dataset.t);
  S.selCat=''; _selPiggy=null;
  var _par=document.getElementById('piggy-amount-row'); if(_par) _par.remove();
  if(S.addType==='transfer') S.addItems=[{from:'',to:'',amount:0}];
  else if(S.addType==='adjust') S.addItems=[{amount:''}];
  else S.addItems=[{qty:'1',price:'',note:'',category:'',categoryName:''}];
  // reset note
  const fNoteEl=document.getElementById('f-note'); if(fNoteEl) fNoteEl.value='';
  renderModalCats(S.addType);
  renderTransferTypes();
  renderPiggyTypeSection();
  fillAddSelects(S.addType);
  renderPiggyTypeSection();

  applyTypeLayout(S.addType); // 【統一版面邏輯】
  // 存錢筒時隱藏記帳項目欄；其餘顯示
  document.querySelectorAll('.items-section').forEach(el=>{
    el.style.display = (S.addType==='piggy') ? 'none' : '';
  });
  // 轉帳備註欄位顯示控制
  const _tnr=document.getElementById('transfer-note-row');
  if(_tnr) _tnr.style.display=(S.addType==='transfer')?'':'none';
  document.getElementById('cat-section').style.display='none';
  renderAddItems(); calcTotal();
}));

/* ══════════════════════════════════════════════
   renderAddItems（全面重寫，Items 3/4/5/6/7）
══════════════════════════════════════════════ */
function renderAddItems() {
  const list = document.getElementById('items-list');
  const addBtn = document.getElementById('add-item-btn');
  if (!list || !addBtn) return;
  addBtn.style.display = (S.addType === 'expense') ? 'block' : 'none';

  // ── 存錢筒：items-list 清空，由 piggy-type-section 負責 ──
  if (S.addType === 'piggy') { list.innerHTML = ''; return; }

  // ── 【Item 5】轉帳：轉出/轉入同一行 + 交換按鈕 ──
  if (S.addType === 'transfer') {
    const accOpts = (S.cfg.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    const it = S.addItems[0] || {};
    list.innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="display:flex;align-items:flex-end;gap:6px;">
          <div class="fg" style="flex:1;margin-bottom:0">
            <label style="font-size:11px;color:var(--t3);letter-spacing:.7px">轉出帳戶</label>
            <select class="fsel" id="transfer-from-sel">${accOpts}</select>
          </div>
          <!-- 交換按鈕 -->
          <button id="transfer-swap-btn" type="button"
            style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:var(--sf2);
                   border:1px solid var(--border);font-size:16px;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;margin-bottom:1px;
                   -webkit-tap-highlight-color:transparent;transition:.15s;"
            title="交換帳戶">⇄</button>
          <div class="fg" style="flex:1;margin-bottom:0">
            <label style="font-size:11px;color:var(--t3);letter-spacing:.7px">轉入帳戶</label>
            <select class="fsel" id="transfer-to-sel">${accOpts}</select>
          </div>
        </div>
      </div>
      <div class="fg">
        <label style="font-size:11px;color:var(--t3);letter-spacing:.7px">金額</label>
        <input type="number" class="finp" id="transfer-amt-inp" placeholder="0"
          inputmode="decimal" value="${it.amount||''}">
      </div>`;
    const fromSel = list.querySelector('#transfer-from-sel');
    const toSel   = list.querySelector('#transfer-to-sel');
    if(it.from) fromSel.value = it.from;
    if(it.to)   toSel.value   = it.to;
    fromSel.addEventListener('change',()=>{ S.addItems[0].from=fromSel.value; });
    toSel.addEventListener('change',  ()=>{ S.addItems[0].to=toSel.value; });
    list.querySelector('#transfer-amt-inp').addEventListener('input', e=>{
      S.addItems[0].amount=parseFloat(e.target.value)||0; calcTotal();
    });
    // 交換按鈕：互換兩個 select 的值
    list.querySelector('#transfer-swap-btn').addEventListener('click',()=>{
      const tmp = fromSel.value;
      fromSel.value = toSel.value;
      toSel.value = tmp;
      S.addItems[0].from = fromSel.value;
      S.addItems[0].to   = toSel.value;
    });
    return;
  }

  // ── 【Item 6】調整：帳戶在最上方，顯示目前餘額，換帳戶即時更新 ──
  if (S.addType === 'adjust') {
    const accs = S.cfg.accounts||[];
    const accOpts = accs.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    const it = S.addItems[0] || {};
    const curAcc = document.getElementById('f-acc')?.value || (accs[0]?.id||'');
    const curBal = accs.find(a=>a.id===curAcc)?.balance ?? '';
    list.innerHTML = `
      <div class="fg" style="margin-bottom:10px;">
        <label style="font-size:11px;color:var(--t3);letter-spacing:.7px">帳戶</label>
        <select class="fsel" id="adjust-acc-sel">${accOpts}</select>
      </div>
      <!-- 目前餘額提示 -->
      <div id="adjust-bal-row" style="margin-bottom:10px;padding:8px 12px;background:var(--sf2);
           border:1px solid var(--border);border-radius:var(--rs);font-size:13px;color:var(--t2);">
        目前餘額：<strong id="adjust-bal-disp" style="font-family:var(--mono);color:var(--t1);">
          NT$ ${fmt(curBal||0)}</strong>
      </div>
      <div class="fg">
        <label style="font-size:11px;color:var(--t3);letter-spacing:.7px">調整後金額</label>
        <input type="number" class="finp" id="adjust-amt-inp" placeholder="0"
          inputmode="decimal" value="${it.amount||''}">
      </div>`;
    const adjAcc = list.querySelector('#adjust-acc-sel');
    if(curAcc) adjAcc.value = curAcc;
    // 換帳戶 → 即時更新餘額顯示
    adjAcc.addEventListener('change',()=>{
      const fa = document.getElementById('f-acc');
      if(fa) fa.value = adjAcc.value;
      const selAcc = (S.cfg.accounts||[]).find(a=>a.id===adjAcc.value);
      const balDisp = document.getElementById('adjust-bal-disp');
      if(balDisp) balDisp.textContent = 'NT$ '+ fmt(selAcc?.balance??0);
    });
    list.querySelector('#adjust-amt-inp').addEventListener('input', e=>{
      S.addItems[0].amount = parseFloat(e.target.value)||0; calcTotal();
    });
    return;
  }

  // ── 支出 / 收入 ──
  list.innerHTML = '';
  const isMulti = S.addItems.length > 1;
  S.addItems.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const catName = it.categoryName || '分類';

    if (S.addType === 'income') {
      row.innerHTML = `
        <div style="flex:1.5;display:flex;flex-direction:column;gap:4px">
          <button class="cat-btn" data-i="${i}">${catName}</button>
          <input type="text" placeholder="備註" value="${it.note||''}" data-i="${i}" data-f="note" class="finp-s">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:2px;text-align:right">
          <span style="font-size:11px;color:var(--acc);font-weight:600">金額</span>
          <input type="number" placeholder="0" value="${it.price||''}" data-i="${i}" data-f="price"
            inputmode="decimal" style="width:100%;text-align:right;color:var(--acc);font-weight:bold">
        </div>`;
    } else {
      // 【Item 4】支出：數量(紫)、金額(橘)靠右；多項時隱藏備註標籤
      row.innerHTML = `
        <div style="flex:1.2;display:flex;flex-direction:column;gap:4px">
          <button class="cat-btn" data-i="${i}">${catName}</button>
          <input type="text" placeholder="備註" value="${it.note||''}" data-i="${i}" data-f="note" class="finp-s">
          <div id="item-note-tags-${i}" style="${isMulti?'display:none':'display:none'};flex-wrap:wrap;gap:4px;margin-top:2px;"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;align-items:center;flex:0.6">
          <span style="font-size:11px;color:#7C3AED;font-weight:600">數量</span>
          <input type="number" value="${it.qty||1}" data-i="${i}" data-f="qty"
            style="width:100%;text-align:center;font-size:14px">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1.2">
          <span style="font-size:11px;color:var(--orange);font-weight:600;text-align:right">金額</span>
          <input type="number" value="${it.price||''}" placeholder="0" data-i="${i}" data-f="price"
            style="width:100%;color:var(--acc);text-align:right">
        </div>
        ${isMulti ? `<button class="item-del" data-i="${i}">✕</button>` : ''}`;
    }
    list.appendChild(row);
    // 備註標籤：單項顯示，多項時隱藏以縮小框框
    if(S.addType === 'expense' && !isMulti) renderItemNoteTags(i);
  });

  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      const it = S.addItems[+inp.dataset.i];
      if(it) it[inp.dataset.f] = inp.value;
      calcTotal();
    });
  });
  list.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.selItemForCat = +btn.dataset.i;
      document.getElementById('cat-section').style.display = '';
      renderModalCats(S.addType);
    });
  });
  list.querySelectorAll('.item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      S.addItems.splice(+btn.dataset.i, 1);
      renderAddItems(); calcTotal();
    });
  });
}

// ── 初始化時強制修復導覽按鈕 ──
document.addEventListener('DOMContentLoaded', () => {
  const plusBtn = document.querySelector('.nav-item.add-btn');
  if (plusBtn) {
    plusBtn.addEventListener('click', () => {
      // 開啟新增頁面並初始化
      S.addType = 'expense';
      S.addItems = [{ note: '', qty: 1, price: '', categoryName: '分類' }];
      document.getElementById('add-page').classList.add('show');
      renderAddItems();
    });
  }
});

function calcTotal(){
  let t=0;
  if(S.addType==='transfer'){
    // 【Item 6】從 transfer-amt-inp 讀取
    const _ti = document.getElementById('transfer-amt-inp');
    t = _ti ? parseFloat(_ti.value)||0 : S.addItems.reduce((s,it)=>s+parseFloat(it.amount||0),0);
  } else if(S.addType==='adjust'){
    // 【Item 7】從 adjust-amt-inp 讀取
    const _ai = document.getElementById('adjust-amt-inp');
    t = _ai ? parseFloat(_ai.value)||0 : S.addItems.reduce((s,it)=>s+parseFloat(it.amount||0),0);
  } else if(S.addType==='income'){
    t=S.addItems.reduce((s,it)=>s+(parseFloat(it.qty)||1)*(parseFloat(it.price)||0),0);
  } else {
    t=S.addItems.reduce((s,it)=>s+(parseFloat(it.qty)||1)*(parseFloat(it.price)||0),0);
  }
  document.getElementById('total-val').textContent=fmt(t);
}
document.getElementById('add-item-btn').addEventListener('click',()=>{
  if(S.addType==='expense' || S.addType==='income'){
    if(S.addType==='income'){
      S.addItems.push({qty:'1',price:'',note:'',category:'',categoryName:''});
    } else {
      S.addItems.push({qty:'1',price:'',note:'',category:'',categoryName:''});
    }
    renderAddItems(); calcTotal();
  }
});
document.getElementById('add-cancel').addEventListener('click',()=>{
  document.getElementById('cat-section').style.display='none';
  closeOverlay('add-page');
});
// ══════════════════════════════════════════════
// 新增記錄確認按鈕（右上角 ✓）
// 已加入「紀錄新增中」1.5秒特效 + 原有儲存邏輯
// ══════════════════════════════════════════════
document.getElementById('add-confirm').addEventListener('click', async function(){
  // === 立即顯示「紀錄新增中」訊息框（1.5秒）===
  toast('紀錄新增中', 1500);

  // ── 以下為您原本的完整儲存邏輯（已完整保留） ──
  try{
    let total=0;
    // ── 存錢筒模式 ──
    if(S.addType==='piggy'){
      const amt=parseFloat(document.getElementById('piggy-amount-input')?.value||0);
      if(!amt||amt<=0){toast('請輸入存入金額');return;}
      if(_selPiggy===null){toast('請選擇存錢筒');return;}
      const piggies=advLoad('piggy');
      const pg=piggies[_selPiggy];
      if(!pg){toast('找不到存錢筒');return;}
      const note=document.getElementById('f-note').value||pg.name;
      const payload={
        type:'piggy', amount:amt, date:document.getElementById('f-date').value,
        time:document.getElementById('f-time').value, note,
        category:'piggy', account:(document.getElementById('piggy-acc-sel')||document.getElementById('f-acc')).value,
        items:[{qty:1,price:amt,note,category:'piggy'}],
        piggyId:_selPiggy, piggyName:pg.name
      };
      await api('/api/records',{method:'POST',body:JSON.stringify(payload)});
      pg.saved=(pg.saved||0)+amt;
      pg.logs=pg.logs||[];
      pg.logs.push({date:payload.date,amount:amt,note:payload.note});
      advSave('piggy',piggies);
      await renderHome(); await loadCfg();
      closeOverlay('add-page');
      toast('已存入「'+pg.name+'」NT$'+fmt(amt),3000);
      _selPiggy=null;
      return;
    }

    if(S.addType==='transfer'){
      // 【Item 6】從 items-list 的 transfer-from/to-sel 和 transfer-amt-inp 讀取
      const fromSel=document.getElementById('transfer-from-sel');
      const toSel=document.getElementById('transfer-to-sel');
      const amtInp=document.getElementById('transfer-amt-inp');
      if(fromSel) S.addItems[0].from=fromSel.value;
      if(toSel)   S.addItems[0].to=toSel.value;
      if(amtInp)  S.addItems[0].amount=parseFloat(amtInp.value)||0;
      total=S.addItems.reduce((s,it)=>s+parseFloat(it.amount||0),0);
      if(!total){ toast('請輸入金額'); return; }
      if(!S.transferCat){ toast('請選擇轉帳類別'); return; }
      for(const it of S.addItems){ if(!it.from||!it.to){toast('請選擇轉出與轉入帳戶'); return;} }
    } else if(S.addType==='adjust'){
      // 【Item 7】從 items-list 的 adjust-acc-sel 和 adjust-amt-inp 讀取
      const adjAcc=document.getElementById('adjust-acc-sel');
      const adjAmt=document.getElementById('adjust-amt-inp');
      if(adjAcc){ const fa=document.getElementById('f-acc'); if(fa) fa.value=adjAcc.value; }
      if(adjAmt) S.addItems[0].amount=parseFloat(adjAmt.value)||0;
      total = parseFloat(S.addItems[0]?.amount||0);
      if(isNaN(total)){ toast('請輸入金額'); return; }
      const accId=(document.getElementById('adjust-acc-sel')||document.getElementById('f-acc'))?.value;
      if(!accId){ toast('請選擇帳戶'); return; }
    } else {
      total=S.addItems.reduce((s,it)=>s+(parseFloat(it.qty)||1)*(parseFloat(it.price)||0),0);
      if(!total){ toast('請輸入金額'); return; }
      for(const it of S.addItems){ if(!it.category){ toast('請為每項選擇分類'); return; }}
    }

    let note=document.getElementById('f-note').value;
    if(S.addType==='transfer'){
      note=document.getElementById('f-transfer-note')?.value||'';
    }
    if(S.addType==='adjust' && !note){
      note=`調整後 NT$ ${fmt(total)}`;
    }

    const payload={
      type:S.addType,
      items: S.addItems.map(it=>{
        if(S.addType==='transfer') return {from:it.from,to:it.to,amount:parseFloat(it.amount||0),category:S.transferCat};
        if(S.addType==='adjust') return {amount:parseFloat(it.amount||0)};
        return {qty:parseFloat(it.qty)||1,price:parseFloat(it.price)||0,note:it.note,category:it.category};
      }),
      category:S.addType==='transfer'?S.transferCat:(S.addType==='adjust'?'adjust':(S.addItems[0]?.category||'')),
      account:S.addType==='transfer'?S.addItems[0]?.from||'':document.getElementById('f-acc').value,
      to_account:'',
      merchant:(S.addType==='transfer'||S.addType==='adjust'||S.addType==='piggy')?'':document.getElementById('f-mer').value,
      expert:(S.addType==='transfer'||S.addType==='adjust'||S.addType==='piggy')?'':document.getElementById('f-exp').value,
      date:document.getElementById('f-date').value,
      time:document.getElementById('f-time').value,
      note,
    };

    if(S.editRec && S.editRec.id){
      await api(`/api/records/${S.editRec.id}`,{method:'PUT',body:JSON.stringify(payload)});
      S.editRec=null;
    } else {
      await api('/api/records',{method:'POST',body:JSON.stringify(payload)});
    }

    if(S.addType==='adjust'){
      const accId = (document.getElementById('adjust-acc-sel')||document.getElementById('f-acc'))?.value || payload.account;
      await api(`/api/settings/accounts/${accId}`,{method:'PUT',body:JSON.stringify({balance:total})});
      await loadCfg();
    }

    document.getElementById('cat-section').style.display='none';

    if(_selPiggy!==null&&S.addType==='expense'){
      try{
        const piggies=advLoad('piggy');
        const pg=piggies[_selPiggy];
        if(pg){
          pg.saved=(pg.saved||0)+total;
          pg.logs=pg.logs||[];
          pg.logs.push({date:payload.date,amount:total,note:payload.note||''});
          advSave('piggy',piggies);
          toast('記錄成功 ✓，已存入「'+pg.name+'」',3000);
        }
      }catch(e){}
      _selPiggy=null;
    } else {
      toast('記錄成功 ✓');
    }

    closeOverlay('add-page');

    const [y,m]=payload.date.split('-').map(s=>parseInt(s,10));
    S.calY=y; S.calM=m;
    S.selDate=payload.date;
    await loadCfg();
    await renderHome();
    goPage('home');
    if(document.getElementById('page-accounts').classList.contains('active')) renderAccounts();

  }catch(e){
    console.error(e);
    toast('新增失敗：'+(e.message||e));
  }
});
document.getElementById('nav-plus').addEventListener('click',()=>openAddPage());

/* ══════════════════════════════════════════════
   設定子頁
══════════════════════════════════════════════ */
// 帳戶子頁：依分組顯示，各組可折疊
const SUB_META={
  categories:      {title:'類別',    hasTabs:true,  isAccGroup:false},
  merchants:       {title:'商家',    hasTabs:false, isAccGroup:false},
  experts:         {title:'專案',    hasTabs:false, isAccGroup:false},
  note_tags:       {title:'備註標籤',hasTabs:false, isAccGroup:false},
  account_groups:  {title:'帳戶分組',hasTabs:false, isAccGroup:false},
  accounts:        {title:'帳戶',    hasTabs:false, isAccGroup:false},
  accounts_bank:   {title:'銀行',    hasTabs:false, isAccGroup:true, gid:'bank_group'},
  accounts_epay:   {title:'電子支付',hasTabs:false, isAccGroup:true, gid:'epay_group'},
};

function openSubPage(key){
  // unify account views
  if(key==='accounts_bank' || key==='accounts_epay') key='accounts';
  S.subPageKey=key;
  const subAddBtn=document.getElementById('sub-add');
  if(subAddBtn) subAddBtn.disabled=false;
  if(key==='categories'){ S.subCatParent=null; S.subCatPath=[]; } // reset path whenever opening categories
  const meta=SUB_META[key];
  document.getElementById('sub-title').textContent=meta.title;
  document.getElementById('sub-cat-tabs').style.display=meta.hasTabs?'block':'none';
  if(meta.hasTabs){ S.subCatType='expense'; syncSubCatTabs(); }
  renderSubList();
  openOverlay('sub-page');
}

function syncSubCatTabs(){
  document.querySelectorAll('#sub-cat-tabs .type-tab[data-ct]').forEach(t=>{
    t.className='type-tab'+(t.dataset.ct===S.subCatType?' on '+S.subCatType:'');
  });
}
document.querySelectorAll('#sub-cat-tabs .type-tab[data-ct]').forEach(t=>t.addEventListener('click',()=>{
  S.subCatType=t.dataset.ct; syncSubCatTabs(); renderSubList();
}));

function renderSubList(){
  const el=document.getElementById('sub-list');
  el.innerHTML='';
  const meta=SUB_META[S.subPageKey];

  if(S.subPageKey==='account_groups'){
    const DEFAULT_GROUP_IDS=['cash','bank','epay'];
    ACC_GROUPS = (S.cfg.account_groups||ACC_GROUPS).map((g,i)=>{
      const preset=ACC_GROUPS.find(p=>p.id===g.id);
      return {id:g.id,name:g.name,color:preset?preset.color:'#cccccc'};
    });
    ACC_GROUPS.forEach(grp=>{
      const row=document.createElement('div'); row.className='sub-item-row';
      const isDefault=DEFAULT_GROUP_IDS.includes(grp.id);
      row.innerHTML=`<span class="sn">${grp.name}</span>`
        +(isDefault?'<span style="font-size:11px;color:var(--t3);padding:2px 8px">預設</span>'
          :`<button class="delbtn" data-id="${grp.id}">✕</button>`);
      el.appendChild(row);
    });
    el.querySelectorAll('.delbtn').forEach(btn=>btn.addEventListener('click',async()=>{
      const grp=ACC_GROUPS.find(g=>g.id===btn.dataset.id);
      if(!confirm(`確定刪除「${grp?.name||''}」分組？`)) return;
      await api(`/api/settings/account_groups/${encodeURIComponent(btn.dataset.id)}`,{method:'DELETE'});
      await loadCfg(); renderSubList(); toast('已刪除');
    }));
    return;
  }

  if(S.subPageKey==='accounts'){
    // show all groups with collapsible lists
    ACC_GROUPS.forEach(grp=>{
      const grpDiv=document.createElement('div'); grpDiv.className='sub-grp';
      const hdr=document.createElement('div'); hdr.className='sub-grp-hdr';
      hdr.innerHTML=`<span>${grp.name}</span><span class="sg-arrow">▼</span>`;
      const body=document.createElement('div'); body.className='sub-grp-body';
      const accs=(S.cfg.accounts||[]).filter(a=>a.group===grp.id);
      if(!accs.length){ body.innerHTML='<div class="empty-tip" style="padding:10px;font-size:13px;color:var(--t3)">尚無帳戶</div>'; }
      accs.forEach(it=>{
        const row=document.createElement('div'); row.className='sub-item-row';
        row.innerHTML=`<span class="sn">${it.name}</span><button class="delbtn" data-id="${it.id}">✕</button>`;
        // clicking row opens edit overlay
        row.addEventListener('click',e=>{
          if(e.target.closest('.delbtn')) return;
          S.editingAccId = it.id;
          document.getElementById('nacc-name').value=it.name;
          const sel=document.getElementById('nacc-group');
          sel.innerHTML = (S.cfg.account_groups||[]).map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
          sel.value = it.group;
          document.getElementById('nacc-balance').value=it.balance||0;
          document.getElementById('nacc-balance-date').value=it.balance_date||todayStr();
          document.getElementById('nacc-color').value=it.color||'#cccccc';
          S.newAccIcon = it.icon||null;
          document.getElementById('nacc-icon').value='';
          document.getElementById('nacc-icon-size').value = S.accIconPreviewSize;
          updateAccIconPreview();
          document.getElementById('nacc-ok').textContent='儲存';
          document.getElementById('add-acc-overlay').classList.add('show');
        });
        body.appendChild(row);
      });
      hdr.addEventListener('click',()=>{
        hdr.classList.toggle('open'); body.classList.toggle('open');
      });
      grpDiv.appendChild(hdr); grpDiv.appendChild(body);
      el.appendChild(grpDiv);
    });
    // bind delete handlers
    el.querySelectorAll('.delbtn').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('確定刪除？')) return;
      await api(`/api/settings/accounts/${encodeURIComponent(btn.dataset.id)}`,{method:'DELETE'});
      await loadCfg(); renderSubList(); toast('已刪除');
    }));
    return;
  }

  if(meta.isAccGroup){
    // 帳戶：篩選該分組
    const gid=meta.gid;
    const accs=(S.cfg.accounts||[]).filter(a=>a.group===gid);
    if(!accs.length){ el.innerHTML='<div class="empty-tip" style="padding:16px;color:var(--t3);font-size:13px">尚無帳戶</div>'; return; }
    accs.forEach(it=>{
      const row=document.createElement('div'); row.className='sub-item-row';
      row.innerHTML=`<span class="sn">${it.name}</span><button class="delbtn" data-id="${it.id}">✕</button>`;
      el.appendChild(row);
    });
  } else {
    // 一般列表，支援類別內層
    let items;
    const currentParent = S.subCatPath[S.subCatPath.length-1] || null;
  if(S.subPageKey==='categories'){
    items = currentParent ? currentParent.children || [] : S.cfg.categories[S.subCatType]||[];
  } else if(S.subPageKey==='note_tags'){
    items = S.cfg.note_tags||[];
  } else {
    items = (S.cfg[S.subPageKey]||[]);
  }
  // disable adding deeper than 2 layers
  if(S.subPageKey==='categories'){
    const addBtn=document.getElementById('sub-add');
    if(addBtn) addBtn.disabled = S.subCatPath.length>=2;
  }
  // 如果有父類別，顯示回上一層按鈕
  if(S.subPageKey==='categories' && S.subCatPath.length>0){
    const parentName=S.subCatPath[S.subCatPath.length-1]?.name||'';
    const parentColor=S.subCatPath[S.subCatPath.length-1]?.color||'#8B909A';
    const back=document.createElement('div'); back.className='sub-item-row';
    back.style.cursor='pointer';
    back.innerHTML='<span class="sn" style="display:flex;align-items:center;gap:8px">'
      +'◀ 返回'
      +'<span style="padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:'+parentColor+'">'+parentName+'</span>'
      +' 類別'
      +'</span>';
    back.addEventListener('click',()=>{
      S.subCatPath.pop();
      // 返回時恢復 tabs 和標題
      document.getElementById('sub-cat-tabs').style.display='block';
      document.getElementById('sub-title').textContent='類別';
      syncSubCatTabs();
      renderSubList();
    });
    el.appendChild(back);
  }
  // 若目前在某一父類別，但尚無子項，顯示提示
  if(S.subPageKey==='categories' && currentParent && items.length===0){
      const tip=document.createElement('div');
      tip.className='empty-tip';
      tip.style.padding='16px';
      tip.style.color='var(--t3)';
      tip.style.fontSize='13px';
      tip.textContent='尚無細分類';
      el.appendChild(tip);
    }
    items.forEach(it=>{
      const row=document.createElement('div'); row.className='sub-item-row';
      const dot = (S.subPageKey==='categories')
        ? (it.icon
            ? `<img src="${resolveIconUrl(it.icon)}" style="width:28px;height:28px;object-fit:cover;border-radius:6px;flex-shrink:0;">`
            : (it.color ? `<div style="width:28px;height:28px;border-radius:6px;background:${it.color};flex-shrink:0"></div>` : ''))
        : '';
      // ── 行內確認刪除（不依賴 confirm dialog）──
      function bindInlineDel(btn, delFn){
        let _state='idle'; // idle | confirming
        let _timer=null;
        function resetBtn(){
          _state='idle';
          clearTimeout(_timer);
          btn.textContent='✕';
          btn.style.cssText='width:32px;height:32px;border-radius:50%;background:var(--red-d);color:var(--red);border:none;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
        }
        function onTap(e){
          e.stopPropagation(); e.preventDefault();
          if(_state==='confirming'){
            _state='done'; // 防止 touchend 後緊接的 click 重複執行
            clearTimeout(_timer);
            btn.textContent='...';
            delFn();
            return;
          }
          if(_state==='done') return; // 忽略 touchend 後的 click
          _state='confirming';
          btn.textContent='確認刪除';
          btn.style.cssText='padding:6px 14px;border-radius:999px;background:#DC2626;color:#fff;border:none;font-size:13px;cursor:pointer;font-weight:600;min-height:32px;min-width:72px;';
          _timer=setTimeout(resetBtn, 3000);
        }
        // iOS：用 touchstart 設旗標，touchend 執行動作，阻止後續 click
        let _touched=false;
        btn.addEventListener('touchstart',()=>{ _touched=true; },{passive:true});
        btn.addEventListener('touchend', e=>{
          e.preventDefault(); // 阻止後續 click
          onTap(e);
        },{passive:false});
        btn.addEventListener('click', e=>{
          if(_touched){ _touched=false; return; } // iOS：已由 touchend 處理
          onTap(e);
        });
      }

      const _defTr=['deposit','withdraw','transfer'],_defIn=['salary','bonus','invest'];
      const _isDef=(S.subCatType==='transfer'&&_defTr.includes(it.id))||(S.subCatType==='income'&&_defIn.includes(it.id));
      if(S.subPageKey==='categories'){
        if(_isDef){
          row.innerHTML=dot+'<span class="sn">'+it.name+'</span><span class="arr">›</span><span style="font-size:11px;color:var(--t3);padding:2px 8px">預設</span>';
        } else {
          var _hasSubLayer=(S.subCatType==='expense');
          row.innerHTML=dot+'<span class="sn">'+it.name+'</span>'
            +(_hasSubLayer?'<span class="arr">›</span>':'')
            +'<span style="display:flex;gap:6px;align-items:center"><button class="editbtn">✎</button>'
            +'<button class="row-del-btn">✕</button></span>';
          bindInlineDel(row.querySelector('.row-del-btn'), async()=>{
            try{
              await api('/api/settings/categories/'+S.subCatType+'/'+encodeURIComponent(it.id),{method:'DELETE'});
              await loadCfg();
              function _fb(l,id){for(const c of l){if(c.id===id)return c;const f=_fb(c.children||[],id);if(f)return f;}return null;}
              S.subCatPath=S.subCatPath.map(p=>_fb(S.cfg.categories[S.subCatType]||[],p.id)||p);
              renderSubList(); toast('已刪除「'+it.name+'」');
            }catch(err){toast('刪除失敗：'+(err.message||err));}
          });
        }
      } else if(S.subPageKey==='note_tags'){
        const catLabel = it.category ? (()=>{
          const ac=flatAllCats(S.cfg.categories?.expense||[]);
          const c=ac.find(x=>x.id===it.category);
          return c?'<span style="font-size:10px;color:var(--blue);background:rgba(37,99,235,0.08);padding:1px 6px;border-radius:999px;margin-left:4px">'+c.name+'</span>':'';
        })():'';
        row.innerHTML=dot+'<span class="sn">'+it.name+catLabel+'</span><span style="display:flex;gap:6px;align-items:center">'
          +'<button class="sortbtn" data-dir="up" data-id="'+it.id+'">↑</button>'
          +'<button class="sortbtn" data-dir="down" data-id="'+it.id+'">↓</button>'
          +'<button class="row-del-btn">✕</button></span>';
        bindInlineDel(row.querySelector('.row-del-btn'), async()=>{
          try{
            await api('/api/settings/note_tags/'+encodeURIComponent(it.id),{method:'DELETE'});
            await loadCfg(); renderSubList(); toast('已刪除「'+it.name+'」');
          }catch(err){toast('刪除失敗：'+(err.message||err));}
        });
      } else {
        row.innerHTML=dot+'<span class="sn">'+it.name+'</span><button class="row-del-btn">✕</button>';
        bindInlineDel(row.querySelector('.row-del-btn'), async()=>{
          try{
            await api('/api/settings/'+S.subPageKey+'/'+encodeURIComponent(it.id),{method:'DELETE'});
            await loadCfg(); renderSubList(); toast('已刪除「'+it.name+'」');
            if(document.getElementById('page-accounts').classList.contains('active')) renderAccounts();
          }catch(err){toast('刪除失敗：'+(err.message||err));}
        });
      }
      // 點擊列可進入子類別（無論是否已有 children）
      if(S.subPageKey==='categories'){
        row.style.cursor='pointer';
        row.addEventListener('click',(e)=>{
          if(e.target.closest('.delbtn')||e.target.closest('.editbtn')) return;
          if(S.subCatPath.length>=1){
            toast('已達最深階層，無法再新增細分類');
            return;
          }
          // 收入/轉帳不進入子層
          if(S.subCatType==='income'||S.subCatType==='transfer') return;
          // 支出進入子層：隱藏 tabs，標題改父類別名
          S.subCatPath.push(it);
          document.getElementById('sub-cat-tabs').style.display='none';
          document.getElementById('sub-title').textContent=it.name+' （分類）';
          renderSubList();
        });
        const editBtn=row.querySelector('.editbtn');
        if(editBtn){
          editBtn.addEventListener('click',async e=>{
            e.stopPropagation();
            S.catParentForAdd=null;
            document.getElementById('ncat-name').value=it.name;
            document.getElementById('ncat-color').value=it.color||'#8B909A';
            S.newCatIcon=it.icon||null;
            updateCatIconPreview();
            initCatPalette();
            document.getElementById('add-cat-overlay').classList.add('show');
            document.getElementById('ncat-ok').onclick=async()=>{
              const body={name:document.getElementById('ncat-name').value,color:document.getElementById('ncat-color').value,icon:S.newCatIcon};
              await api(`/api/settings/categories/${S.subCatType}/${encodeURIComponent(it.id)}`,{method:'PUT',body:JSON.stringify(body)});
              document.getElementById('add-cat-overlay').classList.remove('show');
              await loadCfg(); renderSubList(); toast('✅ 所有欄位已更新');
            };
          });
        }
      }
      el.appendChild(row);
    });
  }

  // note tag sorting
  el.querySelectorAll('.sortbtn').forEach(btn=>btn.addEventListener('click',async()=>{
    const dir = btn.dataset.dir;
    const id = btn.dataset.id;
    let tags = [...(S.cfg.note_tags||[])];
    const idx = tags.findIndex(t=>t.id===id);
    if(idx===-1) return;
    const swap = dir==='up' ? idx-1 : idx+1;
    if(swap<0 || swap>=tags.length) return;
    [tags[idx], tags[swap]] = [tags[swap], tags[idx]];
    await api('/api/settings/note_tags',{method:'PUT',body:JSON.stringify(tags)});
    await loadCfg();
    renderSubList();
  }));
}


/* ── 子頁 ＋ 新增 ────────────────────────── */
document.getElementById('sub-add').addEventListener('click',async()=>{
  const meta=SUB_META[S.subPageKey];
  if(S.subPageKey==='accounts'){
    // open mini overlay with group selector
    S.editingAccId = null;            // clear editing state
    document.getElementById('nacc-name').value='';
    // populate group dropdown based on current config
    const sel=document.getElementById('nacc-group');
    sel.innerHTML = (S.cfg.account_groups||[]).map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
    const firstGroup = (S.cfg.account_groups||[])[0];
    sel.value = firstGroup?firstGroup.id:'';
    document.getElementById('nacc-balance').value='0';
    document.getElementById('nacc-balance-date').value=todayStr();
    document.getElementById('nacc-color').value='#cccccc';
    S.newAccIcon = null;
    document.getElementById('nacc-icon').value='';
    document.getElementById('nacc-icon-size').value = S.accIconPreviewSize;
    updateAccIconPreview();
    document.getElementById('nacc-ok').textContent='新增';
    document.getElementById('add-acc-overlay').classList.add('show');
    return;
  }
  if(meta.isAccGroup){
    // 帳戶：用 mini overlay 新增，預設分組為該頁對應的分組
    document.getElementById('nacc-name').value='';
    document.getElementById('nacc-group').value=meta.gid;
    S.newAccIcon = null;
    document.getElementById('nacc-icon').value='';
    document.getElementById('nacc-icon-size').value = S.accIconPreviewSize;
    updateAccIconPreview();
    document.getElementById('add-acc-overlay').classList.add('show');
    return;
  }
  if(S.subPageKey==='categories'){
    // open category overlay (prepared earlier)
    S.catParentForAdd = S.subCatPath[S.subCatPath.length-1]||null;
    S.newCatIcon = null;
    document.getElementById('ncat-name').value='';
    document.getElementById('ncat-color').value='#8B909A';
    const _cp=document.getElementById('ncat-colorpicker'); if(_cp) _cp.value='#8B909A';
    document.getElementById('ncat-icon').value='';
    document.getElementById('ncat-icon-size').value = S.catIconPreviewSize;
    updateCatIconPreview();
    initCatPalette();
    document.getElementById('add-cat-overlay').classList.add('show');
    return;
  }
  // other lists fallback to overlay
  if(S.subPageKey==='note_tags'){
    _ntagSelCat=''; _ntagSelCatName='';
    document.getElementById('ntag-name').value='';
    document.getElementById('ntag-cat-selected').style.display='none';
    document.getElementById('ntag-cat-grid').style.display='flex';
    document.getElementById('ntag-cat-path').style.display='';
    renderNtagCatGrid(null);
    const ov=document.getElementById('add-notetag-overlay');
    ov.style.display='flex'; ov.style.pointerEvents='auto';
    setTimeout(()=>document.getElementById('ntag-name').focus(),100);
    return;
  }
  const name=prompt('名稱'); if(!name) return;
  await api(`/api/settings/${S.subPageKey}`,{method:'POST',body:JSON.stringify({name})});
  await loadCfg();
  renderSubList(); toast('已新增');
});
document.getElementById('sub-cancel').addEventListener('click',()=>closeOverlay('sub-page'));

/* ── 備註標籤 overlay 事件 ── */
function flatAllCats(arr){
  return (arr||[]).reduce((a,c)=>{a.push(c);if(c.children)a=a.concat(flatAllCats(c.children));return a;},[]);
}
let _ntagSelCat='', _ntagSelCatName='', _ntagCatParent=null;

function renderNtagCatGrid(parent){
  _ntagCatParent=parent||null;
  const cats=parent?parent.children:(S.cfg.categories?.expense||[]);
  const grid=document.getElementById('ntag-cat-grid');
  const path=document.getElementById('ntag-cat-path');
  grid.innerHTML='';
  path.textContent=parent?'◀ 點擊返回上層':'（不選擇 = 所有分類皆顯示）';
  if(parent){
    const back=document.createElement('div');
    back.className='cat-chip';
    back.innerHTML='◀ 返回';
    back.addEventListener('click',()=>renderNtagCatGrid(null));
    grid.appendChild(back);
  }
  cats.forEach(c=>{
    const chip=document.createElement('div');
    chip.className='cat-chip';
    chip.style.borderColor=c.color||'#8B909A';
    const hasChildren=c.children&&c.children.length;
    chip.innerHTML=(c.color?`<span style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block;margin-right:4px"></span>`:'')
      +c.name+(hasChildren?' ›':'');
    chip.addEventListener('click',()=>{
      if(hasChildren){
        renderNtagCatGrid(c);
      } else {
        _ntagSelCat=c.id; _ntagSelCatName=c.name;
        const sel=document.getElementById('ntag-cat-selected');
        document.getElementById('ntag-cat-selected-name').textContent='已選：'+c.name;
        sel.style.display='flex';
        grid.style.display='none';
        path.style.display='none';
      }
    });
    grid.appendChild(chip);
  });
}
function clearNtagCat(){
  _ntagSelCat=''; _ntagSelCatName='';
  document.getElementById('ntag-cat-selected').style.display='none';
  document.getElementById('ntag-cat-grid').style.display='flex';
  document.getElementById('ntag-cat-path').style.display='';
  renderNtagCatGrid(null);
}
function closeNtagOverlay(){
  const ov=document.getElementById('add-notetag-overlay');
  ov.style.display='none'; ov.style.pointerEvents='none';
}
document.getElementById('ntag-cancel').addEventListener('click', closeNtagOverlay);
document.getElementById('ntag-ok').addEventListener('click', async()=>{
  const name=document.getElementById('ntag-name').value.trim();
  if(!name){ toast('請輸入標籤名稱'); return; }
  await api('/api/settings/note_tags',{method:'POST',body:JSON.stringify({name,category:_ntagSelCat})});
  closeNtagOverlay();
  await loadCfg(); renderSubList(); toast('已新增');
});
document.getElementById('ntag-name').addEventListener('keydown',e=>{
  if(e.key==='Enter') document.getElementById('ntag-ok').click();
});

// category overlay initialization and handlers
// 【需求 1】18 色調色盤
function initCatPalette(){
  // 24 色，grid 12列×2行
  const palette = [
    '#FF5F6D','#FF9A5C','#FFD166','#FFA500','#FF6B35','#F72585',
    '#06D6A0','#4CC9F0','#4895EF','#7B5EA7','#8338EC','#FF006E',
    '#3A86FF','#06FFA5','#FFBE0B','#FB5607','#7209B7','#F15BB5',
    '#00BBF9','#00F5D4','#9B5DE5','#6B48FF','#00C896','#AAAAAA'
  ];
  const palEl=document.getElementById('ncat-palette'); palEl.innerHTML='';
  palette.forEach(c=>{
    const btn=document.createElement('div'); btn.className='pal';
    btn.style.background=c;
    btn.title=c;
    btn.addEventListener('click',()=>{
      document.getElementById('ncat-color').value=c;
      const cp=document.getElementById('ncat-colorpicker');
      if(cp) cp.value=c;
      palEl.querySelectorAll('.pal').forEach(b=>b.style.borderColor='transparent');
      btn.style.borderColor='var(--t1)';
    });
    palEl.appendChild(btn);
  });
  // color picker ↔ text input 雙向同步
  const cp=document.getElementById('ncat-colorpicker');
  const ct=document.getElementById('ncat-color');
  if(cp&&!cp._bound){
    cp._bound=true;
    cp.addEventListener('input',()=>{ ct.value=cp.value; });
  }
  if(ct&&!ct._bound2){
    ct._bound2=true;
    ct.addEventListener('input',()=>{
      if(/^#[0-9a-fA-F]{6}$/.test(ct.value)) cp.value=ct.value;
    });
  }
}
// support icon upload for categories
if(document.getElementById('ncat-icon')){
  document.getElementById('ncat-icon').addEventListener('change',async e=>{
    const file=e.target.files[0];
    if(!file){ S.newCatIcon=null; updateCatIconPreview(); return; }
    const reader=new FileReader();
    reader.onload=()=>{
      S.newCatIcon=reader.result;
      updateCatIconPreview();
    };
    reader.readAsDataURL(file);
  });
  const ncatSize=document.getElementById('ncat-icon-size');
  if(ncatSize){
    ncatSize.oninput=e=>{ S.catIconPreviewSize=+e.target.value; updateCatIconPreview(); };
  }
  const ncatBuiltinBtn=document.getElementById('ncat-icon-builtin');
  if(ncatBuiltinBtn){
    ncatBuiltinBtn.addEventListener('click',()=>openIconPicker('category'));
  }
}
// support icon upload for accounts
if(document.getElementById('nacc-icon')){
  document.getElementById('nacc-icon').addEventListener('change',async e=>{
    const file=e.target.files[0];
    if(!file){ S.newAccIcon=null; updateAccIconPreview(); return; }
    const reader=new FileReader();
    reader.onload=()=>{
      S.newAccIcon=reader.result;
      updateAccIconPreview();
    };
    reader.readAsDataURL(file);
  });
  const naccSize=document.getElementById('nacc-icon-size');
  if(naccSize){
    naccSize.oninput=e=>{ S.accIconPreviewSize=+e.target.value; updateAccIconPreview(); };
  }
  const naccBuiltinBtn=document.getElementById('nacc-icon-builtin');
  if(naccBuiltinBtn){
    naccBuiltinBtn.addEventListener('click',()=>openIconPicker('account'));
  }
}
document.getElementById('ncat-cancel').addEventListener('click',()=>{
  document.getElementById('add-cat-overlay').classList.remove('show');
  S.catParentForAdd = null;
});
document.getElementById('ncat-ok').addEventListener('click',async()=>{
  const name=document.getElementById('ncat-name').value.trim();
  if(!name){toast('請輸入名稱');return;}
  const color=document.getElementById('ncat-color').value.trim()||'#8B909A';
  const parent=S.catParentForAdd;
  const body={name,color};
  if(parent) body.parent=parent.id;
  if(S.newCatIcon) body.icon=S.newCatIcon;
  await api(`/api/settings/categories/${S.subCatType}`,{method:'POST',body:JSON.stringify(body)});
  document.getElementById('add-cat-overlay').classList.remove('show');
  await loadCfg();
  if(S.subPageKey==='categories'){
    function _f(l,id){for(const c of l){if(c.id===id)return c;const x=_f(c.children||[],id);if(x)return x;}return null;}
    S.subCatPath=S.subCatPath.map(p=>_f(S.cfg.categories[S.subCatType]||[],p.id)||p);
    renderSubList();
  } else { renderModalCats(S.addType, parent); }
  toast('已新增');
  S.catParentForAdd=null;
  S.newCatIcon=null;
});
// click background to close
if(document.getElementById('add-cat-overlay')){
  document.getElementById('add-cat-overlay').addEventListener('click',e=>{
    if(e.target===document.getElementById('add-cat-overlay')){
      document.getElementById('add-cat-overlay').classList.remove('show');
      S.catParentForAdd = null;
    }
  });
}

/* ── 新增帳戶 mini overlay ────────────────── */
document.getElementById('nacc-cancel').addEventListener('click',()=>{
  document.getElementById('add-acc-overlay').classList.remove('show');
  S.editingAccId = null;
  document.getElementById('nacc-ok').textContent='新增';
});
document.getElementById('nacc-ok').addEventListener('click',async()=>{
  const name=document.getElementById('nacc-name').value.trim();
  if(!name){ toast('請輸入帳戶名稱'); return; }
  const group=document.getElementById('nacc-group').value;
  const balance=parseFloat(document.getElementById('nacc-balance').value)||0;
  const balance_date=document.getElementById('nacc-balance-date').value;
  const color=document.getElementById('nacc-color').value;
  const payload={name,group,balance,color,balance_date};
  if(S.newAccIcon) payload.icon=S.newAccIcon;
  if(S.editingAccId){
    await api(`/api/settings/accounts/${S.editingAccId}`,{method:'PUT',body:JSON.stringify(payload)});
    toast('已更新帳戶');
  } else {
    await api('/api/settings/accounts',{method:'POST',body:JSON.stringify(payload)});
    toast('已新增帳戶');
  }
  document.getElementById('add-acc-overlay').classList.remove('show');
  S.editingAccId=null;
  document.getElementById('nacc-ok').textContent='新增';
  await loadCfg(); renderSubList();
  if(document.getElementById('page-accounts').classList.contains('active')) renderAccounts();
});
// 點背景關閉
document.getElementById('add-acc-overlay').addEventListener('click',e=>{
  if(e.target===document.getElementById('add-acc-overlay'))
    document.getElementById('add-acc-overlay').classList.remove('show');
});

/* ══════════════════════════════════════════════
   備份 / 還原
══════════════════════════════════════════════ */
function doBackup(){ window.location.href='/api/backup'; }
function doRestore(){
  const fi=document.getElementById('restore-file');
  fi.onchange=async()=>{
    const f=fi.files[0]; if(!f) return;
    const text=await f.text();
    try{
      const data=JSON.parse(text);
      if(!confirm('確定用此備份覆蓋現有資料？')) return;
      await api('/api/restore',{method:'POST',body:text});
      await loadCfg(); await renderHome(); toast('還原成功 ✓');
    }catch(e){ toast('檔案格式錯誤'); }
    fi.value='';
  };
  fi.click();
}
async function doReset(){
  const ok=await customConfirm('【 重置為初始狀態 】；所有紀錄與設定都將消失且無法復原！');
  if(!ok) return;
  try{
    const res=await api('/api/reset',{method:'POST'});
    // ↓ 加這四行
    localStorage.removeItem(ADV_KEYS['piggy']);
    localStorage.removeItem(ADV_KEYS['budget']);
    localStorage.removeItem(ADV_KEYS['recurring']);
    localStorage.removeItem(ADV_KEYS['debt']);   // ← 這行是負債    
    toast('重置成功，已重置為「 初始狀態 」', 4000); // 先顯示 toast
    await loadCfg();
    await renderHome();
    if(document.getElementById('page-accounts').classList.contains('active')) renderAccounts();
  }catch(e){
    toast('重置失敗：'+(e.message||e));
  }
}

/* ══════════════════════════════════════════════
   初始化
══════════════════════════════════════════════ */
async function loadCfg(){
  S.cfg=await api('/api/settings');
  // make sure categories object exists and has expected keys
  if(!S.cfg.categories) S.cfg.categories={expense:[],income:[],transfer:[]};
  S.cfg.categories.expense = S.cfg.categories.expense||[];
  S.cfg.categories.income  = S.cfg.categories.income||[];
  S.cfg.categories.transfer= S.cfg.categories.transfer||[];
  S.cfg.note_tags = S.cfg.note_tags||[];
  // sync account groups for both settings page and account overview
  if(Array.isArray(S.cfg.account_groups)){
    // preserve colours from existing ACC_GROUPS where possible
    ACC_GROUPS = S.cfg.account_groups.map(g=>{
      const preset=ACC_GROUPS.find(p=>p.id===g.id);
      return {id:g.id,name:g.name,color:preset?preset.color:'#cccccc'};
    });
  }
  // also include any groups that appear in accounts but not in account_groups
  const existingIds=ACC_GROUPS.map(g=>g.id);
  (S.cfg.accounts||[]).forEach(a=>{
    if(a.group && !existingIds.includes(a.group)){
      ACC_GROUPS.push({id:a.group,name:a.group,color:'#cccccc'});
      existingIds.push(a.group);
    }
  });
}
async function init(){
  const d=new Date(S.selDate+'T00:00:00');
  S.calY=d.getFullYear(); S.calM=d.getMonth()+1;
  await loadCfg();
  await renderHome();
  // 檢查並執行到期的固定項目
  setTimeout(checkRecurring, 1000);
}

function renderNoteTags(){
  const row=document.getElementById('note-tag-row');
  if(!row) return;
  const tags=S.cfg.note_tags||[];
  if(!tags.length){ row.style.display='none'; row.innerHTML=''; return; }
  row.style.display='flex';
  row.innerHTML = tags.map(t=>`<div class="note-tag" data-id="${t.id}">${t.name}</div>`).join('');
  row.querySelectorAll('.note-tag').forEach(el=>el.addEventListener('click',()=>{
    document.getElementById('f-note').value=el.textContent;
  }));
}

function renderItemNoteTags(i){
  const allTags=S.cfg.note_tags||[];
  const row=document.getElementById(`item-note-tags-${i}`);
  if(!row) return;
  // 依目前項目的分類過濾
  const it=S.addItems[i]||{};
  const selCat=it.category||'';
  // 只顯示「無綁定分類」或「綁定分類符合」的標籤
  const tags=allTags.filter(t=>!t.category||t.category===selCat);
  if(!tags.length){ row.style.display='none'; row.innerHTML=''; return; }
  row.style.display='flex';
  row.innerHTML = tags.map(t=>{
    const active = it.note===t.name ? ' style="background:rgba(22,163,74,0.15);border-color:rgba(22,163,74,0.4)"' : '';
    return `<div class="note-tag" data-i="${i}" data-name="${t.name}"${active}>${t.name}</div>`;
  }).join('');
  row.querySelectorAll('.note-tag').forEach(el=>{
    el.addEventListener('click',()=>{
      const idx=+el.dataset.i;
      const name=el.dataset.name;
      S.addItems[idx].note=name;
      renderAddItems();
    });
  });
}

/* ══ 搜尋記錄 ══════════════════════════════ */
function openSearch(){
  document.getElementById('search-input').value='';
  document.getElementById('search-type').value='';
  document.getElementById('search-from').value='';
  document.getElementById('search-to').value='';
  document.getElementById('search-results').innerHTML='<div style="color:var(--t3);font-size:13px;text-align:center;padding:24px">輸入關鍵字開始搜尋</div>';
  openOverlay('search-page');
  setTimeout(()=>document.getElementById('search-input').focus(),300);
}
async function doSearch(){
  const kw=document.getElementById('search-input').value.trim().toLowerCase();
  const tp=document.getElementById('search-type').value;
  const fr=document.getElementById('search-from').value;
  const to=document.getElementById('search-to').value;
  const el=document.getElementById('search-results');
  el.innerHTML='<div style="color:var(--t3);font-size:13px;text-align:center;padding:16px">搜尋中...</div>';
  try{
    const allRecs=await api('/api/records');
    const cats=[...flattenCats(S.cfg.categories?.expense||[]),...flattenCats(S.cfg.categories?.income||[]),...flattenCats(S.cfg.categories?.transfer||[])];
    const results=allRecs.filter(r=>{
      if(tp&&r.type!==tp) return false;
      if(fr&&r.date<fr) return false;
      if(to&&r.date>to) return false;
      if(!kw) return true;
      const catObj=cats.find(c=>c.id===r.category)||{name:''};
      const note=(r.note||'').toLowerCase();
      const mer=((S.cfg.merchants||[]).find(m=>m.id===r.merchant)?.name||'').toLowerCase();
      const amt=String(r.amount);
      return note.includes(kw)||mer.includes(kw)||amt.includes(kw)||catObj.name.toLowerCase().includes(kw);
    }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100);
    if(!results.length){ el.innerHTML='<div class="empty-tip">找不到符合的記錄</div>'; return; }
    const pal=['#FF5F6D','#FF9A5C','#FFD166','#06D6A0','#4CC9F0','#4895EF','#7B5EA7','#F72585'];
    el.innerHTML=results.map(r=>{
      const catObj=cats.find(c=>c.id===r.category)||{name:r.category||'',color:'#8B909A'};
      const sign=r.type==='expense'?'-':r.type==='income'?'+':'⇄';
      const col=r.type==='expense'?'var(--red)':r.type==='income'?'var(--acc)':'var(--blue)';
      const note=r.note?'<span style="color:var(--t3);font-size:11px;margin-left:6px">'+r.note+'</span>':'';
      const iconHtml=catObj.icon?'<img src="'+resolveIconUrl(catObj.icon)+'" style="width:28px;height:28px;object-fit:cover;border-radius:6px;flex-shrink:0;">':'<div style="width:28px;height:28px;border-radius:6px;background:'+(catObj.color||'#8B909A')+';flex-shrink:0;"></div>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">'
        +iconHtml
        +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;">'+catObj.name+note+'</div>'
        +'<div style="font-size:11px;color:var(--t3);">'+r.date+(r.time?' '+r.time:'')+'</div></div>'
        +'<div style="font-family:var(--mono);color:'+col+';font-weight:600;">'+sign+fmt(r.amount)+'</div></div>';
    }).join('');
  }catch(e){ el.innerHTML='<div style="color:var(--red);padding:16px;text-align:center">搜尋失敗</div>'; }
}
document.addEventListener('DOMContentLoaded',()=>{
  const si=document.getElementById('search-input');
  if(si) si.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
});

/* ══ 清除紀錄（保留設定）══════════════════════════════ */
async function doClearRecords(){
  // 1️⃣ 提示用戶將清除的內容（新增進階功能資料）
  const ok=await customConfirm('清除所有記錄與進階功能資料，保留帳戶和類別設定');
  if(!ok) return;
  try{
    // 2️⃣ 調用 API 清除記錄 + 重置帳戶餘額
    await api('/api/reset-records',{method:'POST'});
    // 3️⃣ 清除本地存儲中的進階功能資料
    localStorage.removeItem(ADV_KEYS['piggy']);      // 存錢筒
    localStorage.removeItem(ADV_KEYS['budget']);     // 預算
    localStorage.removeItem(ADV_KEYS['recurring']);  // 固定支出/收入
    localStorage.removeItem(ADV_KEYS['debt']);       // 負債
    // 4️⃣ 重新載入設定（會從後端取得更新後的帳戶）
    await loadCfg();
    // 5️⃣ 重新渲染首頁（帳戶餘額會變為 0）
    await renderHome();
    // 6️⃣ 如果帳戶總覽頁開著，也更新
    if(document.getElementById('page-accounts').classList.contains('active')) 
      renderAccounts();
    // 7️⃣ 顯示成功訊息
    toast('已清除所有記錄和進階功能資料，保留帳戶和類別設定', 4000);
  }catch(e){ 
    toast('清除失敗：'+(e.message||e)); 
  }
}

/* ══ 趨勢圖 ══════════════════════════════════ */
let _trendMode='both'; // 'both' | 'expense' | 'income'
async function renderTrendChart(mode){
  if(mode) _trendMode=mode;
  const {rptY:y,rptM:m}=S;
  const el=document.getElementById('rv-trend');
  if(!el) return;
  const d=await api('/api/report?year='+y+'&month='+m);
  const days=Object.keys(d.daily_expense||{}).sort();
  const expData=days.map(k=>d.daily_expense[k]||0);
  const incData=days.map(k=>(d.daily_income||{})[k]||0);
  const labels=days.map(k=>parseInt(k)+'日');
  if(S.trendChart){S.trendChart.destroy();S.trendChart=null;}
  const btnStyle=(active,color)=>
    'padding:5px 14px;border-radius:999px;border:none;font-size:12px;font-weight:600;cursor:pointer;'
    +(active?'background:'+color+';color:#fff;':'background:var(--sf2);color:var(--t2);');
  el.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
    +'<div class="rpt-section-title" style="margin-bottom:0">每日趨勢</div>'
    +'<div style="display:flex;gap:6px;">'
    +'<button id="trend-btn-both" onclick="renderTrendChart(\'both\')" style="'+btnStyle(_trendMode==='both','#6B7280')+'">兩者</button>'
    +'<button id="trend-btn-exp" onclick="renderTrendChart(\'expense\')" style="'+btnStyle(_trendMode==='expense','#DC2626')+'">支出</button>'
    +'<button id="trend-btn-inc" onclick="renderTrendChart(\'income\')" style="'+btnStyle(_trendMode==='income','#16A34A')+'">收入</button>'
    +'</div></div>'
    +'<div style="position:relative;height:220px;overflow:visible"><canvas id="trend-line"></canvas></div>'
    +'<div class="rpt-divider" style="margin-top:10px"></div>'
    +'<div style="display:flex;justify-content:space-around;margin-top:8px;font-size:12px;">'
    +'<div style="text-align:center;opacity:'+(_trendMode==='income'?0.4:1)+'">'
    +'<div style="color:var(--t3)">月支出</div>'
    +'<div style="font-family:var(--mono);color:var(--red);font-weight:600;">-'+fmt(expData.reduce((a,b)=>a+b,0))+'</div></div>'
    +'<div style="text-align:center;opacity:'+(_trendMode==='expense'?0.4:1)+'">'
    +'<div style="color:var(--t3)">月收入</div>'
    +'<div style="font-family:var(--mono);color:var(--acc);font-weight:600;">+'+fmt(incData.reduce((a,b)=>a+b,0))+'</div></div></div>';
  const ctx=document.getElementById('trend-line').getContext('2d');
  const datasets=[];
  if(_trendMode==='both'||_trendMode==='expense')
    datasets.push({label:'支出',data:expData,borderColor:'rgba(220,38,38,0.9)',backgroundColor:'rgba(220,38,38,0.08)',tension:0.3,pointRadius:3,borderWidth:2,fill:true});
  if(_trendMode==='both'||_trendMode==='income')
    datasets.push({label:'收入',data:incData,borderColor:'rgba(22,163,74,0.9)',backgroundColor:'rgba(22,163,74,0.08)',tension:0.3,pointRadius:3,borderWidth:2,fill:true});
  S.trendChart=new Chart(ctx,{type:'line',
    data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},datalabels:{display:false},
        tooltip:{callbacks:{label:function(c){return c.dataset.label+': NT$'+fmt(c.parsed.y);}}}},
      scales:{x:{ticks:{font:{size:9},maxRotation:0,autoSkip:true,maxTicksLimit:10},grid:{display:false}},
        y:{ticks:{font:{size:10},callback:function(v){return v>=1000?Math.round(v/1000)+'k':v;}},grid:{color:'rgba(0,0,0,0.05)'}}}}});
}


/* ══════════════════════════════════════════════
   進階功能：存錢筒 / 預算 / 固定支出收入
══════════════════════════════════════════════ */
const ADV_KEYS={piggy:'adv_piggy',budget:'adv_budget',recurring:'adv_recurring',debt:'adv_debt'};

// 讀寫進階資料（存在 localStorage + 後端）
function advLoad(key){ try{return JSON.parse(localStorage.getItem(ADV_KEYS[key])||'[]');}catch{return [];} }
function advSave(key,data){ localStorage.setItem(ADV_KEYS[key],JSON.stringify(data)); }

let _advMode='';

function openAdvPage(mode){
  _advMode=mode;
  const titles={piggy:'存錢筒',budget:'預算管理',recurring:'固定支出／收入'};
  document.getElementById('adv-title').textContent=titles[mode]||mode;
  document.getElementById('adv-add-btn').style.display='';
  renderAdvBody();
  openOverlay('adv-page');
}

async function renderAdvBody(){
  const el = document.getElementById('adv-body');
  if (_advMode === 'piggy') {
    await renderPiggyList(el);
  } else if (_advMode === 'budget') {
    await renderBudgetList(el);  // 【Item 3/4】改為 async
  } else if (_advMode === 'recurring') {
    renderRecurringList(el);
  }
}

function advAddItem(){
  if(_advMode==='piggy') openPiggyForm();
  else if(_advMode==='budget') openBudgetForm();
  else if(_advMode==='recurring') openRecurringForm();
}

/* ─── 存錢筒 ─── */
/* ─── 存錢筒 ─── */
/* ─── 存錢筒列表頁（已修正：新增存入後列表即時更新）─── */
async function renderPiggyList(el){
  const items = advLoad('piggy');
  if(!items.length){
    el.innerHTML = '<div class="empty-tip" style="padding:32px 0">尚無存錢筒<br>按 ＋ 新增</div>';
    return;
  }

  // 從後端即時取得所有記錄
  let allRecords = [];
  try {
    allRecords = await api('/api/records');
  } catch(e){ console.error('取得記錄失敗', e); }

  // 依 piggyName 或 note 分組（解決新增後無法顯示的問題）
  const recordMap = {};
  allRecords.forEach(r => {
    if (r.type === 'piggy') {
      const key = r.piggyName || r.note || '';   // 同時支援兩種儲存方式
      if (key) {
        if (!recordMap[key]) recordMap[key] = [];
        recordMap[key].push(r);
      }
    }
  });

  el.innerHTML = items.map(function(p, i){
    const piggyRecords = recordMap[p.name] || [];
    const saved = piggyRecords.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
    const pct = p.target > 0 ? Math.min(100, Math.round(saved / p.target * 100)) : 0;
    const remain = Math.max(0, p.target - saved);
    const barColor = pct >= 100 ? 'var(--acc)' : pct >= 70 ? '#FFD166' : 'var(--blue)';
    const logCount = piggyRecords.length;

    return '<div class="rpt-card" style="margin-bottom:12px;cursor:pointer;" onclick="openPiggyDetail('+i+')">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'+
        '<div style="font-weight:700;font-size:16px;">'+p.name+'</div>'+
        '<div style="display:flex;gap:6px;" onclick="event.stopPropagation()">'+
          '<button onclick="openPiggyForm('+i+')" style="padding:4px 10px;border-radius:999px;background:var(--sf2);color:var(--t2);border:1px solid var(--border);font-size:12px;cursor:pointer;">✎</button>'+
          '<button onclick="deletePiggy('+i+')" class="row-del-btn" style="width:28px;height:28px;">✕</button>'+
        '</div>'+
      '</div>'+
      // 環形進度
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;">'+
        '<div style="position:relative;width:80px;height:80px;flex-shrink:0;">'+
          '<svg width="80" height="80" style="transform:rotate(-90deg)">'+
            '<circle cx="40" cy="40" r="34" fill="none" stroke="var(--sf2)" stroke-width="8"/>'+
            '<circle cx="40" cy="40" r="34" fill="none" stroke="'+barColor+'" stroke-width="8" stroke-dasharray="'+(pct/100*213.6).toFixed(1)+' 213.6" stroke-linecap="round"/>'+
          '</svg>'+
          '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">'+
            '<div style="font-size:14px;font-weight:700;color:'+barColor+';">'+pct+'%</div>'+
          '</div>'+
        '</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:13px;font-weight:600;color:var(--t1);">NT$ '+fmt(saved)+'</div>'+
          '<div style="font-size:11px;color:var(--t3);margin-top:2px;">目標 NT$ '+fmt(p.target)+'</div>'+
          (remain>0 ? '<div style="font-size:11px;color:var(--red);margin-top:4px;">還差 NT$ '+fmt(remain)+'</div>' : '<div style="font-size:11px;color:var(--acc);margin-top:4px;">🎉 已達標！</div>')+
          (p.deadline ? (function(){var dl=Math.ceil((new Date(p.deadline)-new Date())/864e5);var col=dl<=0?'var(--red)':dl<=7?'#F59E0B':'var(--t3)';return '<div style="font-size:11px;color:'+col+';margin-top:4px;">截止：'+p.deadline+' (剩 '+Math.max(0,dl)+' 天)</div>';})() : '')+
        '</div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--t3);">共 '+logCount+' 筆記錄 ›</div>'+
    '</div>';
  }).join('');
}

/* ─── 存錢筒詳情頁（圓餅圖進度 + 存入記錄）─── */
/* 已修正：從後端即時取得記錄（解決新增後未顯示問題） */
/* 已修正：截止日置於統計列下方置中 */
async function openPiggyDetail(i) {
  const items = advLoad('piggy');
  const p = items[i];
  if (!p) return;

  // 從後端取得所有記錄（確保新存入的 piggy 記錄立即顯示）
  let allRecords = [];
  try {
    allRecords = await api('/api/records');
  } catch (e) {
    console.error('取得記錄失敗', e);
  }

  // 過濾屬於本存錢筒的記錄（彈性比對 piggyName 或 note）
  const piggyRecords = allRecords.filter(r =>
    r.type === 'piggy' &&
    (r.piggyName === p.name || r.note === p.name)
  );

  // 計算最新 saved 與 logs
  const saved = piggyRecords.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
  const logs = piggyRecords.map(r => ({
    date: r.date,
    amount: parseFloat(r.amount || 0),
    note: r.note || ''
  })).sort((a, b) => b.date.localeCompare(a.date)); // 最新在上

  const pct = p.target > 0 ? Math.min(100, Math.round(saved / p.target * 100)) : 0;
  const remain = Math.max(0, p.target - saved);
  const barColor = pct >= 100 ? 'var(--acc)' : pct >= 70 ? '#FFD166' : 'var(--blue)';

  // 取得帳戶名稱（用於顯示「國泰銀行」）
  const body = document.getElementById('adv-body');
  const logHtml = logs.length
    ? logs.map(l => {
        const matchingRec = allRecords.find(r => r.date === l.date && Math.abs(r.amount - l.amount) < 0.01);
        let accName = '未知帳戶';
        if (matchingRec && matchingRec.account) {
          const accObj = (S.cfg.accounts || []).find(a => a.id === matchingRec.account);
          if (accObj) accName = accObj.name;
        }
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
          <div style="font-size:13px;color:var(--t2);">${l.date}．${accName}</div>
          <div style="font-family:var(--mono);font-weight:700;color:var(--acc);">+${fmt(l.amount)}</div>
        </div>`;
      }).join('')
    : '<div class="empty-tip">尚無記錄</div>';

  body.innerHTML =
    '<button onclick="renderAdvBody()" style="display:flex;align-items:center;gap:4px;background:none;border:none;color:var(--blue);font-size:13px;cursor:pointer;margin-bottom:12px;">◀ 返回列表</button>' +
    '<div class="rpt-card" style="margin-bottom:12px;">' +
      '<div style="font-weight:700;font-size:17px;margin-bottom:12px;">' + p.name + '</div>' +
      // 環形進度
      '<div style="display:flex;justify-content:center;margin-bottom:14px;">' +
        '<div style="position:relative;width:140px;height:140px;">' +
          '<svg width="140" height="140" style="transform:rotate(-90deg)">' +
            '<circle cx="70" cy="70" r="58" fill="none" stroke="var(--sf2)" stroke-width="12"/>' +
            '<circle cx="70" cy="70" r="58" fill="none" stroke="' + barColor + '" stroke-width="12" stroke-dasharray="' + (pct / 100 * 364.4).toFixed(1) + ' 364.4" stroke-linecap="round"/>' +
          '</svg>' +
          '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
            '<div style="font-size:26px;font-weight:800;color:' + barColor + ';">' + pct + '%</div>' +
            '<div style="font-size:11px;color:var(--t3);">進度</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // 統計列（三欄）
      '<div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:12px;">' +
        '<div><div style="font-size:11px;color:var(--t3);">已存入</div><div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--acc);">' + fmt(saved) + '</div></div>' +
        '<div><div style="font-size:11px;color:var(--t3);">目標</div><div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--t1);">' + fmt(p.target) + '</div></div>' +
        '<div><div style="font-size:11px;color:var(--t3);">還差</div><div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--red);">' + fmt(remain) + '</div></div>' +
      '</div>' +
      // 截止日置於下方置中（已修正）
      (p.deadline?(function(){var dl=Math.ceil((new Date(p.deadline)-new Date())/864e5);var col=dl<=0?'var(--red)':dl<=7?'#F59E0B':'var(--t3)';return '<div style="text-align:center;font-size:12px;color:'+col+';padding:8px 0;border-top:1px solid var(--border);">截止日：'+p.deadline+' (剩 '+Math.max(0,dl)+' 天)</div>';})(  ):'') +
    '</div>' +
    '<div style="font-size:12px;font-weight:600;color:var(--t3);letter-spacing:.5px;margin-bottom:8px;">存入記錄（' + logs.length + ' 筆）</div>' +
    logHtml;
}

function openPiggyForm(idx){
  const items=advLoad('piggy');
  const p=idx!==undefined?items[idx]:{};
  const body=document.getElementById('adv-body');
  body.innerHTML='<div style="padding:8px 0">'
    +'<button onclick="renderAdvBody()" style="display:flex;align-items:center;gap:4px;background:none;border:none;color:var(--blue);font-size:13px;cursor:pointer;margin-bottom:12px;">◀ 返回列表</button>'
    +'<div class="fg"><label>存錢筒名稱</label><input type="text" class="finp" id="pg-name" value="'+(p.name||'')+'" placeholder="例：出國旅遊"></div>'
    +'<div class="fg"><label>目標金額</label><input type="number" class="finp" id="pg-target" value="'+(p.target||'')+'" placeholder="0" inputmode="decimal"></div>'
    +'<div class="fg"><label>截止日（選填）</label><input type="date" class="finp" id="pg-deadline" value="'+(p.deadline||'')+'"></div>'
    +'<div class="acc-btns" style="margin-top:16px;">'
    +'<button class="acc-btn" onclick="renderAdvBody()">取消</button>'
    +'<button class="acc-btn ok" onclick="savePiggy('+(idx!==undefined?idx:'null')+')">儲存</button>'
    +'</div></div>';
}
function savePiggy(idx){
  const name=document.getElementById('pg-name').value.trim();
  const target=parseFloat(document.getElementById('pg-target').value)||0;
  const deadline=document.getElementById('pg-deadline').value;
  if(!name||!target){toast('請填寫名稱和目標金額');return;}
  const items=advLoad('piggy');
  if(idx!==null&&idx!==undefined) items[idx]={...items[idx],name,target,deadline};
  else items.push({name,target,deadline,saved:0,logs:[]});
  advSave('piggy',items); renderAdvBody(); toast('已儲存');
}
function deletePiggy(i){
  const items=advLoad('piggy');
  const piggyName=items[i].name;  // 存儲存錢筒名稱
  const piggyId=i;               // 存錢筒索引（在 localStorage 中的標識）  
  customConfirm(piggyName).then(async function(v){
    if(!v) return;   
    try {
      // 1️⃣ 從後端刪除相關的記錄（type='piggy' 且 piggyId 相同）
      const allRecords = await api('/api/records');
      for(const rec of allRecords) {
        // 檢查是否是該存錢筒的記錄
        if(rec.type === 'piggy' && rec.piggyId === piggyId && rec.piggyName === piggyName) {
          await api(`/api/records/${rec.id}`, {method: 'DELETE'});
        }
      }      
      // 2️⃣ 從 localStorage 刪除存錢筒本身
      items.splice(i, 1);
      advSave('piggy', items);      
      // 3️⃣ 重新加載設定（更新帳戶餘額）
      await loadCfg();      
      // 4️⃣ 更新首頁顯示
      await renderHome();      
      // 5️⃣ 重新渲染進階功能頁
      renderAdvBody();      
      toast('已刪除存錢筒及其所有記錄');
    } catch(err) {
      toast('刪除失敗：' + (err.message || err));
    }
  });
}
// 不再需要 openPiggyDeposit（改由新增記錄頁完成）
function openPiggyDeposit(i){ openPiggyDetail(i); }

/* ─── 預算管理 ─── */
/* ── 預算管理全面重寫（Items 3 & 4）─────────────────────── */

// 顏色設定預設值
const BUDGET_COLOR_DEFAULTS = [
  {pct:100, op:'gte', color:'#16a34a', label:'預算%（含）以上'},
  {pct1:50, pct2:99, op:'range', color:'#F59E0B', label:'預算50%～99%'},
  {pct:49,  op:'lt',  color:'#DC2626', label:'預算低於50%'},
];

// 取得本月支出（依分類 ID 加總）
let _budgetMonthSpend = {};
async function calcBudgetMonthSpend(){
  const thisMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
  let recs=[];
  try{ recs=await api('/api/records'); }catch(e){}
  const spend={};
  recs.filter(r=>r.type==='expense'&&r.date&&r.date.startsWith(thisMonth)).forEach(r=>{
    (r.items||[]).forEach(it=>{
      if(it.category) spend[it.category]=(spend[it.category]||0)+(parseFloat(it.price||0)*(parseFloat(it.qty||1)));
    });
    if(!r.items||!r.items.length) spend[r.category]=(spend[r.category]||0)+(parseFloat(r.amount||0));
  });
  _budgetMonthSpend=spend;
}

function getBudgetBarColor(spent, budget){
  if(!budget) return '#8B909A';
  const pct = Math.round(spent/budget*100);
  // 低於 50% → 紅；50~99% → 橘；100%+ → 綠
  if(pct >= 100) return '#16a34a';
  if(pct >= 50)  return '#F59E0B';
  return '#DC2626';
}

/* ── 預算列表（每組獨立欄位，可點擊查看詳情）── */
async function renderBudgetList(el){
  await calcBudgetMonthSpend();
  const data=advLoad('budget');
  const cats=flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]);
  const thisMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
  const label=thisMonth.replace('-','年')+'月';

  if(!data.length){
    el.innerHTML='<div class="empty-tip" style="padding:32px 0;text-align:center">尚無預算<br>按右上 ＋ 新增</div>';
    return;
  }

  let html='<div style="padding:4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:14px;">'+label+'預算</div>';

  data.forEach((b,bi)=>{
    const cObj = b.catId ? cats.find(x=>x.id===b.catId)||{name:b.catId,color:'#8B909A'} : null;
    const name = b.name || (cObj?cObj.name:'未命名');
    const budget = parseFloat(b.amount)||0;
    const spent = cObj ? (_budgetMonthSpend[b.catId]||0) : Object.keys(_budgetMonthSpend).reduce((s,k)=>s+(_budgetMonthSpend[k]||0),0);
    const remain = Math.max(0, budget-spent);
    const pct = budget>0 ? Math.min(100,Math.round(spent/budget*100)) : 0;
    const barColor = getBudgetBarColor(spent, budget);
    const iconHtml = cObj?.icon
      ? '<img src="'+resolveIconUrl(cObj.icon)+'" style="width:22px;height:22px;border-radius:5px;object-fit:cover;">'
      : '<span style="width:10px;height:10px;border-radius:50%;background:'+(cObj?.color||'#8B909A')+';flex-shrink:0;display:inline-block;"></span>';

    html += '<div class="rpt-card" style="margin-bottom:10px;cursor:pointer;" onclick="openBudgetDetail('+bi+')">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">'+iconHtml+'<span style="font-weight:600;font-size:14px;">'+escHtml(name)+'</span></div>';
    html += '<button onclick="event.stopPropagation();deleteBudget('+bi+')" class="row-del-btn">✕</button>';
    html += '</div>';
    html += '<div style="height:6px;background:var(--sf2);border-radius:3px;margin-bottom:6px;overflow:hidden;">';
    html += '<div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:3px;transition:width .3s;"></div></div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);">';
    html += '<span>已用 <strong style="font-family:var(--mono);color:'+barColor+';">NT$ '+fmt(spent)+'</strong></span>';
    html += '<span>剩餘 <strong style="font-family:var(--mono);color:var(--t1);">NT$ '+fmt(remain)+'</strong></span>';
    html += '</div></div>';
  });

  html+='</div>';
  el.innerHTML=html;
}

function openBudgetDetail(bi){
  const data=advLoad('budget');
  const b=data[bi];
  if(!b) return;
  const cats=flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]);
  const cObj = b.catId ? cats.find(x=>x.id===b.catId)||{name:b.catId,color:'#8B909A'} : null;
  const name = b.name || (cObj?cObj.name:'未命名');
  const budget = parseFloat(b.amount)||0;
  const spent = cObj ? (_budgetMonthSpend[b.catId]||0) : Object.keys(_budgetMonthSpend).reduce((s,k)=>s+(_budgetMonthSpend[k]||0),0);
  const remain = Math.max(0, budget-spent);
  const body=document.getElementById('adv-body');
  body.innerHTML='<div style="padding:8px 0">'    +'<button onclick="renderAdvBody()" style="background:none;border:none;color:var(--blue);font-size:15px;font-weight:600;cursor:pointer;margin-bottom:16px;">◀ 返回列表</button>'    +'<div class="rpt-card" style="margin-bottom:10px;">'    +'<div style="font-size:11px;color:var(--t3);margin-bottom:4px;">預算名稱</div>'    +'<div style="font-size:18px;font-weight:700;margin-bottom:12px;">'+escHtml(name)+'</div>'    +'<div style="display:flex;justify-content:space-between;margin-bottom:6px;">'    +'<div style="text-align:center;flex:1;"><div style="font-size:11px;color:var(--t3);">預算總額</div><div style="font-size:18px;font-weight:700;font-family:var(--mono);">NT$ '+fmt(budget)+'</div></div>'    +'<div style="text-align:center;flex:1;"><div style="font-size:11px;color:var(--t3);">已使用</div><div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--red);">NT$ '+fmt(spent)+'</div></div>'    +'<div style="text-align:center;flex:1;"><div style="font-size:11px;color:var(--t3);">剩餘預算</div><div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--acc);">NT$ '+fmt(remain)+'</div></div>'    +'</div></div>'    +'</div>';
}

function deleteBudget(bi){
  const data=advLoad('budget');
  customConfirm(data[bi]?.name||'此預算').then(ok=>{
    if(!ok) return;
    data.splice(bi,1);
    advSave('budget',data);
    renderAdvBody(); toast('已刪除');
  });
}

/* ── 新增預算表單（Item 3）── */
let _budgetCatSel='', _budgetTopCat=null;

function openBudgetForm(){
  // 【Item 3】每次都是新增，不讀取舊資料
  _budgetCatSel=''; _budgetTopCat=null;
  const body=document.getElementById('adv-body');
  const topCats=S.cfg.categories&&S.cfg.categories.expense||[];
  body.innerHTML='<div style="padding:8px 0">'    +'<button onclick="renderAdvBody()" style="background:none;border:none;color:var(--blue);font-size:15px;font-weight:600;cursor:pointer;margin-bottom:16px;">◀ 返回列表</button>'    +'<div class="fg" style="margin-bottom:10px;"><label>預算名稱（選填）</label><input type="text" class="finp" id="b-name" placeholder="例：食費、娛樂"></div>'    +'<div class="fg" style="margin-bottom:6px;"><label>選擇分類（不選=全類別預算）</label></div>'    +'<div id="budget-cat-area" style="margin-bottom:12px;"></div>'    +'<div class="fg" style="margin-bottom:10px;"><label>預算金額（每月）</label><input type="number" class="finp" id="b-amount" placeholder="0" inputmode="decimal"></div>'    +'<div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:8px;">預算顏色設定</div>'    +'<div style="background:var(--sf2);border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;margin-bottom:14px;">'    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'    +'  <span style="width:10px;height:10px;border-radius:50%;background:#16a34a;flex-shrink:0;display:inline-block;"></span>'    +'  <span style="font-size:12px;flex:1;">預算 <input type="number" id="bc-green-pct" value="100" style="width:50px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--sf);color:var(--t1);font-size:12px;"> %（含）以上 → 綠色</span>'    +'</div>'    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'    +'  <span style="width:10px;height:10px;border-radius:50%;background:#F59E0B;flex-shrink:0;display:inline-block;"></span>'    +'  <span style="font-size:12px;flex:1;">預算 <input type="number" id="bc-orange-low" value="50" style="width:50px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--sf);color:var(--t1);font-size:12px;"> % ～ <input type="number" id="bc-orange-high" value="99" style="width:50px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--sf);color:var(--t1);font-size:12px;"> % → 橘色</span>'    +'</div>'    +'<div style="display:flex;align-items:center;gap:8px;">'    +'  <span style="width:10px;height:10px;border-radius:50%;background:#DC2626;flex-shrink:0;display:inline-block;"></span>'    +'  <span style="font-size:12px;flex:1;">低於以上範圍 → 紅色</span>'    +'</div></div>'    +'<div class="acc-btns" style="margin-top:4px;">'    +'<button class="acc-btn" onclick="renderAdvBody()">取消</button>'    +'<button class="acc-btn ok" onclick="saveBudget()">新增預算</button>'    +'</div></div>';
  renderBudgetCatArea();
}

let _budgetCatPath=[];
function renderBudgetCatArea(){
  const area=document.getElementById('budget-cat-area');
  if(!area) return;
  const topCats=S.cfg.categories && S.cfg.categories.expense || [];
  const parent=_budgetCatPath.length ? _budgetCatPath[_budgetCatPath.length-1] : null;
  const cats=parent ? (parent.children || []) : topCats;
  let html='';
  
  if(_budgetCatPath.length){
    html+='<button onclick="_budgetCatPath.pop();renderBudgetCatArea()" style="background:none;border:none;color:var(--blue);font-size:12px;cursor:pointer;margin-bottom:6px;">◀ 返回</button>';
  }

  // 已選徽章
  if(_budgetCatSel){
    const allC = flattenCats(topCats);
    const selC = allC.find(x => x.id === _budgetCatSel) || {name:_budgetCatSel, color:'#8B909A'};
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px 10px;background:rgba(22,163,74,0.1);border:1px solid rgba(22,163,74,0.4);border-radius:var(--rs);">
              <span style="font-size:12px;color:#16a34a;font-weight:600;">已選：${escHtml(selC.name)}</span>
              <button onclick="_budgetCatSel='';renderBudgetCatArea()" style="background:none;border:none;color:#16a34a;cursor:pointer;font-size:14px;margin-left:auto;">✕</button>
            </div>`;
  }

  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
  cats.forEach(c => {
    const isOn = _budgetCatSel === c.id;
    // 使用模板字符串處理複雜的 onclick 邏輯
    const clickAction = (c.children && c.children.length) 
      ? `_budgetCatPath.push(${JSON.stringify(c).replace(/"/g, '&quot;')});renderBudgetCatArea()`
      : `_budgetCatSel='${c.id}';renderBudgetCatArea()`;

    html += `<div onclick="${clickAction}" class="debt-cat-chip${isOn ? ' on' : ''}" style="${isOn ? `border-color:${c.color};color:${c.color};` : ''}">
              ${escHtml(c.name)}${c.children && c.children.length ? ' ›' : ''}
            </div>`;
  });
  html += '</div>';
  area.innerHTML = html;
}

function saveBudget(){
  const amount=parseFloat(document.getElementById('b-amount')?.value)||0;
  if(!amount){ toast('請輸入預算金額'); return; }
  const name=document.getElementById('b-name')?.value.trim()||'';
  const greenPct=parseInt(document.getElementById('bc-green-pct')?.value||'100')||100;
  const orangeLow=parseInt(document.getElementById('bc-orange-low')?.value||'50')||50;
  const orangeHigh=parseInt(document.getElementById('bc-orange-high')?.value||'99')||99;
  const data=advLoad('budget');
  data.push({
    name, catId:_budgetCatSel||null, amount,
    colorRules:{greenPct, orangeLow, orangeHigh}
  });
  advSave('budget',data);
  renderAdvBody(); toast('預算已新增');
}

let _recCatSel='', _recType='expense', _recCatPath=[];

// 渲染類別選擇格（分層，依類型）
function renderRecCatGrid(){
  const type=_recType;
  const topCats=S.cfg.categories&&S.cfg.categories[type]||[];
  const parent=_recCatPath.length?_recCatPath[_recCatPath.length-1]:null;
  const cats=parent?(parent.children||[]):topCats;
  const grid=document.getElementById('rec-cat-grid');
  if(!grid) return;
  grid.innerHTML='';
  // 返回按鈕
  if(parent){
    const back=document.createElement('div');
    back.className='cat-chip';
    back.innerHTML='◀ 返回';
    back.addEventListener('click',function(){ _recCatPath.pop(); renderRecCatGrid(); });
    grid.appendChild(back);
  }
  cats.forEach(function(c){
    const chip=document.createElement('div');
    chip.className='cat-chip'+(_recCatSel===c.id?' on':'');
    chip.style.borderColor=c.color||'#8B909A';
    const iconHtml=c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:18px;height:18px;object-fit:contain;margin-right:4px;vertical-align:middle;">':'';
    const hasChild=(c.children||[]).length>0;
    chip.innerHTML=iconHtml+'<span>'+c.name+'</span>'+(hasChild?' ›':'');
    chip.addEventListener('click',function(){
      if(hasChild){ _recCatPath.push(c); renderRecCatGrid(); }
      else{ _recCatSel=c.id; renderRecCatGrid(); }
    });
    grid.appendChild(chip);
  });
}

function editRecurring(i){
  const items = advLoad('recurring');
  const r = items[i];
  if(!r) return;
  // 複用新增表單，填入現有資料
  _recCatSel = r.category||''; 
  _recType = r.type||'expense'; 
  _recCatPath = [];
  const body = document.getElementById('adv-body');
  body.innerHTML = '<div style="padding:8px 0">'
    +'<button onclick="renderAdvBody()" style="display:flex;align-items:center;gap:4px;background:none;border:none;color:var(--blue);font-size:13px;cursor:pointer;margin-bottom:12px;">◀ 返回列表</button>'
    +'<div class="fg"><label>類型</label>'
    +'<div class="type-tabs" style="margin-bottom:0">'
    +'<button class="type-tab'+(r.type==='expense'?' on expense':'')+'" id="rec-t-exp">支出</button>'
    +'<button class="type-tab'+(r.type==='income'?' on income':'')+'" id="rec-t-inc">收入</button></div></div>'
    +'<div class="fg"><label>類別</label>'
    +'<div id="rec-cat-grid" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>'
    +'<div class="fg"><label>金額</label>'
    +'<input type="number" class="finp" id="rec-amount" value="'+(r.amount||'')+'" placeholder="0" inputmode="decimal"></div>'
    +'<div class="fg"><label>開始日期與時間</label>'
    +'<div style="display:flex;gap:8px;">'
    +'<input type="date" class="finp" id="rec-startdate" value="'+(r.startdate||'')+'" style="flex:1">'
    +'<input type="time" class="finp" id="rec-time" value="'+(r.time||'')+'" style="flex:1"></div></div>'
    +'<div class="fg"><label>重複週期</label>'
    +'<div style="display:flex;gap:8px;align-items:center;">'
    +'<span style="font-size:13px;color:var(--t2);">每</span>'
    +'<input type="number" class="finp" id="rec-period-n" value="'+(r.periodN||1)+'" min="1" inputmode="numeric" style="width:70px;">'
    +'<select class="fsel" id="rec-period-unit" style="flex:1">'
    +'<option value="day"'+(r.periodUnit==='day'?' selected':'')+'>天</option>'
    +'<option value="week"'+(r.periodUnit==='week'?' selected':'')+'>週</option>'
    +'<option value="month"'+((!r.periodUnit||r.periodUnit==='month')?' selected':'')+'>月</option>'
    +'<option value="year"'+(r.periodUnit==='year'?' selected':'')+'>年</option>'
    +'</select></div></div>'
    +'<div class="fg"><label>備註（選填）</label>'
    +'<input type="text" class="finp" id="rec-note" value="'+(r.note||'')+'" placeholder="選填"></div>'
    +'<div class="fg"><label>截止日期（選填）</label>'
    +'<input type="date" class="finp" id="rec-enddate" value="'+(r.endDate||'')+'"></div>'
    +'<div class="acc-btns" style="margin-top:16px;">'
    +'<button class="acc-btn" onclick="renderAdvBody()">取消</button>'
    +'<button class="acc-btn ok" onclick="saveEditRecurring('+i+')">儲存</button>'
    +'</div></div>';
  renderRecCatGrid();
  document.getElementById('rec-t-exp').addEventListener('click',function(){
    _recType='expense'; _recCatSel=''; _recCatPath=[];
    document.getElementById('rec-t-exp').className='type-tab on expense';
    document.getElementById('rec-t-inc').className='type-tab';
    renderRecCatGrid();
  });
  document.getElementById('rec-t-inc').addEventListener('click',function(){
    _recType='income'; _recCatSel=''; _recCatPath=[];
    document.getElementById('rec-t-exp').className='type-tab';
    document.getElementById('rec-t-inc').className='type-tab on income';
    renderRecCatGrid();
  });
}

/* ── 修改固定項目（已儲存帳戶欄位） ── */
function saveEditRecurring(i){
  const items = advLoad('recurring');
  if(!_recCatSel){ toast('請選擇類別'); return; }
  const amount = parseFloat(document.getElementById('rec-amount').value)||0;
  if(!amount){ toast('請輸入金額'); return; }
  
  items[i] = {
    ...items[i],
    type: _recType,
    category: _recCatSel,
    account: document.getElementById('rec-account').value || '',   // 【本次新增】
    amount,
    startdate: document.getElementById('rec-startdate').value || todayStr(),
    time: document.getElementById('rec-time').value || '00:00',
    periodN: parseInt(document.getElementById('rec-period-n').value)||1,
    periodUnit: document.getElementById('rec-period-unit').value || 'month',
    note: document.getElementById('rec-note').value.trim(),
    endDate: document.getElementById('rec-enddate').value||'',
  };
  advSave('recurring', items);
  renderAdvBody();
  toast('已儲存');
}

/* ── 開啟固定項目表單（已新增「帳戶」下拉選單） ── */
function openRecurringForm(){
  _recCatSel=''; _recType='expense'; _recCatPath=[];
  const body=document.getElementById('adv-body');
  
  // 產生帳戶選項
  const accOpts = (S.cfg.accounts || []).map(a => 
    `<option value="${a.id}">${a.name}</option>`
  ).join('');
  
  body.innerHTML='<div style="padding:8px 0">'
    +'<div class="fg"><label>類型</label>'
    +'<div class="type-tabs" style="margin-bottom:0">'
    +'<button class="type-tab on expense" id="rec-t-exp">支出</button>'
    +'<button class="type-tab" id="rec-t-inc">收入</button></div></div>'
    
    +'<div class="fg"><label>類別</label>'
    +'<div id="rec-cat-grid" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>'
    
    // 【本次新增】帳戶欄位
    +'<div class="fg" style="margin-bottom:10px;"><label>帳戶</label>'
    +'<select class="fsel" id="rec-account">'+accOpts+'</select></div>'
    
    +'<div class="fg"><label>金額</label>'
    +'<input type="number" class="finp" id="rec-amount" placeholder="0" inputmode="decimal"></div>'
    
    +'<div class="fg"><label>開始日期與時間</label>'
    +'<div style="display:flex;gap:8px;">'
    +'<input type="date" class="finp" id="rec-startdate" style="flex:1">'
    +'<input type="time" class="finp" id="rec-time" style="flex:1"></div></div>'
    
    +'<div class="fg"><label>重複週期</label>'
    +'<div style="display:flex;gap:8px;align-items:center;">'
    +'<span style="font-size:13px;color:var(--t2);">每</span>'
    +'<input type="number" class="finp" id="rec-period-n" value="1" min="1" inputmode="numeric" style="width:70px;">'
    +'<select class="fsel" id="rec-period-unit" style="flex:1">'
    +'<option value="day">天</option><option value="week">週</option>'
    +'<option value="month" selected>月</option><option value="year">年</option>'
    +'</select></div></div>'
    
    +'<div class="fg"><label>備註（選填）</label>'
    +'<input type="text" class="finp" id="rec-note" placeholder="選填"></div>'
    
    +'<div class="fg"><label>截止日期（選填）</label>'
    +'<input type="date" class="finp" id="rec-enddate"></div>'
    
    +'<div class="acc-btns" style="margin-top:16px;">'
    +'<button class="acc-btn" onclick="renderAdvBody()">取消</button>'
    +'<button class="acc-btn ok" onclick="saveRecurring()">新增</button>'
    +'</div></div>';
  
  renderRecCatGrid();
  // 類型切換
  document.getElementById('rec-t-exp').addEventListener('click',function(){
    _recType='expense'; _recCatSel=''; _recCatPath=[];
    document.getElementById('rec-t-exp').className='type-tab on expense';
    document.getElementById('rec-t-inc').className='type-tab';
    renderRecCatGrid();
  });
  document.getElementById('rec-t-inc').addEventListener('click',function(){
    _recType='income'; _recCatSel=''; _recCatPath=[];
    document.getElementById('rec-t-exp').className='type-tab';
    document.getElementById('rec-t-inc').className='type-tab on income';
    renderRecCatGrid();
  });
}

/* ── 儲存固定項目（已儲存帳戶欄位） ── */
function saveRecurring(){
  const type=_recType;
  const category=_recCatSel;
  const account = document.getElementById('rec-account').value || '';   // 【本次新增】
  const amount=parseFloat(document.getElementById('rec-amount').value)||0;
  const startdate=document.getElementById('rec-startdate').value||todayStr();
  const time=document.getElementById('rec-time').value||'00:00';
  const periodN=parseInt(document.getElementById('rec-period-n').value)||1;
  const periodUnit=document.getElementById('rec-period-unit').value||'month';
  const note=document.getElementById('rec-note').value.trim();
  const endDate=document.getElementById('rec-enddate')?.value||'';
  
  if(!category){toast('請選擇類別');return;}
  if(!amount){toast('請輸入金額');return;}
  
  const items=advLoad('recurring');
  items.push({type, category, account, amount, startdate, time, periodN, periodUnit, note, endDate, lastRun:''});   // 已加入 account
  advSave('recurring',items); 
  renderAdvBody(); 
  toast('已新增固定項目');
  checkRecurring();
}

// 計算下一次執行日期
function nextRecurringDate(item){
  const base=item.lastRun||item.startdate;
  if(!base) return item.startdate;
  const d=new Date(base+'T00:00:00');
  const n=item.periodN||1;
  const u=item.periodUnit||'month';
  if(u==='day') d.setDate(d.getDate()+n);
  else if(u==='week') d.setDate(d.getDate()+n*7);
  else if(u==='month') d.setMonth(d.getMonth()+n);
  else if(u==='year') d.setFullYear(d.getFullYear()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

/* ── 開啟 App 時自動檢查固定項目，到期就建立記錄並更新帳戶餘額 ── */
async function checkRecurring(){
  const items = advLoad('recurring');
  const today = todayStr();
  const nowTime = (()=>{
    const n = new Date();
    return String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
  })();
  
  let changed = false;
  let recurringChanged = false; 

  for(let i = 0; i < items.length; i++){
    const r = items[i];
    // 如果項目已清償則跳過
    if(r.cleared) continue;

    let due = r.lastRun ? nextRecurringDate(r) : r.startdate;
    
    while(due <= today){
      // 若到期日是今天，需再確認時間是否已到
      if(due === today && (r.time || '00:00') > nowTime) break;
      
      try {
        const payload = {
          type: r.type,
          amount: r.amount,
          date: due,
          time: r.time || '00:00',
          note: r.note || '固定',
          category: r.category,
          account: r.account || '',
          items: [{category: r.category, qty: 1, price: r.amount, note: r.note || ''}]
        };
        
        await api('/api/records', {method: 'POST', body: JSON.stringify(payload)});
        items[i].lastRun = due;
        changed = true;

        // 若是固定還款記錄，更新負債餘額
        if(r.note && r.note.startsWith('固定還款：')){
          const debtName = r.note.replace('固定還款：','').trim();
          const debts = advLoad('debt');
          const di = debts.findIndex(d => d.name === debtName);
          if(di >= 0){
            debts[di].paid = (parseFloat(debts[di].paid) || 0) + (parseFloat(r.amount) || 0);
            // 判斷是否全額清償
            if(debts[di].paid >= (parseFloat(debts[di].amount) || 0)){
              debts[di].paid = parseFloat(debts[di].amount);
              items[i].cleared = true;
              items[i].clearedAt = due;
              recurringChanged = true;
            }
            advSave('debt', debts);
          }
        }
        
        // 更新下一期的日期
        due = nextRecurringDate(items[i]);
        
      } catch(e) { 
        console.error("自動記帳失敗", e);
        break; 
      }
    }
  }

  if(changed || recurringChanged){
    advSave('recurring', items);
    await loadCfg();
    await renderHome();
    if(document.getElementById('page-accounts').classList.contains('active')){
      renderDebtSection();
      renderAccounts();
    }
    if(changed) toast('固定項目已自動記帳', 3000);
  }
}
/* ── 固定項目列表（已新增「帳戶」顯示） ── */
function renderRecurringList(el){
  const all=advLoad('recurring');
  // 【修正 Bug 2】分離進行中與已完成（cleared）項目
  const items = all.filter(r=>!r.cleared);
  const completed = all.filter(r=>r.cleared);

  const cats=[...flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]),...flattenCats(S.cfg.categories&&S.cfg.categories.income||[]),...flatDebtCats(DEBT_CATS)];
  const unitLabel={day:'天',week:'週',month:'月',year:'年'};

  function buildCard(r, realIdx, isCompleted){
    const c=cats.find(x=>x.id===r.category)||{name:r.category||'',color:'#8B909A'};
    const typeColor=r.type==='expense'?'var(--red)':'var(--acc)';
    const sign=r.type==='expense'?'-':'+';
    const periodStr='每'+(r.periodN&&r.periodN>1?r.periodN:'')+(unitLabel[r.periodUnit||'month']||'月');
    const accName=r.account?(S.cfg.accounts||[]).find(a=>a.id===r.account)?.name||'未設定':'未設定';
    if(isCompleted){
      return '<div class="rpt-card" style="margin-bottom:10px;background:rgba(34,197,94,0.06);border-color:rgba(34,197,94,0.3);">'        +'<div style="display:flex;align-items:center;justify-content:space-between;">'        +'<div style="flex:1;min-width:0;">'        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">'        +(c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:24px;height:24px;border-radius:6px;object-fit:cover;">':"<span style=\"width:10px;height:10px;border-radius:50%;background:"+(c.color||'#8B909A')+";flex-shrink:0;display:inline-block;\"></span>")        +'<span style="font-weight:600;font-size:14px;text-decoration:line-through;opacity:.6;">'+c.name+'</span>'        +'<span class="debt-cleared-badge">✓ 已清償</span>'        +'</div>'        +'<div style="font-size:11px;color:var(--t3);">清償日：'+(r.clearedAt||'—')+'　帳戶：'+accName+'</div>'        +(r.note?'<div style="font-size:11px;color:var(--t3);margin-top:2px;">'+r.note+'</div>':'')        +'</div>'        +'<div style="display:flex;align-items:center;gap:8px;">'        +'<span style="font-family:var(--mono);font-weight:700;color:'+typeColor+';">'+sign+fmt(r.amount)+'</span>'        +'<button onclick="deleteRecurring('+realIdx+')" class="row-del-btn">✕</button>'        +'</div></div></div>';
    }
    const nextDue=nextRecurringDate(r);
    return '<div class="rpt-card" style="margin-bottom:10px;">'      +'<div style="display:flex;align-items:center;justify-content:space-between;">'      +'<div style="flex:1;min-width:0;">'      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'      +(c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:24px;height:24px;border-radius:6px;object-fit:cover;">':"<span style=\"width:10px;height:10px;border-radius:50%;background:"+(c.color||'#8B909A')+";flex-shrink:0;display:inline-block;\"></span>")      +'<span style="font-weight:600;font-size:14px;">'+c.name+'</span>'      +'<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:'+(r.type==='expense'?'rgba(220,38,38,0.1)':"rgba(22,163,74,0.1)")+';color:'+typeColor+';">'+periodStr+'</span>'      +'</div>'      +'<div style="font-size:12px;color:var(--t3);">下次：'+nextDue+' '+r.time+'</div>'
      +(r.note?'<div style="font-size:11px;color:var(--t3);margin-top:2px;">'+r.note+'</div>':'')      +(r.endDate?'<div style="font-size:11px;color:var(--t3);margin-top:2px;">截止：'+r.endDate+'</div>':'')      +'<div style="font-size:11px;color:var(--t3);margin-top:2px;">帳戶：'+accName+'</div>'      +'</div>'      +'<div style="display:flex;align-items:center;gap:8px;">'      +'<span style="font-family:var(--mono);font-weight:700;color:'+typeColor+';">'+sign+fmt(r.amount)+'</span>'      +'<button onclick="editRecurring('+realIdx+')" style="width:28px;height:28px;border-radius:50%;background:var(--sf2);color:var(--t2);border:1px solid var(--border);font-size:13px;cursor:pointer;">✎</button>'      +'<button onclick="deleteRecurring('+realIdx+')" class="row-del-btn">✕</button>'      +'</div></div></div>';
  }

  let html = '';
  if(!items.length && !completed.length){
    el.innerHTML='<div class="empty-tip" style="padding:32px 0">尚無固定項目<br>按 ＋ 新增</div>';
    return;
  }
  if(!items.length){
    html += '<div class="empty-tip" style="padding:16px 0 8px;text-align:center;font-size:13px;color:var(--t3);">尚無進行中項目</div>';
  } else {
    html += items.map(r=>{ const ri=all.indexOf(r); return buildCard(r,ri,false); }).join('');
  }
  if(completed.length){
    html += '<div style="font-size:12px;font-weight:600;color:var(--t3);letter-spacing:.5px;margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--border);">已完成</div>';
    html += completed.map(r=>{ const ri=all.indexOf(r); return buildCard(r,ri,true); }).join('');
  }
  el.innerHTML=html;
}


function deleteRecurring(i){
  const items=advLoad('recurring');
  customConfirm(items[i].note||items[i].type+' NT$'+fmt(items[i].amount)).then(function(ok){
    if(!ok)return; items.splice(i,1); advSave('recurring',items); renderAdvBody(); toast('已刪除');
  });
}

/* ══════════════════════════════════════════════
   記錄詳情頁渲染（已修正 piggy 顯示亂碼與標題）
══════════════════════════════════════════════ */
async function openDetail(recordId) {
  let records = await api('/api/records');
  const record = records.find(r => r.id === recordId);
  if (!record) { toast('找不到記錄'); return; }

  const detailBox = document.getElementById('detail-box');
  const body = document.getElementById('detail-body');
  const isPiggy = record.type === 'piggy';

  let titleText = isPiggy ? '存錢筒記錄' : '記錄資訊';

  // ── 分類查找（含 DEBT_CATS 補查）──
  function flatCats(arr){ return (arr||[]).reduce((a,c)=>{a.push(c);if(c.children)a=a.concat(flatCats(c.children));return a;},[]);}
  const allCats=[...flatCats(S.cfg.categories?.expense||[]),...flatCats(S.cfg.categories?.income||[]),...flatCats(S.cfg.categories?.transfer||[]),...flatDebtCats(DEBT_CATS)];
  const cat = allCats.find(c=>c.id===record.category) || {name:record.category||'未分類',color:'#8B909A'};

  // ── 主區塊：圖示 + 分類名 + 金額 ──
  const amtColor = record.type==='expense'?'var(--red)':record.type==='income'?'var(--acc)':record.type==='transfer'?'var(--blue)':'#9B5DE5';
  const amtSign  = record.type==='expense'?'-':record.type==='income'?'+':record.type==='transfer'?'⇄':'±';
  // 【修正 Bug 4】圖示放大至 42px
  const iconHtml = isPiggy
    ? `<img src="/icon/存錢筒.png" width="42" height="42" style="object-fit:contain;flex-shrink:0;">`
    : cat.icon
      ? `<img src="${resolveIconUrl(cat.icon)}" width="42" height="42" style="object-fit:cover;border-radius:10px;flex-shrink:0;">`
      : `<div style="width:42px;height:42px;border-radius:10px;background:${cat.color};flex-shrink:0;"></div>`;
  const catLabel = isPiggy ? '存錢筒' : cat.name;
  const catColor2 = isPiggy ? '#F59E0B' : amtColor;

  // ── 品項列表（支出/收入）──
  // 【修正 Bug 4】品項格式加 $ 符號；【修正 Bug 2】備註優先用 record.note，備援 items[0].note
  const displayNote = record.note || (record.items?.[0]?.note && record.type!=='expense' && record.type!=='income' ? record.items[0].note : '') || '';
  const itemRows = (record.items||[]).length && (record.type==='expense'||record.type==='income')
    ? record.items.map(it=>{
        const ic = allCats.find(x=>x.id===it.category)||{name:it.category||'',color:'#8B909A'};
        const nm = ic.name||it.category||'';
        // 【修正 Bug 4】格式：(標籤)(備註)(數量)×($ 金額)
        const tagChip = nm ? `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${ic.color||'#8B909A'};color:#fff;font-size:12px;font-weight:600;margin-right:4px;">${nm}</span>` : '';
        const noteChip = it.note ? `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:var(--sf2);border:1px solid var(--border);font-size:12px;color:var(--t2);margin-right:4px;">${it.note}</span>` : '';
        const qtyPrice = `<span style="font-size:13px;color:var(--t2);">(${it.qty||1}) × <strong style="color:${amtColor};font-family:var(--mono);">$ ${fmt(it.price||0)}</strong></span>`;
        return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:6px 0;border-bottom:1px solid var(--border);">${tagChip}${noteChip}${qtyPrice}</div>`;
      }).join('')
    : '';

  body.innerHTML = `
    <!-- 主標題區 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid var(--border);">
      <div style="display:flex;align-items:center;gap:12px;">
        ${iconHtml}
        <!-- 【修正 Bug 4】分類名稱字體放大 -->
        <div>
          <div style="font-size:21px;font-weight:700;color:var(--t1);">${catLabel}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px;">${record.type==='expense'?'支出':record.type==='income'?'收入':record.type==='transfer'?'轉帳':record.type==='piggy'?'存錢筒':'調整'}</div>
        </div>
      </div>
      <!-- 【修正 Bug 4】金額字體放大 -->
      <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:${catColor2};">${amtSign}${fmt(record.amount)}</div>
    </div>
    <!-- 品項區 -->
    ${itemRows ? `<div style="background:var(--sf2);padding:8px 14px;border-radius:10px;margin-bottom:16px;">${itemRows}</div>` : ''}
    <!-- 資訊欄 -->
    <!-- 【修正 Bug 4】label 加「：」；value 改靠左；整體改縱排 -->
    <div style="display:flex;flex-direction:column;gap:0;">
      ${(()=>{
        const accName = (S.cfg.accounts||[]).find(a=>a.id===record.account)?.name||'未設定';
        const toAccName = record.type==='transfer'&&record.to_account ? (S.cfg.accounts||[]).find(a=>a.id===record.to_account)?.name||'' : '';
        const infoRow = (label,val) => `
          <div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:11px;color:var(--t3);font-weight:500;">${label}：</span>
            <span style="font-size:15px;font-weight:600;color:var(--t1);">${val}</span>
          </div>`;
        let rows = infoRow('帳戶', accName);
        if(toAccName) rows += infoRow('轉入帳戶', toAccName);
        rows += infoRow('日期', record.date);
        rows += infoRow('時間', record.time||'—');
        // 【修正 Bug 2】備註優先 record.note，再看 items[0].note
        const noteVal = record.note || (record.items&&record.items[0]&&record.items[0].note&&(record.type!=='expense'&&record.type!=='income')?record.items[0].note:'') || '';
        if(noteVal) rows += infoRow('備註', noteVal);
        return rows;
      })()}
    </div>
  `;

  document.getElementById('detail-page').classList.add('show');
  detailBox.querySelector('h2').textContent = titleText;

  const editBtn = detailBox.querySelector('#detail-edit-btn');
  if(editBtn){
    editBtn.onclick = () => {
      document.getElementById('detail-page').classList.remove('show');
      openAddPage(record);
    };
  }
}

/* ─── 新增記錄頁 ─ 存錢筒選擇區塊（已修正：顯示最新金額與進度）─── */
async function renderPiggyTypeSection(){
  const sec = document.getElementById('piggy-type-section');
  if (!sec) return;
  if (S.addType !== 'piggy') {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';

  // 從後端即時取得所有記錄（解決顯示舊資料的問題）
  let allRecords = [];
  try {
    allRecords = await api('/api/records');
  } catch(e) {
    console.error('取得記錄失敗', e);
  }

  // 依 piggyName 或 note 分組計算最新 saved
  const recordMap = {};
  allRecords.forEach(r => {
    if (r.type === 'piggy') {
      const key = r.piggyName || r.note || '';
      if (key) {
        if (!recordMap[key]) recordMap[key] = [];
        recordMap[key].push(r);
      }
    }
  });

  const piggies = advLoad('piggy');
  if (!piggies.length) {
    sec.innerHTML = '<div class="cat-lbl">選擇存錢筒</div>' +
      '<div style="padding:16px;color:var(--t3);font-size:13px;text-align:center;">尚無存錢筒<br>請先在功能頁新增</div>';
    return;
  }

  const list = document.getElementById('piggy-type-list');
  if (!list) return;

  list.innerHTML = piggies.map(function(p, i) {
    const piggyRecords = recordMap[p.name] || [];
    const saved = piggyRecords.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
    const pct = p.target > 0 ? Math.min(100, Math.round(saved / p.target * 100)) : 0;
    const active = (_selPiggy === i);
    const barColor = pct >= 100 ? 'var(--acc)' : pct >= 70 ? '#FFD166' : '#F59E0B';

    return '<div onclick="selPiggyType('+i+')" style="padding:12px;border-radius:var(--rs);border:2px solid '+(active?'#F59E0B':'var(--border)')+';background:'+(active?'rgba(245,158,11,0.08)':'var(--sf)')+';cursor:pointer;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<img src="/icon/存錢筒.png" width="32" height="32" style="object-fit:contain;flex-shrink:0;">' +
        '<div style="flex:1">' +
          '<div style="font-weight:600;font-size:14px;">'+p.name+'</div>' +
          '<div style="font-size:11px;color:var(--t3);margin-top:2px;">NT$ '+fmt(saved)+' / '+fmt(p.target)+' ('+pct+'%)</div>' +
        '</div>' +
        (active ? '<span style="color:#F59E0B;font-size:18px;">✓</span>' : '') +
      '</div>' +
      '<div style="height:4px;background:var(--sf2);border-radius:2px;margin-top:8px;overflow:hidden;">' +
        '<div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:2px;"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  // 金額 + 帳戶輸入（若不存在則動態插入）
  let amtRow = document.getElementById('piggy-amount-row');
  if (!amtRow) {
    amtRow = document.createElement('div');
    amtRow.id = 'piggy-amount-row';
    const accOpts = (S.cfg.accounts || []).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    // 【Item 8】帳戶移至存入金額上方
    amtRow.innerHTML = '<div class="fg" style="margin-bottom:10px;"><label style="font-size:11px;color:var(--t3);letter-spacing:.7px;">帳戶</label>' +
      '<select class="fsel" id="piggy-acc-sel">'+accOpts+'</select></div>' +
      '<div class="fg" style="margin-top:10px;"><label style="font-size:11px;color:var(--t3);letter-spacing:.7px;">存入金額</label>' +
      '<input type="number" class="finp" id="piggy-amount-input" placeholder="0" inputmode="decimal" oninput="updatePiggyTotal()"></div>';
    sec.after(amtRow);
  } else {
    // 同步帳戶選項
    const accSel = document.getElementById('piggy-acc-sel');
    if (accSel) {
      const accOpts = (S.cfg.accounts || []).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
      accSel.innerHTML = accOpts;
    }
  }
}

function updatePiggyTotal() {
  const amt = parseFloat(document.getElementById('piggy-amount-input')?.value) || 0;
  document.getElementById('total-val').textContent = amt;
}

function selPiggyType(i){
  _selPiggy=(_selPiggy===i)?null:i;
  renderPiggyTypeSection();
}

/* ══════════════════════════════════════════════
   強制所有記錄點擊使用新詳情頁（解決亂碼問題）
══════════════════════════════════════════════ */
document.addEventListener('click', async function(e) {
  const recItem = e.target.closest('.rec-item');
  if (recItem && recItem.dataset.id) {
    e.preventDefault();           // 防止舊事件觸發
    e.stopImmediatePropagation();
    await openDetail(recItem.dataset.id);
  }
});

// 新增記錄頁右上 ✓ 按鈕：先變深 → 水波紋特效
function addRippleEffect() {
  const confirmBtn = document.getElementById('add-confirm');
  if (!confirmBtn) return;

  confirmBtn.style.position = 'relative';
  confirmBtn.style.overflow = 'hidden';

  confirmBtn.addEventListener('click', function(e) {
    // 步驟1：立即變深
    this.classList.add('pressed');

    // 步驟2：建立水波紋
    const rect = this.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height) * 2.2;

    ripple.style.position = 'absolute';
    ripple.style.borderRadius = '50%';
    ripple.style.background = 'rgba(255,255,255,0.85)';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size/2}px`;
    ripple.style.top = `${e.clientY - rect.top - size/2}px`;
    ripple.style.transform = 'scale(0)';
    ripple.style.animation = 'rippleAnim 0.6s linear forwards';
    ripple.style.pointerEvents = 'none';

    this.appendChild(ripple);

    // 動畫結束後恢復原始顏色
    setTimeout(() => {
      this.classList.remove('pressed');
      ripple.remove();
    }, 600);
  });
}

// 確保頁面載入後立即綁定
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addRippleEffect);
} else {
  addRippleEffect();
}

init();
