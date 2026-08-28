/* Druckkalkulator – Logik
   Speicher-Adapter: nutzt window.storage, falls vorhanden (Claude-Artefakt),
   sonst localStorage (z. B. beim Ausführen als eigenständige Datei / GitHub Pages). */
const storage = window.storage ? window.storage : {
  async get(key){ const v = localStorage.getItem(key); return v===null ? null : {key, value:v}; },
  async set(key, value){ localStorage.setItem(key, value); return {key, value}; },
  async delete(key){ localStorage.removeItem(key); return {key, deleted:true}; },
  async list(prefix){
    const keys = Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix));
    return {keys};
  }
};

const MATERIALS = ["PLA","PETG","ABS","ASA","TPU","Nylon","PC","PVA","Resin","Sonstiges"];

let filamente = [];              // [{id, material, farbe, preis, farbHex}]
let allgemein = { strompreis:0.32, leistung:150, wartung:0.5, arbeit:20 };
let mengenrabatt = [];           // [{id, abStueck, rabatt}]
let positionen = [];             // [{id, name, stueckzahl, druckzeit, arbeitszeit, slots:[{filamentId,gramm}x4]}]

const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
const uid = p => p + Date.now() + Math.floor(Math.random()*1000);

// ---------- Storage ----------
async function loadData(){
  try{
    const f = await storage.get('filamente', false);
    filamente = f ? JSON.parse(f.value) : [];
  }catch(e){ filamente = []; }
  try{
    const g = await storage.get('allgemein', false);
    if(g) allgemein = JSON.parse(g.value);
  }catch(e){ /* Standardwerte bleiben */ }
  try{
    const t = await storage.get('mengenrabatt', false);
    mengenrabatt = t ? JSON.parse(t.value) : [];
  }catch(e){ mengenrabatt = []; }

  if(!positionen.length) addPosition();

  renderFilamentList();
  renderGeneralInputs();
  renderTierList();
  renderPositionen();
  updateTierHint();
  $('#statusline').textContent = 'bereit';
}

