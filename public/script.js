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
// 圖示選擇（含分類 tab）
const ICON_CATS=['餐食、飲料','生活支出','交通','收入','帳戶','轉帳'];
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
  const debtTotal = debtItems.reduce((s,d)=>s+(parseFloat(d.amount)||0),0);
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
  {id:'loan',      name:'貸款',     color:'#DC2626', children:[
    {id:'car_loan',     name:'車貸', color:'#FF5F6D'},
    {id:'home_loan',    name:'房貸', color:'#F97316'},
    {id:'personal_loan',name:'信貸', color:'#FB923C'},
  ]},
  {id:'installment',name:'分期',    color:'#7C3AED', children:[
    {id:'shopping_installment',name:'購物分期',color:'#A78BFA'},
  ]},
  {id:'borrow',     name:'借款',     color:'#0EA5E9'},
  {id:'credit_card',name:'信用卡費', color:'#F59E0B'},
];
function flatDebtCats(arr){
  return (arr||[]).reduce((a,c)=>{a.push(c);if(c.children)a=a.concat(flatDebtCats(c.children));return a;},[]);
}
function findDebtCat(id){
  return flatDebtCats(DEBT_CATS).find(c=>c.id===id)||{id,name:id,color:'#8B909A'};
}

/* ── 負債列表（已移除總額欄，將新增按鈕移至頂部） ── */
function renderDebtSection(){
  const el = document.getElementById('acc-debt-section');
  const items = advLoad('debt');
  const total = items.reduce((s,d)=>s+(parseFloat(d.amount)||0),0);
  
  let html = '';

  // 原「負債總額欄」位置 → 現在放「＋新增負債」按鈕
  html += '<button onclick="openDebtForm()" style="width:100%;padding:14px;margin-bottom:20px;background:var(--sf2);border:1px dashed var(--border);border-radius:var(--rs);color:var(--t2);font-size:15px;font-weight:600;cursor:pointer;font-family:var(--sans);transition:.15s;">＋ 新增負債</button>';

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
      return '<div class="debt-card">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
        +'<div style="display:flex;align-items:center;gap:8px;">'
        +'<span style="width:10px;height:10px;border-radius:50%;background:'+cat.color+';flex-shrink:0;display:inline-block;"></span>'
        +'<span style="font-weight:700;font-size:15px;">'+escHtml(d.name||cat.name)+'</span>'
        +'<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:rgba(220,38,38,0.1);color:var(--red);">'+cat.name+'</span>'
        +'</div>'
        +'<div style="display:flex;gap:6px;" onclick="event.stopPropagation()">'
        +'<button onclick="openDebtForm('+i+')" style="padding:4px 10px;border-radius:999px;background:var(--sf2);color:var(--t2);border:1px solid var(--border);font-size:12px;cursor:pointer;">✎</button>'
        +'<button onclick="deleteDebt('+i+')" class="row-del-btn" style="width:28px;height:28px;">✕</button>'
        +'</div></div>'
        +'<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);margin-bottom:6px;">'
        +'<span>總額 <strong style="color:var(--red);font-family:var(--mono);">NT$ '+fmt(amt)+'</strong></span>'
        +'<span>月還款 <strong style="color:var(--t1);font-family:var(--mono);">NT$ '+fmt(d.payment||0)+'</strong></span>'
        +'</div>'
        +'<div style="height:4px;background:var(--sf2);border-radius:2px;margin-bottom:6px;overflow:hidden;">'
        +'<div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:2px;"></div></div>'
        +'<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);">'
        +'<span>已還 '+pct+'%'+(remain>0?' · 剩 NT$ '+fmt(remain):'　🎉 已清償')+'</span>'
        +(d.fixedDay?'<span>每月 '+d.fixedDay+' 日還款</span>':'')
        +'</div>'
        +(d.endDate?'<div style="font-size:11px;color:var(--t3);margin-top:4px;">截止：'+d.endDate+'</div>':'')
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

/* ── 開啟負債表單 ── */
function openDebtForm(idx){
  const items=advLoad('debt');
  const d=(idx!==undefined&&idx!==null)?items[idx]:null;
  _debtCatSel=d?d.category:'';
  _debtCatParent=null;
  const el=document.getElementById('acc-debt-section');
  el.innerHTML='<div style="padding:4px 0">'
    +'<button onclick="renderDebtSection()" style="background:none;border:none;color:var(--blue);font-size:13px;cursor:pointer;margin-bottom:12px;">◀ 返回列表</button>'
    +'<div class="fg" style="margin-bottom:10px;"><label>名稱／描述</label>'
    +'<input type="text" class="finp" id="debt-name" value="'+(d?escHtml(d.name||''):'')+'" placeholder="例：國泰房貸、信用卡欠款"></div>'
    +'<div class="fg" style="margin-bottom:10px;"><label>分類</label>'
    +'<div id="debt-cat-grid" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>'
    +'<div class="fg" style="margin-bottom:10px;"><label>負債總額</label>'
    +'<input type="number" class="finp" id="debt-amount" value="'+(d?d.amount:'')+'" placeholder="0" inputmode="decimal"></div>'
    +'<div class="fg" style="margin-bottom:10px;"><label>月還款金額</label>'
    +'<input type="number" class="finp" id="debt-payment" value="'+(d?d.payment:'')+'" placeholder="0" inputmode="decimal"></div>'
    +'<div class="fg" style="margin-bottom:10px;"><label>已還金額（選填）</label>'
    +'<input type="number" class="finp" id="debt-paid" value="'+(d?d.paid||0:0)+'" placeholder="0" inputmode="decimal"></div>'
    +'<div class="fg" style="margin-bottom:10px;">'
    +'<div style="display:flex;align-items:center;gap:8px;">'
    +'<input type="checkbox" id="debt-fixed-chk" style="width:18px;height:18px;cursor:pointer;" '+(d&&d.fixedDay?'checked':'')+' onchange="toggleDebtFixedDay()">'
    +'<label for="debt-fixed-chk" style="font-size:13px;color:var(--t1);cursor:pointer;">固定還款日期（自動新增至固定支出）</label>'
    +'</div>'
    +'<div id="debt-fixed-day-row" style="margin-top:8px;display:'+(d&&d.fixedDay?'flex':'none')+';align-items:center;gap:8px;">'
    +'<span style="font-size:13px;color:var(--t2);">每月</span>'
    +'<input type="number" class="finp" id="debt-fixed-day" value="'+(d?d.fixedDay||'':'')+'" placeholder="15" min="1" max="31" inputmode="numeric" style="width:80px;">'
    +'<span style="font-size:13px;color:var(--t2);">日</span>'
    +'</div></div>'
    +'<div class="fg" style="margin-bottom:10px;"><label>截止日期（選填）</label>'
    +'<input type="date" class="finp" id="debt-end-date" value="'+(d?d.endDate||'':'')+'">'
    +'</div>'
    +'<div class="fg" style="margin-bottom:16px;"><label>備註（選填）</label>'
    +'<input type="text" class="finp" id="debt-note" value="'+(d?escHtml(d.note||''):'')+'" placeholder="選填"></div>'
    +'<div class="acc-btns">'
    +'<button class="acc-btn" onclick="renderDebtSection()">取消</button>'
    +'<button class="acc-btn ok" onclick="saveDebt('+(idx!==undefined&&idx!==null?idx:'null')+')">儲存</button>'
    +'</div></div>';
  renderDebtCatGrid(null);
}

function toggleDebtFixedDay(){
  const chk=document.getElementById('debt-fixed-chk');
  document.getElementById('debt-fixed-day-row').style.display=chk.checked?'flex':'none';
}

function saveDebt(idx){
  const name=document.getElementById('debt-name').value.trim();
  const amount=parseFloat(document.getElementById('debt-amount').value)||0;
  const payment=parseFloat(document.getElementById('debt-payment').value)||0;
  const paid=parseFloat(document.getElementById('debt-paid').value)||0;
  const fixedChk=document.getElementById('debt-fixed-chk').checked;
  const fixedDay=fixedChk?(parseInt(document.getElementById('debt-fixed-day').value)||null):null;
  const endDate=document.getElementById('debt-end-date').value||'';
  const note=document.getElementById('debt-note').value.trim();
  if(!_debtCatSel){toast('請選擇分類');return;}
  if(!amount){toast('請輸入負債總額');return;}
  const items=advLoad('debt');
  const isNew=(idx===null||idx===undefined);
  const oldItem=isNew?null:items[idx];
  const item={name:name||findDebtCat(_debtCatSel).name,category:_debtCatSel,amount,payment,paid,fixedDay,endDate,note};
  // 若有固定還款日期，同步至固定支出
  if(fixedDay){
    const recs=advLoad('recurring');
    // 移除舊的關聯固定支出
    if(!isNew && oldItem&&oldItem.fixedDay){
      const oldIdx=recs.findIndex(r=>r._debtId===oldItem._id);
      if(oldIdx>=0) recs.splice(oldIdx,1);
    }
    // 產生唯一 id
    const debtId='debt_'+(Date.now());
    item._id=debtId;
    // 找月還款對應的分類（使用支出的第一個分類）
    const expCats=flattenCats(S.cfg.categories?.expense||[]);
    const catId=expCats[0]?.id||'';
    recs.push({type:'expense',category:catId,amount:payment,
      startdate:todayStr(),time:'09:00',periodN:1,periodUnit:'month',
      note:(name||findDebtCat(_debtCatSel).name)+' 還款',
      day:fixedDay,_debtId:debtId,endDate});
    advSave('recurring',recs);
    toast('已同步至固定支出 ✓', 2500);
  } else if(!isNew&&oldItem&&oldItem.fixedDay&&oldItem._id){
    // 取消固定還款：移除固定支出
    const recs=advLoad('recurring');
    const ri=recs.findIndex(r=>r._debtId===oldItem._id);
    if(ri>=0){recs.splice(ri,1);advSave('recurring',recs);}
  }
  if(isNew) items.push(item);
  else items[idx]={...oldItem,...item};
  advSave('debt',items);
  renderDebtSection();
  renderAccounts();
  toast('已儲存');
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
      const catObj = cats.find(c=>c.id===firstCatId) || cats.find(c=>c.id===r.category) || {name:r.category,color:'#8B909A'};
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

function openAddPage(rec){
  // track editing record
  if(rec){
    S.editRec = rec;
  } else {
    S.editRec = null;
  }
  // optional record for editing
  if(rec){
    S.addType=rec.type||'expense';
    if(S.addType==='transfer'){
      S.transferCat = rec.category||'deposit';
    }
    // prepare items
    if(S.addType==='transfer'){
      S.addItems = (rec.items||[]).map(it=>({from:it.from||'',to:it.to||'',amount:it.amount||0}));
    } else if(S.addType==='adjust'){
      S.addItems = (rec.items||[]).map(it=>({amount:it.amount||0}));
    } else {
      S.addItems = (rec.items||[]).map(it=>({
        qty:it.qty||'1',price:it.price||'',note:it.note||'',category:it.category||'',
        categoryName: (S.cfg.categories[S.addType]||[]).flatMap(c=>[c].concat(c.children||[])).find(x=>x.id===it.category)?.name||''
      }));
    }
    S.selCat=rec.items&&rec.items[0]?rec.items[0].category:'';
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
  // apply new layout visibility
  const _standaloneAcc2 = document.getElementById('standalone-acc');
  const _standaloneMer2 = document.getElementById('standalone-mer');
  const _piggyNoteRow2  = document.getElementById('piggy-note-row');
  const _infoNoteFg2    = document.getElementById('info-note-fg');
  const _totalDispEl2   = document.getElementById('total-disp');
  const _infoSecEl2     = document.getElementById('info-section');
  const _isPiggy2       = S.addType==='piggy';
  const _isTransfer2    = S.addType==='transfer';
  const _isAdjust2      = S.addType==='adjust';
  const _isIncome2      = S.addType==='income';
  _standaloneAcc2.style.display = (_isTransfer2||_isPiggy2) ? 'none' : '';
  _standaloneMer2.style.display = (_isTransfer2||_isAdjust2||_isPiggy2) ? 'none' : '';
  _piggyNoteRow2.style.display  = _isPiggy2 ? '' : 'none';
  if(_infoNoteFg2) _infoNoteFg2.style.display = _isIncome2 ? 'none' : '';
  _totalDispEl2.style.display   = _isPiggy2 ? 'none' : '';
  _infoSecEl2.style.display     = (_isTransfer2||_isAdjust2||_isPiggy2) ? 'none' : '';
  document.getElementById('add-item-btn').style.display = (S.addType==='expense'||S.addType==='income'?'block':'none');
  document.querySelectorAll('.items-section').forEach(el=>{ el.style.display=_isPiggy2?'none':''; });
  // date/time/note
  if(rec){
    document.getElementById('f-date').value=rec.date||todayStr();
    document.getElementById('f-time').value=rec.time||nowTime();
    document.getElementById('f-note').value=rec.note||'';
    document.getElementById('f-acc').value=rec.account||'';
    document.getElementById('f-to-acc').value=rec.to_account||'';
    document.getElementById('f-mer').value=rec.merchant||'';
    document.getElementById('f-exp').value=rec.expert||'';
  } else {
    document.getElementById('f-date').value=S.selDate||todayStr();
    document.getElementById('f-time').value=nowTime();
    document.getElementById('f-note').value='';
  }
  document.getElementById('info-body').classList.remove('open');
  document.getElementById('info-toggle').classList.remove('open');
  renderPiggyTypeSection();
  renderAddItems(); calcTotal();
  // 直接傳值給 syncDateBadge，不靠讀取 input
  var _d=rec?(rec.date||todayStr()):(S.selDate||todayStr());
  var _t=rec?(rec.time||nowTime()):nowTime();
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
  const expEl=document.getElementById('f-exp');
  if(expEl&&expEl.tagName==='SELECT'){
    expEl.innerHTML='<option value="">（不指定）</option>'+(S.cfg.experts||[]).map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
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

  // adjust info section fields
  const standaloneAcc = document.getElementById('standalone-acc');
  const standaloneMer = document.getElementById('standalone-mer');
  const piggyNoteRow  = document.getElementById('piggy-note-row');
  const infoNoteFg    = document.getElementById('info-note-fg');
  const totalDispEl   = document.getElementById('total-disp');
  const infoSecEl     = document.getElementById('info-section');
  if(S.addType==='transfer'){
    standaloneAcc.style.display='none';
    standaloneMer.style.display='none';
    piggyNoteRow.style.display='none';
    infoSecEl.style.display='none';
    totalDispEl.style.display='';
  } else if(S.addType==='adjust'){
    standaloneAcc.style.display='';
    standaloneMer.style.display='none';
    piggyNoteRow.style.display='none';
    infoSecEl.style.display='none';
    totalDispEl.style.display='';
  } else if(S.addType==='piggy'){
    standaloneAcc.style.display='none';
    standaloneMer.style.display='none';
    piggyNoteRow.style.display='';
    infoSecEl.style.display='none';
    totalDispEl.style.display='none';
  } else if(S.addType==='income'){
    standaloneAcc.style.display='';
    standaloneMer.style.display='';
    piggyNoteRow.style.display='none';
    if(infoNoteFg) infoNoteFg.style.display='none';
    infoSecEl.style.display='';
    totalDispEl.style.display='';
  } else { // expense
    standaloneAcc.style.display='';
    standaloneMer.style.display='';
    piggyNoteRow.style.display='none';
    if(infoNoteFg) infoNoteFg.style.display='';
    infoSecEl.style.display='';
    totalDispEl.style.display='';
  }
  document.getElementById('cat-section').style.display='none';
  renderAddItems(); calcTotal();
}));

function renderAddItems(){
  // show or hide "新增一項" 按鈕; 支出與收入允許多筆
  const addBtn=document.getElementById('add-item-btn');
  addBtn.style.display = (S.addType==='expense' || S.addType==='income' ? 'block' : 'none');

  const list=document.getElementById('items-list'); list.innerHTML='';
  const accountsOptions=(S.cfg.accounts||[]).map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  S.addItems.forEach((it,i)=>{
    const row=document.createElement('div'); row.className='item-row';
    if(S.addType==='transfer'){
      // Ensure we have a default from/to even when the user doesn't touch selects
      const accs=S.cfg.accounts||[];
      if(accs.length){
        it.from = it.from || accs[0].id;
        it.to   = it.to   || (accs[1]?.id||accs[0].id);
      }
      let html='';
      html += '<div style="flex:1;display:flex;flex-direction:column;margin-right:4px">';
      html += '<span style="font-size:11px;color:var(--t3);margin-bottom:2px">帳戶</span>';
      // build options with potential selected
      const fromOpts=(S.cfg.accounts||[]).map(a=>`<option value="${a.id}"${it.from===a.id?" selected":""}>${a.name}</option>`).join('');
      const toOpts=(S.cfg.accounts||[]).map(a=>`<option value="${a.id}"${it.to===a.id?" selected":""}>${a.name}</option>`).join('');
      html += `<select data-i="${i}" data-f="from" class="fsel">${fromOpts}</select>`;
      html += '</div>';
      html += '<span style="font-size:12px;align-self:center">→</span>';
      html += '<div style="flex:1;display:flex;flex-direction:column;margin-left:4px">';
      html += '<span style="font-size:11px;color:var(--t3);margin-bottom:2px">轉入帳戶</span>';
      html += `<select data-i="${i}" data-f="to" class="fsel">${toOpts}</select>`;
      html += '</div>';
      html += `<input type="number" placeholder="金額" value="${it.amount||''}" data-i="${i}" data-f="amount" inputmode="decimal" style="flex:1;color:var(--acc);margin-left:8px">`;
      if(S.addItems.length>1) html += `<button class="item-del" data-i="${i}">✕</button>`;
      row.innerHTML = html;
    } else if(S.addType==='income'){
      const catName=it.categoryName||'分類';
      row.innerHTML=`
        <div style="flex:1.2;display:flex;flex-direction:column;gap:6px">
          <button class="cat-btn" data-i="${i}" style="text-align:left;color:var(--t2)">${catName}</button>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" placeholder="備註" value="${it.note||''}" data-i="${i}" data-f="note" style="flex:1;text-align:left;color:var(--t2)" inputmode="text">
          </div>
        </div>
        <span style="color:var(--t3);font-size:11px;flex-shrink:0">×</span>
        <input type="number" placeholder="數量" value="${it.qty||1}" data-i="${i}" data-f="qty" inputmode="decimal" style="flex:1">
        <span style="color:var(--t3);font-size:11px;flex-shrink:0">@</span>
        <input type="number" placeholder="金額" value="${it.price||''}" data-i="${i}" data-f="price" inputmode="decimal" style="flex:1.5;color:var(--acc)">
        ${S.addItems.length>1?`<button class="item-del" data-i="${i}">✕</button>`:''}`;
    } else if(S.addType==='adjust'){
      const accId=document.getElementById('f-acc')?.value;
      const accObj=(S.cfg.accounts||[]).find(a=>a.id===accId);
      const currentBal=accObj?fmt(accObj.balance||0):'0';
      row.innerHTML=`
        <div style="flex:1;display:flex;flex-direction:column;">
          <span style="font-size:11px;color:var(--t3);margin-bottom:2px">調整後餘額</span>
          <input type="number" placeholder="新餘額" value="${it.amount||''}" data-i="${i}" data-f="amount" inputmode="decimal" style="width:100%;color:var(--acc)">
        </div>
        <div style="font-size:11px;color:var(--t3);margin-left:10px;white-space:nowrap;">當前: ${currentBal}</div>`;
    } else {
      const catName=it.categoryName||'分類';
      row.innerHTML=`
        <div style="flex:1.2;display:flex;flex-direction:column;gap:6px">
          <button class="cat-btn" data-i="${i}" style="text-align:left;color:var(--t2)">${catName}</button>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" placeholder="備註" value="${it.note}" data-i="${i}" data-f="note" style="flex:1;text-align:left;color:var(--t2)" inputmode="text">
          </div>
        </div>
        <span style="color:var(--t3);font-size:11px;flex-shrink:0">×</span>
        <input type="number" placeholder="數量" value="${it.qty}" data-i="${i}" data-f="qty" inputmode="decimal" style="flex:1">
        <span style="color:var(--t3);font-size:11px;flex-shrink:0">@</span>
        <input type="number" placeholder="單價" value="${it.price}" data-i="${i}" data-f="price" inputmode="decimal" style="flex:1.5;color:var(--acc)">
        ${S.addItems.length>1?`<button class="item-del" data-i="${i}">✕</button>`:''}`;
    }
    list.appendChild(row);

    // place note-tag selector outside the item row
    if(S.addType==='expense' || S.addType==='income'){
      const noteRow=document.createElement('div');
      noteRow.className='item-note-tags-row';
      noteRow.innerHTML=`<div id="item-note-tags-${i}" class="item-note-tags"></div>`;
      list.appendChild(noteRow);
      renderItemNoteTags(i);
    }
  });
  // bind events
  list.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{
    const it=S.addItems[+inp.dataset.i];
    const f=inp.dataset.f;
    if(S.addType==='transfer' && f==='amount') it.amount=inp.value;
    else it[f]=inp.value;
    calcTotal();
    if(f==='note') renderItemNoteTags(+inp.dataset.i);
  }));
  // also track selects (used by transfer rows)
  list.querySelectorAll('select').forEach(sel=>{
    sel.addEventListener('change',()=>{
      const it=S.addItems[+sel.dataset.i];
      const f=sel.dataset.f;
      it[f]=sel.value;
      calcTotal();
    });
  });
  list.querySelectorAll('.cat-btn').forEach(btn=>btn.addEventListener('click',()=>{
    S.selItemForCat=+btn.dataset.i;
    renderModalCats(S.addType);
    document.getElementById('cat-section').style.display='block';
  }));
  list.querySelectorAll('.item-del').forEach(btn=>btn.addEventListener('click',()=>{
    S.addItems.splice(+btn.dataset.i,1); renderAddItems(); calcTotal();
  }));
}
function calcTotal(){
  let t=0;
  if(S.addType==='transfer'){
    t=S.addItems.reduce((s,it)=>s+parseFloat(it.amount||0),0);
  } else if(S.addType==='income'){
    t=S.addItems.reduce((s,it)=>s+(parseFloat(it.qty)||1)*(parseFloat(it.price)||0),0);
  } else if(S.addType==='adjust'){
    t=S.addItems.reduce((s,it)=>s+parseFloat(it.amount||0),0);
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
      total=S.addItems.reduce((s,it)=>s+parseFloat(it.amount||0),0);
      if(!total){ toast('請輸入金額'); return; }
      if(!S.transferCat){ toast('請選擇轉帳類別'); return; }
      for(const it of S.addItems){ if(!it.from||!it.to){toast('請選擇轉出與轉入帳戶'); return;} }
    } else if(S.addType==='adjust'){
      total = parseFloat(S.addItems[0]?.amount||0);
      if(isNaN(total)){ toast('請輸入金額'); return; }
      const accId=document.getElementById('f-acc').value;
      if(!accId){ toast('請選擇帳戶'); return; }
    } else {
      total=S.addItems.reduce((s,it)=>s+(parseFloat(it.qty)||1)*(parseFloat(it.price)||0),0);
      if(!total){ toast('請輸入金額'); return; }
      for(const it of S.addItems){ if(!it.category){ toast('請為每項選擇分類'); return; }}
    }

    let note=document.getElementById('f-note').value;
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
      const accId = payload.account;
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
          document.getElementById('sub-title').textContent=it.name;
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
    await renderPiggyList(el);   // 確保列表頁使用最新後端資料
  } else if (_advMode === 'budget') {
    renderBudgetList(el);
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
function renderBudgetList(el){
  const data=advLoad('budget');
  const cfg=data[0]||{};
  const cats=flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]);
  const thisMonth=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
  el.innerHTML='<div style="padding:8px 0">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
    +'<div style="font-size:13px;font-weight:600;color:var(--t1);">'+thisMonth.replace('-','年')+'月預算</div>'
    +'<button onclick="openBudgetForm()" style="padding:5px 12px;border-radius:999px;background:var(--acc-d);color:var(--acc);border:1px solid var(--acc);font-size:12px;cursor:pointer;">✎ 編輯</button>'
    +'</div>'
    +(cfg.savings?'<div class="rpt-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">'
    +'<span style="font-weight:600;">💰 儲蓄目標</span>'
    +'<span style="font-family:var(--mono);color:var(--acc);font-weight:700;">NT$ '+fmt(cfg.savings)+'</span></div>':'')
    +(Object.keys(cfg.cats||{}).map(cid=>{
        const c=cats.find(x=>x.id===cid)||{name:cid,color:'#8B909A'};
        const budAmt=cfg.cats[cid];
        return '<div class="rpt-card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">'
          +'<div style="display:flex;align-items:center;gap:8px;">'
          +(c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:22px;height:22px;border-radius:5px;object-fit:cover;">'
            :'<span style="width:10px;height:10px;border-radius:50%;background:'+(c.color||'#8B909A')+';flex-shrink:0;display:inline-block;"></span>')
          +'<span>'+c.name+'</span></div>'
          +'<span style="font-family:var(--mono);color:var(--red);">NT$ '+fmt(budAmt)+'</span></div>';
    }).join('')||'<div class="empty-tip">尚未設定類別預算</div>')
    +'</div>';
}

