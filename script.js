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

// ---------- 3MF-Import (gesliste .gcode.3mf aus Bambu Studio / OrcaSlicer) ----------
function hexDist(a, b){
  if(!a || !b) return 999;
  const pa = [1,3,5].map(i=>parseInt(a.substr(i,2)||'00',16));
  const pb = [1,3,5].map(i=>parseInt(b.substr(i,2)||'00',16));
  return Math.sqrt(pa.reduce((s,v,i)=> s + (v-pb[i])**2, 0));
}

function findFilamentByTypeColor(type, colorHex){
  const sameType = filamente.filter(f => (f.material||'').toLowerCase() === (type||'').toLowerCase());
  const pool = sameType.length ? sameType : filamente;
  if(!pool.length) return null;
  let best = null, bestDist = Infinity;
  pool.forEach(f=>{
    const fHex = f.farbHex || guessHex(f.farbe);
    const d = hexDist(fHex, colorHex);
    if(d < bestDist){ bestDist = d; best = f; }
  });
  // Nur als Treffer werten, wenn Material passt UND Farbe einigermaßen nah ist
  return (sameType.length && bestDist < 60) ? best : null;
}

async function import3MF(file){
  const msg = $('#mf3Msg');
  msg.innerHTML = `<div class="import-msg">Lese ${file.name}…</div>`;
  try{
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const sliceInfoEntry = Object.keys(zip.files).find(k => /metadata\/slice_info\.config$/i.test(k));
    if(!sliceInfoEntry){
      msg.innerHTML = `<div class="import-msg warn">Diese Datei ist noch nicht gesliced (keine Metadata/slice_info.config gefunden). Bitte in Bambu Studio/OrcaSlicer zuerst slicen und über „Datei → Exportieren → Sliced File exportieren“ als .gcode.3mf speichern.</div>`;
      return;
    }

    const sliceXml = await zip.files[sliceInfoEntry].async('text');

    let projectSettings = {};
    const settingsEntry = Object.keys(zip.files).find(k => /metadata\/project_settings\.config$/i.test(k));
    if(settingsEntry){
      try{ projectSettings = JSON.parse(await zip.files[settingsEntry].async('text')); }catch(e){ /* ignorieren */ }
    }

    const plateRegex = /<plate>([\s\S]*?)<\/plate>/g;
    let plateMatch, plateCount = 0;
    const unmatched = new Set();
    const baseName = file.name.replace(/\.gcode\.3mf$|\.3mf$/i, '');

    // leere Standard-Position (unbenutzt) vor dem Import entfernen
    const isEmpty = p => !p.name && !parseFloat(p.druckzeit) && !parseFloat(p.arbeitszeit) && !p.slots.some(s=>s && s.filamentId);
    if(positionen.length === 1 && isEmpty(positionen[0])) positionen = [];

    while((plateMatch = plateRegex.exec(sliceXml)) !== null){
      const content = plateMatch[1];
      const idxMatch = content.match(/<metadata\s+key="index"\s+value="(\d+)"/);
      const predMatch = content.match(/<metadata\s+key="prediction"\s+value="([^"]+)"/);
      const predictionSec = predMatch ? parseFloat(predMatch[1]) : 0;
      const druckzeitH = predictionSec ? +(predictionSec/3600).toFixed(2) : 0;

      const filRegex = /<filament\s+id="(\d+)"[^>]*type="([^"]+)"[^>]*color="([^"]+)"[^>]*used_g="([^"]+)"/g;
      let fm, slots = [null,null,null,null], slotIdx = 0;
      while((fm = filRegex.exec(content)) !== null && slotIdx < 4){
        const type = fm[2], color = fm[3], usedG = parseFloat(fm[4]);
        const match = findFilamentByTypeColor(type, color);
        if(match){
          slots[slotIdx] = {filamentId: match.id, gramm: String(Math.round(usedG*10)/10)};
        } else {
          unmatched.add(`${type} ${color}`);
        }
        slotIdx++;
      }

      plateCount++;
      const plateLabel = plateCount > 1 ? `${baseName} – Platte ${idxMatch ? idxMatch[1] : plateCount}` : baseName;
      addPosition({
        name: plateLabel,
        stueckzahl: 1,
        druckzeit: druckzeitH,
        arbeitszeit: 0,
        slots
      });
    }

    renderPositionen();
    updateTierHint();

    let html = `<div class="import-msg ${unmatched.size?'warn':'ok'}">${plateCount} Position(en) aus „${file.name}“ importiert (Druckzeit + Filamentverbrauch automatisch übernommen). Stückzahl und Arbeitszeit bitte noch prüfen/eintragen.`;
    if(unmatched.size){
      html += `\nNicht zugeordnete Filamente (bitte manuell in der Position auswählen, ggf. erst in Stammdaten anlegen):\n– ${[...unmatched].join('\n– ')}`;
    }
    html += '</div>';
    msg.innerHTML = html;

  }catch(e){
    console.error(e);
    msg.innerHTML = `<div class="import-msg warn">Datei konnte nicht gelesen werden: ${e.message}</div>`;
  }
}

$('#mf3ImportBtn').addEventListener('click', ()=> $('#mf3File').click());
$('#mf3File').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(file) import3MF(file);
  e.target.value = '';
});

// ---------- G-Code-Import (PrusaSlicer / SuperSlicer / OrcaSlicer / Bambu Studio – Klartext) ----------
function parseGcodeTime(str){
  // z. B. "2h 15m 30s" oder "45m 12s" oder "38s"
  let sec = 0;
  const h = str.match(/(\d+)\s*h/); if(h) sec += parseInt(h[1])*3600;
  const m = str.match(/(\d+)\s*m(?!s)/); if(m) sec += parseInt(m[1])*60;
  const s = str.match(/(\d+)\s*s/); if(s) sec += parseInt(s[1]);
  return sec;
}

async function importGcode(file){
  const msg = $('#mf3Msg');
  msg.innerHTML = `<div class="import-msg">Lese ${file.name}…</div>`;
  try{
    const text = await file.text();
    // Kommentare stehen meist in den letzten paar hundert Zeilen (Fußzeile)
    const tailLines = text.split(/\r?\n/).slice(-400).join('\n');
    const fullForSearch = tailLines.length > 500 ? tailLines : text;

    const timeMatch = fullForSearch.match(/;\s*estimated printing time[^=]*=\s*([^\n\r]+)/i)
      || text.match(/;TIME:(\d+)/i);
    let druckzeitH = 0;
    if(timeMatch){
      if(/^\d+$/.test(timeMatch[1].trim())){
        druckzeitH = +(parseInt(timeMatch[1])/3600).toFixed(2); // Cura: Sekunden
      } else {
        druckzeitH = +(parseGcodeTime(timeMatch[1])/3600).toFixed(2); // Prusa-Format: "Xh Ym Zs"
      }
    }

    const gramsMatch = fullForSearch.match(/;\s*filament used \[g\]\s*=\s*([^\n\r]+)/i);
    const typeMatch = fullForSearch.match(/;\s*filament_type\s*=\s*([^\n\r]+)/i);
    const colourMatch = fullForSearch.match(/;\s*filament_colour\s*=\s*([^\n\r]+)/i);

    const grams = gramsMatch ? gramsMatch[1].split(',').map(s=>parseFloat(s.trim())).filter(n=>!isNaN(n)&&n>0) : [];
    const types = typeMatch ? typeMatch[1].split(/[,;]/).map(s=>s.trim()) : [];
    const colours = colourMatch ? colourMatch[1].split(/[,;]/).map(s=>s.trim()) : [];

    const unmatched = new Set();
    const