async function saveFilamente(){
  try{ await storage.set('filamente', JSON.stringify(filamente), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveAllgemein(){
  try{
    await storage.set('allgemein', JSON.stringify(allgemein), false);
    flashSaved();
  }catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveTiers(){
  try{ await storage.set('mengenrabatt', JSON.stringify(mengenrabatt), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
function flashSaved(){
  const el = $('#genSaveMsg');
  el.classList.add('show');
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(()=>el.classList.remove('show'),1200);
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    $('#view-'+tab.dataset.view).classList.add('active');
  });
});

// ---------- Farbe -> Hex (grobe Zuordnung für Swatch) ----------
function guessHex(name){
  const n = (name||'').toLowerCase();
  const map = {schwarz:'#1c1c1c',weiß:'#f2f2f2',weiss:'#f2f2f2',grau:'#888',rot:'#d43b3b',
    blau:'#3b6fd4',gelb:'#e6c22d',orange:'#e0792f',grün:'#3fa15b',gruen:'#3fa15b',
    pink:'#e05ba0',lila:'#8b5fbf',violett:'#8b5fbf',braun:'#7a5230',transparent:'#cfd3d8',
    gold:'#c9a441',silber:'#b9bcc2',natur:'#e8dcc4'};
  for(const k in map){ if(n.includes(k)) return map[k]; }
  return '#666a75';
}

// ---------- Stammdaten: Filamente ----------
function renderFilamentList(){
  const box = $('#filamentList');
  box.innerHTML = '';
  $('#filamentEmpty').style.display = filamente.length ? 'none' : 'block';

  filamente.forEach(f=>{
    const row = document.createElement('div');
    row.className = 'fil-row';
    row.innerHTML = `
      <span class="swatch" style="background:${f.farbHex||guessHex(f.farbe)}"></span>
      <div class="field">
        <label>Material</label>
        <select data-id="${f.id}" data-field="material">
          ${MATERIALS.map(m=>`<option value="${m}" ${m===f.material?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Farbe</label>
        <input data-id="${f.id}" data-field="farbe" value="${f.farbe||''}" placeholder="z. B. Schwarz">
      </div>
      <div class="field">
        <label>€ / kg</label>
        <input data-id="${f.id}" data-field="preis" type="number" min="0" step="0.5" value="${f.preis||0}">
      </div>
      <button class="icon-btn" data-del="${f.id}" title="Filament löschen">✕</button>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('input', e=>{
      const f = filamente.find(x=>x.id===e.target.dataset.id);
      const field = e.target.dataset.field;
      f[field] = field==='preis' ? parseFloat(e.target.value)||0 : e.target.value;
      if(field==='farbe') f.farbHex = guessHex(f.farbe);
      saveFilamente();
      renderPositionen();
      if(field==='farbe') renderFilamentList();
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      filamente = filamente.filter(x=>x.id!==btn.dataset.del);
      positionen.forEach(p=>{ p.slots = p.slots.map(s=> s && s.filamentId===btn.dataset.del ? {filamentId:'',gramm:''} : s); });
      saveFilamente();
      renderFilamentList();
      renderPositionen();
    });
  });
}

$('#addFilamentBtn').addEventListener('click', ()=>{
  filamente.push({id:uid('f'), material:'PLA', farbe:'', preis:22, farbHex:'#666a75'});
  saveFilamente();
  renderFilamentList();
  renderPositionen();
});

// ---------- Stammdaten: Allgemeine Kosten ----------
function renderGeneralInputs(){
  $('#genStrompreis').value = allgemein.strompreis;
  $('#genLeistung').value = allgemein.leistung;
  $('#genWartung').value = allgemein.wartung;
  $('#genArbeit').value = allgemein.arbeit;
}
['genStrompreis','genLeistung','genWartung','genArbeit'].forEach(id=>{
  $('#'+id).addEventListener('change', ()=>{
    allgemein.strompreis = parseFloat($('#genStrompreis').value)||0;
    allgemein.leistung   = parseFloat($('#genLeistung').value)||0;
    allgemein.wartung    = parseFloat($('#genWartung').value)||0;
    allgemein.arbeit     = parseFloat($('#genArbeit').value)||0;
    saveAllgemein();
  });
});

// ---------- Stammdaten: Mengenrabatt-Stufen ----------
function renderTierList(){
  const box = $('#tierList');
  box.innerHTML = '';
  $('#tierEmpty').style.display = mengenrabatt.length ? 'none' : 'block';

  const sorted = [...mengenrabatt].sort((a,b)=>a.abStueck-b.abStueck);
  sorted.forEach(t=>{
    const row = document.createElement('div');
    row.className = 'disc-row';
    row.innerHTML = `
      <div class="field">
        <label>Ab Stückzahl</label>
        <input data-id="${t.id}" data-field="abStueck" type="number" min="2" step="1" value="${t.abStueck}">
      </div>
      <div class="field">
        <label>Rabatt (%)</label>
        <input data-id="${t.id}" data-field="rabatt" type="number" min="0" max="100" step="1" value="${t.rabatt}">
      </div>
      <button class="icon-btn" data-del="${t.id}" title="Stufe löschen">✕</button>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('input', e=>{
      const t = mengenrabatt.find(x=>x.id===e.target.dataset.id);
      t[e.target.dataset.field] = parseFloat(e.target.value)||0;
      saveTiers();
      updateTierHint();
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      mengenrabatt = mengenrabatt.filter(x=>x.id!==btn.dataset.del);
      saveTiers();
      renderTierList();
      updateTierHint();
    });
  });
}

$('#addTierBtn').addEventListener('click', ()=>{
  mengenrabatt.push({id:uid('t'), abStueck: mengenrabatt.length ? Math.max(...mengenrabatt.map(t=>t.abStueck))+5 : 5, rabatt:5});
  saveTiers();
  renderTierList();
});

function findTier(stueckzahl){
  const passend = mengenrabatt.filter(t=>stueckzahl >= t.abStueck).sort((a,b)=>b.abStueck-a.abStueck);
  return passend[0] || null;
}

function totalStueckzahl(){
  return positionen.reduce((sum,p)=> sum + (parseInt(p.stueckzahl)||0), 0);
}

function updateTierHint(){
  const stueckzahl = totalStueckzahl();
  const tier = findTier(stueckzahl);
  const hint = $('#tierHint');
  if(tier){
    hint.innerHTML = `Gesamt-Stückzahl im Auftrag: ${stueckzahl}. Automatischer Mengenrabatt aktiv: <span class="tier-tag">ab ${tier.abStueck} Stück · −${tier.rabatt}%</span>`;
  }else if(mengenrabatt.length){
    const next = [...mengenrabatt].sort((a,b)=>a.abStueck-b.abStueck).find(t=>t.abStueck>stueckzahl);
    hint.textContent = `Gesamt-Stückzahl im Auftrag: ${stueckzahl}. ` + (next ? `Noch kein Rabatt – ab ${next.abStueck} Stück gibt es −${next.rabatt}%.` : 'Kein Mengenrabatt hinterlegt.');
  }else{
    hint.textContent = `Gesamt-Stückzahl im Auftrag: ${stueckzahl}. Keine Rabattstufen hinterlegt (unter „Stammdaten“ anlegen).`;
  }
}

// ---------- Kalkulation: Positionen (Produkte) ----------
function addPosition(prefill){
  positionen.push(Object.assign({
    id: uid('p'),
    name: '',
    stueckzahl: 1,
    druckzeit: 0,
    arbeitszeit: 0,
    slots: [null,null,null,null]
  }, prefill||{}));
}

function renderPositionen(){
  const box = $('#positionList');
  box.innerHTML = '';

  positionen.forEach((pos, idx)=>{
    const card = document.createElement('div');
    card.className = 'position';
    card.innerHTML = `
      <div class="position-head">
        <span class="pos-tag">POSITION ${idx+1}</span>
        <button class="icon-btn" data-delpos="${pos.id}" title="Position löschen">✕</button>
      </div>
      <div class="row g3" style="margin-bottom:12px;">
        <div class="field">
          <label>Produktname</label>
          <input data-pos="${pos.id}" data-pfield="name" value="${pos.name||''}" placeholder="z. B. Halterung V2">
        </div>
        <div class="field">
          <label>Stückzahl</label>
          <input data-pos="${pos.id}" data-pfield="stueckzahl" type="number" min="1" step="1" value="${pos.stueckzahl}">
        </div>
        <div class="field">
          <label>—</label>
        </div>
      </div>
      <div class="row g2" style="margin-bottom:12px;">
        <div class="field">
          <label>Druckzeit gesamt (Std.)</label>
          <input data-pos="${pos.id}" data-pfield="druckzeit" type="number" min="0" step="0.1" value="${pos.druckzeit}">
        </div>
        <div class="field">
          <label>Arbeitszeit gesamt (Std.)</label>
          <input data-pos="${pos.id}" data-pfield="arbeitszeit" type="number" min="0" step="0.1" value="${pos.arbeitszeit}">
        </div>
      </div>
      <div class="pos-slots" data-slotbox="${pos.id}"></div>
    `;
    box.appendChild(card);
    renderSlotsForPosition(pos, card.querySelector(`[data-slotbox="${pos.id}"]`));
  });

  box.querySelectorAll('[data-pfield]').forEach(el=>{
    el.addEventListener('input', e=>{
      const pos = positionen.find(p=>p.id===e.target.dataset.pos);
      const field = e.target.dataset.pfield;
      pos[field] = (field==='stueckzahl'||field==='druckzeit'||field==='arbeitszeit') ? e.target.value : e.target.value;
      if(field==='stueckzahl') updateTierHint();
    });
  });
  box.querySelectorAll('[data-delpos]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      positionen = positionen.filter(p=>p.id!==btn.dataset.delpos);
      if(!positionen.length) addPosition();
      renderPositionen();
      updateTierHint();
    });
  });

  if(!filamente.length){
    box.insertAdjacentHTML('beforeend', '<p class="empty">Lege zuerst Filamente unter „Stammdaten“ an, um sie hier auszuwählen.</p>');
  }
}

function renderSlotsForPosition(pos, container){
  container.innerHTML = '';
  for(let i=0;i<4;i++){
    const slot = pos.slots[i] || {filamentId:'', gramm:''};
    const wrap = document.createElement('div');
    wrap.className = 'slot';
    wrap.innerHTML = `
      <div class="slot-title">FILAMENT ${i+1}${i===0?' (mind. 1 erforderlich)':' — optional'}</div>
      <div class="row g2">
        <div class="field">
          <label>Auswahl</label>
          <select data-pos="${pos.id}" data-slot="${i}" data-sfield="filamentId">
            <option value="">— keins —</option>
            ${filamente.map(f=>`<option value="${f.id}" ${f.id===slot.filamentId?'selected':''}>${f.material} · ${f.farbe||'ohne Farbname'} (${fmt(f.preis)} €/kg)</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Menge (Gramm)</label>
          <input data-pos="${pos.id}" data-slot="${i}" data-sfield="gramm" type="number" min="0" step="1" value="${slot.gramm}" placeholder="z. B. 45">
        </div>
      </div>
    `;
    container.appendChild(wrap);
  }
  container.querySelectorAll('select,input').forEach(el=>{
    el.addEventListener('input', e=>{
      const i = parseInt(e.target.dataset.slot);
      const field = e.target.dataset.sfield;
      if(!pos.slots[i]) pos.slots[i] = {filamentId:'',gramm:''};
      pos.slots[i][field] = e.target.value;
    });
  });
}

$('#addPositionBtn').addEventListener('click', ()=>{
  addPosition();
  renderPositionen();
  updateTierHint();
});
$('#clearPositionsBtn').addEventListener('click', ()=>{
  positionen = [];
  addPosition();
  renderPositionen();
  updateTierHint();
  $('#resultPanel').style.display = 'none';
});

// ---------- Berechnung (gemeinsam für Anzeige + CSV-Export) ----------
function computeQuote(){
  const marginPct = parseFloat($('#margin').value)||0;
  const extraDiscountPct = parseFloat($('#extraDiscount').value)||0;
  const jobName = $('#jobName').value.trim();

  let materialTotal=0, stromTotal=0, wartungTotal=0, arbeitTotal=0;
  const posLines = [];

  positionen.forEach((pos,idx)=>{
    const stueckzahl = parseInt(pos.stueckzahl)||1;
    const druckzeit = parseFloat(pos.druckzeit)||0;
    const arbeitszeit = parseFloat(pos.arbeitszeit)||0;

    const usedSlots = pos.slots.filter(s=> s && s.filamentId && parseFloat(s.gramm)>0);
    const material = usedSlots.reduce((sum,s)=>{
      const f = filamente.find(x=>x.id===s.filamentId);
      if(!f) return sum;
      return sum + (parseFloat(s.gramm)/1000) * f.preis;
    },0);
    const strom = (allgemein.leistung/1000) * druckzeit * allgemein.strompreis;
    const wartung = allgemein.wartung * druckzeit;
    const arbeit = allgemein.arbeit * arbeitszeit;
    const subtotal = material+strom+wartung+arbeit;

    materialTotal += material; stromTotal += strom; wartungTotal += wartung; arbeitTotal += arbeit;

    posLines.push({
      nr: idx+1,
      name: pos.name || 'Ohne Namen',
      stueckzahl,
      subtotal,
      proStueck: subtotal/stueckzahl
    });
  });

  const sumStueckzahl = totalStueckzahl();
  const zwischensumme = materialTotal + stromTotal + wartungTotal + arbeitTotal;
  const gewinn = zwischensumme * (marginPct/100);
  const nachGewinn = zwischensumme + gewinn;

  const tier = findTier(sumStueckzahl);
  const tierPct = tier ? tier.rabatt : 0;
  const totalDiscountPct = tierPct + extraDiscountPct;
  const rabattBetrag = nachGewinn * (totalDiscountPct/100);
  const gesamt = nachGewinn - rabattBetrag;

  return {jobName, posLines, materialTotal, stromTotal, wartungTotal, arbeitTotal,
    zwischensumme, marginPct, gewinn, tierPct, extraDiscountPct, totalDiscountPct,
    rabattBetrag, gesamt, sumStueckzahl};
}

$('#calcBtn').addEventListener('click', ()=>{
  const q = computeQuote();

  let html = '';
  if(q.jobName) html += `<h2 style="margin-bottom:14px;">${q.jobName}</h2>`;

  html += `<h3>Positionen</h3>`;
  html += q.posLines.map(l=>`<div class="pos-line"><span>${l.nr}. ${l.name} (${l.stueckzahl} Stk.)</span><span>${fmt(l.subtotal)} € · ${fmt(l.proStueck)} €/Stk.</span></div>`).join('');

  html += `<h3>Kosten gesamt</h3>`;
  html += `<div class="line"><span>Materialkosten</span><span>${fmt(q.materialTotal)} €</span></div>`;
  html += `<div class="line"><span>Stromkosten</span><span>${fmt(q.stromTotal)} €</span></div>`;
  html += `<div class="line"><span>Wartung & Verschleiß</span><span>${fmt(q.wartungTotal)} €</span></div>`;
  html += `<div class="line"><span>Arbeitskosten</span><span>${fmt(q.arbeitTotal)} €</span></div>`;
  html += `<div class="line"><span>Zwischensumme</span><span>${fmt(q.zwischensumme)} €</span></div>`;
  if(q.marginPct>0) html += `<div class="line"><span>Gewinnaufschlag (${q.marginPct}%)</span><span>${fmt(q.gewinn)} €</span></div>`;
  if(q.totalDiscountPct>0){
    let label = 'Nachlass';
    if(q.tierPct>0 && q.extraDiscountPct>0) label = `Nachlass (Mengenrabatt ${q.tierPct}% + Zusatz ${q.extraDiscountPct}%)`;
    else if(q.tierPct>0) label = `Mengenrabatt (${q.tierPct}%)`;
    else label = `Zusätzlicher Nachlass (${q.extraDiscountPct}%)`;
    html += `<div class="line"><span>${label}</span><span>−${fmt(q.rabattBetrag)} €</span></div>`;
  }
  html += `<div class="total"><span>Gesamtpreis (${q.sumStueckzahl} Stk.)</span><span>${fmt(q.gesamt)} €</span></div>`;
  if(q.sumStueckzahl>0) html += `<div class="line"><span>Ø Preis / Stück</span><span>${fmt(q.gesamt/q.sumStueckzahl)} €</span></div>`;

  const panel = $('#resultPanel');
  panel.innerHTML = html;
  panel.style.display = 'block';
  panel.scrollIntoView({behavior:'smooth', block:'nearest'});
});

// ---------- CSV-Export (Preisangebot) ----------
function csvNum(n){ return n.toFixed(2).replace('.', ','); }
function csvEsc(s){
  s = String(s ?? '');
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

$('#exportCsvBtn').addEventListener('click', ()=>{
  const q = computeQuote();
  const today = new Date().toLocaleDateString('de-DE');
  const rows = [];

  rows.push(['Preisangebot']);
  rows.push(['Auftrag', q.jobName || '']);
  rows.push(['Datum', today]);
  rows.push([]);
  rows.push(['Pos.','Produkt','Stückzahl','Einzelpreis (€)','Gesamtpreis (€)']);
  q.posLines.forEach(l=>{
    rows.push([l.nr, l.name, l.stueckzahl, csvNum(l.proStueck), csvNum(l.subtotal)]);
  });
  rows.push([]);
  rows.push(['','','','Zwischensumme', csvNum(q.zwischensumme)]);
  if(q.marginPct>0) rows.push(['','','',`Gewinnaufschlag (${q.marginPct}%)`, csvNum(q.gewinn)]);
  if(q.totalDiscountPct>0){
    let label = 'Nachlass';
    if(q.tierPct>0 && q.extraDiscountPct>0) label = `Nachlass (Mengenrabatt ${q.tierPct}% + Zusatz ${q.extraDiscountPct}%)`;
    else if(q.tierPct>0) label = `Mengenrabatt (${q.tierPct}%)`;
    else label = `Zusätzlicher Nachlass (${q.extraDiscountPct}%)`;
    rows.push(['','','',label, '-' + csvNum(q.rabattBetrag)]);
  }
  rows.push(['','','','Gesamtpreis', csvNum(q.gesamt)]);
  if(q.sumStueckzahl>0) rows.push(['','','','Ø Preis / Stück', csvNum(q.gesamt/q.sumStueckzahl)]);

  const csv = '\uFEFF' + rows.map(r=>r.map(csvEsc).join(';')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (q.jobName || 'angebot').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  a.href = url; a.download = `preisangebot_${safeName || 'angebot'}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

loadData();