function openBudgetForm(){
  const data=advLoad('budget');
  const cfg=data[0]||{cats:{}};
  const cats=flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]);
  let rows=cats.map(c=>'<div class="fg" style="margin-bottom:8px;">'
    +'<label style="display:flex;align-items:center;gap:6px;">'
    +(c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:18px;height:18px;border-radius:4px;object-fit:cover;">'
      :'<span style="width:10px;height:10px;border-radius:50%;background:'+(c.color||'#8B909A')+';display:inline-block;"></span>')
    +c.name+'</label>'
    +'<input type="number" class="finp" id="bcat-'+c.id+'" value="'+(cfg.cats&&cfg.cats[c.id]||'')+'" placeholder="0（留空=不限）" inputmode="decimal">'
    +'</div>').join('');
  const body=document.getElementById('adv-body');
  body.innerHTML='<div style="padding:8px 0">'
    +'<div class="fg"><label>💰 儲蓄金額</label><input type="number" class="finp" id="b-savings" value="'+(cfg.savings||'')+'" placeholder="0" inputmode="decimal"></div>'
    +'<div style="font-size:12px;color:var(--t3);margin-bottom:10px;">各類別預算（留空=不限制）</div>'
    +rows
    +'<div class="acc-btns" style="margin-top:16px;">'
    +'<button class="acc-btn" onclick="renderAdvBody()">取消</button>'
    +'<button class="acc-btn ok" onclick="saveBudget()">儲存</button>'
    +'</div></div>';
}
function saveBudget(){
  const cats=flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]);
  const savings=parseFloat(document.getElementById('b-savings').value)||0;
  const catBud={};
  cats.forEach(c=>{
    const v=parseFloat(document.getElementById('bcat-'+c.id)?.value||0);
    if(v>0) catBud[c.id]=v;
  });
  advSave('budget',[{savings,cats:catBud}]);
  renderAdvBody(); toast('預算已儲存');
}

/* ─── 固定支出／收入 ─── */
function renderRecurringList(el){
  const items=advLoad('recurring');
  if(!items.length){
    el.innerHTML='<div class="empty-tip" style="padding:32px 0">尚無固定項目<br>按 ＋ 新增</div>';
    return;
  }
  const cats=[...flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]),...flattenCats(S.cfg.categories&&S.cfg.categories.income||[])];
  el.innerHTML=items.map((r,i)=>{
    const c=cats.find(x=>x.id===r.category)||{name:r.category||'',color:'#8B909A'};
    const typeColor=r.type==='expense'?'var(--red)':'var(--acc)';
    const sign=r.type==='expense'?'-':'+';
    return '<div class="rpt-card" style="margin-bottom:10px;">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;">'
      +'<div style="flex:1;min-width:0;">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
      +(c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:24px;height:24px;border-radius:6px;object-fit:cover;">':'<span style="width:10px;height:10px;border-radius:50%;background:'+(c.color||'#8B909A')+';flex-shrink:0;display:inline-block;"></span>')
      +'<span style="font-weight:600;font-size:14px;">'+c.name+'</span>'
      +'<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:'+(r.type==='expense'?'rgba(220,38,38,0.1)':'rgba(22,163,74,0.1)')+';color:'+typeColor+';">'+(r.type==='expense'?'支出':'收入')+'</span>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--t3);">每月 '+r.day+' 日 '+r.time+(r.note?' · '+r.note:'')+'</div>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px;">'
      +'<span style="font-family:var(--mono);font-weight:700;color:'+typeColor+';">'+sign+''+fmt(r.amount)+'</span>'
      +'<button onclick="deleteRecurring('+i+')" style="width:28px;height:28px;border-radius:50%;background:var(--red-d);color:var(--red);border:none;font-size:12px;cursor:pointer;">✕</button>'
      +'</div></div></div>';
  }).join('');
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

function openRecurringForm(){
  _recCatSel=''; _recType='expense'; _recCatPath=[];
  const body=document.getElementById('adv-body');
  body.innerHTML='<div style="padding:8px 0">'
    +'<div class="fg"><label>類型</label>'
    +'<div class="type-tabs" style="margin-bottom:0">'
    +'<button class="type-tab on expense" id="rec-t-exp">支出</button>'
    +'<button class="type-tab" id="rec-t-inc">收入</button></div></div>'
    +'<div class="fg"><label>類別</label>'
    +'<div id="rec-cat-grid" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>'
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
    +'<option value="day">天</option>'
    +'<option value="week">週</option>'
    +'<option value="month" selected>月</option>'
    +'<option value="year">年</option>'
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

function saveRecurring(){
  const type=_recType;
  const category=_recCatSel;
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
  items.push({type,category,amount,startdate,time,periodN,periodUnit,note,endDate,lastRun:''});
  advSave('recurring',items); renderAdvBody(); toast('已新增固定項目');
  // 立即檢查是否需要執行
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

// 開啟 App 時自動檢查固定項目，到期就建立記錄
async function checkRecurring(){
  const items=advLoad('recurring');
  const today=todayStr();
  let changed=false;
  for(let i=0;i<items.length;i++){
    const r=items[i];
    let due=r.lastRun?nextRecurringDate(r):r.startdate;
    while(due<=today){
      // 建立記錄
      try{
        const cats=S.cfg?[...flattenCats(S.cfg.categories?.expense||[]),...flattenCats(S.cfg.categories?.income||[])]:[];
        const catObj=cats.find(function(c){return c.id===r.category;})||{id:r.category};
        const payload={
          type:r.type, amount:r.amount, date:due, time:r.time||'00:00',
          note:r.note||(r.periodN===1?'固定':'每'+r.periodN+(r.periodUnit==='day'?'天':r.periodUnit==='week'?'週':r.periodUnit==='month'?'月':'年')),
          category:r.category, account:'',
          items:[{category:r.category,qty:1,price:r.amount,note:r.note||''}]
        };
        await api('/api/records',{method:'POST',body:JSON.stringify(payload)});
        items[i].lastRun=due; changed=true;
        due=nextRecurringDate(items[i]);
      }catch(e){ break; }
    }
  }
  if(changed){ advSave('recurring',items); await renderHome(); toast('固定項目已自動記帳',3000); }
}

function renderRecurringList(el){
  const items=advLoad('recurring');
  if(!items.length){
    el.innerHTML='<div class="empty-tip" style="padding:32px 0">尚無固定項目<br>按 ＋ 新增</div>';
    return;
  }
  const cats=[...flattenCats(S.cfg.categories&&S.cfg.categories.expense||[]),...flattenCats(S.cfg.categories&&S.cfg.categories.income||[])];
  const unitLabel={day:'天',week:'週',month:'月',year:'年'};
  el.innerHTML=items.map(function(r,i){
    const c=cats.find(function(x){return x.id===r.category;})||{name:r.category||'',color:'#8B909A'};
    const typeColor=r.type==='expense'?'var(--red)':'var(--acc)';
    const sign=r.type==='expense'?'-':'+';
    const periodStr='每'+( r.periodN&&r.periodN>1?r.periodN:'')+(unitLabel[r.periodUnit||'month']||'月');
    const nextDue=nextRecurringDate(r);
    return '<div class="rpt-card" style="margin-bottom:10px;">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;">'
      +'<div style="flex:1;min-width:0;">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
      +(c.icon?'<img src="'+resolveIconUrl(c.icon)+'" style="width:24px;height:24px;border-radius:6px;object-fit:cover;">':'<span style="width:10px;height:10px;border-radius:50%;background:'+(c.color||'#8B909A')+';flex-shrink:0;display:inline-block;"></span>')
      +'<span style="font-weight:600;font-size:14px;">'+c.name+'</span>'
      +'<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:'+(r.type==='expense'?'rgba(220,38,38,0.1)':'rgba(22,163,74,0.1)')+';color:'+typeColor+';">'+periodStr+'</span>'
      +'</div>'
      +'<div style="font-size:12px;color:var(--t3);">下次：'+nextDue+' '+r.time+(r.note?' · '+r.note:'')+'</div>'
      +(r.endDate?'<div style="font-size:11px;color:var(--t3);margin-top:2px;">截止：'+r.endDate+'</div>':'')
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px;">'
      +'<span style="font-family:var(--mono);font-weight:700;color:'+typeColor+';">'+sign+''+fmt(r.amount)+'</span>'
      +'<button onclick="deleteRecurring('+i+')" class="row-del-btn">✕</button>'
      +'</div></div></div>';
  }).join('');
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
  if (!record) {
    toast('找不到記錄');
    return;
  }

  const detailBox = document.getElementById('detail-box');
  const body = document.getElementById('detail-body');
  const isPiggy = record.type === 'piggy';

  // 標題處理
  let titleText = '記錄資訊';
  if (isPiggy) titleText = '存錢筒';

  let mainHtml = '';
  if (isPiggy) {
    mainHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="/icon/存錢筒.png" width="36" height="36" style="object-fit:contain;flex-shrink:0;">
          <span style="font-size:18px;font-weight:700;color:#F59E0B;">存錢筒</span>
        </div>
        <div style="font-family:var(--mono);font-size:22px;font-weight:700;color:#F59E0B;">+${fmt(record.amount)}</div>
      </div>`;
  } else {
    function flatCats(arr){ return (arr||[]).reduce((a,c)=>{a.push(c);if(c.children)a=a.concat(flatCats(c.children));return a;},[]);}
    const allCats=[...flatCats(S.cfg.categories?.expense||[]),...flatCats(S.cfg.categories?.income||[]),...flatCats(S.cfg.categories?.transfer||[])];
    const cat = allCats.find(c=>c.id===record.category) || {name:record.category||'未分類',color:'#8B909A'};
    const iconHtml = cat.icon
      ? `<img src="${resolveIconUrl(cat.icon)}" width="28" height="28" style="object-fit:cover;border-radius:6px;flex-shrink:0;">`
      : `<div style="width:28px;height:28px;border-radius:6px;background:${cat.color};flex-shrink:0;"></div>`;
    const amtColor = record.type==='expense'?'var(--red)':record.type==='income'?'var(--acc)':record.type==='transfer'?'var(--blue)':'#9B5DE5';
    const amtSign  = record.type==='expense'?'-':record.type==='income'?'+':'⇄';
    const itemDesc = (record.items||[]).length
      ? record.items.map(it=>{
          const c=allCats.find(x=>x.id===it.category)||{name:it.category||''};
          const nm=c.name||it.category||'';
          const note=it.note?`(${it.note})`:'';
          if(record.type==='transfer') return `${nm}`;
          if(record.type==='income'||record.type==='expense') return `<span class="tag" style="background:${c.color||'#8B909A'};color:#fff;padding:2px 8px;border-radius:12px;font-size:12px;">${nm}</span>${note}(${it.qty||1})×(${fmt(it.price||0)})`;
          return nm;
        }).join(' ') : '';
    mainHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;">${iconHtml}<span style="font-size:18px;font-weight:700;">${cat.name}</span></div>
        <div style="font-family:var(--mono);font-size:22px;font-weight:700;color:${amtColor};">${amtSign}${fmt(record.amount)}</div>
      </div>
      ${itemDesc ? `<div style="background:var(--sf2);padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;line-height:1.8;">${itemDesc}</div>` : ''}
    `;
  }

  // 其他資訊區
  const accName = (S.cfg.accounts || []).find(a => a.id === record.account)?.name || '未設定';
  const toAccName = (record.type==='transfer' && record.to_account) ? (S.cfg.accounts || []).find(a => a.id === record.to_account)?.name || '' : '';

  body.innerHTML = `
    ${mainHtml}
    <div style="border-top:1px solid var(--border);padding-top:12px;">
      <div class="detail-infobox">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--t3);">帳戶</span>
          <span style="font-weight:500;">${accName}</span>
        </div>
        ${toAccName ? `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--t3);">轉入帳戶</span>
          <span style="font-weight:500;">${toAccName}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--t3);">日期</span>
          <span style="font-weight:500;">${record.date}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--t3);">時間</span>
          <span style="font-weight:500;">${record.time || '—'}</span>
        </div>
        ${record.note ? `
        <div style="display:flex;justify-content:space-between;padding:8px 0;">
          <span style="color:var(--t3);">備註</span>
          <span style="font-weight:500;">${record.note}</span>
        </div>` : ''}
      </div>
    </div>
  `;

  // 開啟詳情頁
  document.getElementById('detail-page').classList.add('show');
  detailBox.querySelector('h2').textContent = titleText;

  // 編輯按鈕
  const editBtn = detailBox.querySelector('#detail-edit-btn');
  if (editBtn) {
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
    amtRow.innerHTML = '<div class="fg" style="margin-bottom:10px;"><label style="font-size:11px;color:var(--t3);letter-spacing:.7px;">存入金額</label>' +
      '<input type="number" class="finp" id="piggy-amount-input" placeholder="0" inputmode="decimal" oninput="updatePiggyTotal()"></div>' +
      '<div class="fg"><label style="font-size:11px;color:var(--t3);letter-spacing:.7px;">帳戶</label>' +
      '<select class="fsel" id="piggy-acc-sel">'+accOpts+'</select></div>';
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
