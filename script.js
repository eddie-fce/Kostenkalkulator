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

const MATERIALS = ["PLA","PETG","TPU","ABS","ASA","PC","PA (Nylon)","PVA","PLA-CF","PETG-CF","PA-CF","PET-CF","PPA-CF","Sonstiges"];

// Sinnvolle Standard-Verschleißzuschläge (€ je Druckstunde), abgestuft nach Materialkategorie.
// Wird beim Anlegen/Ändern eines Filaments automatisch vorgeschlagen, danach frei anpassbar.
// Gruppierung der Materialien für die Wartungskosten je Materialgruppe (Stammdaten).
// Jede konkrete Materialauswahl wird automatisch einer dieser 6 Gruppen zugeordnet.
const GROUP_KEYS = ["PLA","PETG","TPU","ASA/ABS","PC/PA","CF/GF"];
const MATERIAL_TO_GROUP = {
  "PLA":"PLA", "PETG":"PETG", "TPU":"TPU",
  "ABS":"ASA/ABS", "ASA":"ASA/ABS",
  "PC":"PC/PA", "PA (Nylon)":"PC/PA", "PVA":"PC/PA",
  "PLA-CF":"CF/GF", "PETG-CF":"CF/GF", "PA-CF":"CF/GF", "PET-CF":"CF/GF", "PPA-CF":"CF/GF",
  "Sonstiges":"PC/PA"
};
// Sinnvolle Standard-€/h je Gruppe – dies ist der VOLLSTÄNDIGE Wartungssatz (kein Zuschlag mehr), danach frei anpassbar
const GROUP_DEFAULTS = { "PLA":0.30, "PETG":0.30, "TPU":0.30, "ASA/ABS":0.45, "PC/PA":0.45, "CF/GF":0.70 };

function groupOf(material){ return MATERIAL_TO_GROUP[material] || "PC/PA"; }

let filamente = [];              // [{id, material, farbe, preis, farbHex}]
let allgemein = { strompreis:0.32, leistung:150, arbeit:20, amsRuestMin:10, ausschussPct:5, rundung:0.10, kleinunternehmer:true, mwst:19 };
let mengenrabatt = [];           // [{id, abStueck, rabatt}]
let materialgruppen = {};        // {"PLA": 0.30, "ASA/ABS": 0.45, ...} – vollständiger Wartungssatz €/h je Materialgruppe
let positionen = [];             // [{id, name, stueckzahl, druckzeit, arbeitszeit, slots:[{filamentId,gramm}x4]}]
let angebote = [];               // [{id, nummer, datum, gueltigBis, jobName, positionen, margin, extraDiscount, ergebnis}]
let angebotsCounter = 0;

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
    if(g) allgemein = Object.assign({}, allgemein, JSON.parse(g.value)); // mit Defaults mergen, falls neue Felder fehlen
  }catch(e){ /* Standardwerte bleiben */ }
  try{
    const t = await storage.get('mengenrabatt', false);
    mengenrabatt = t ? JSON.parse(t.value) : [];
  }catch(e){ mengenrabatt = []; }
  try{
    const mg = await storage.get('materialgruppen', false);
    materialgruppen = mg ? JSON.parse(mg.value) : {};
  }catch(e){ materialgruppen = {}; }
  // Fehlende Gruppen (z. B. bei erstem Start oder neuer Version) mit sinnvollen Defaults auffüllen
  GROUP_KEYS.forEach(g=>{ if(materialgruppen[g] === undefined) materialgruppen[g] = GROUP_DEFAULTS[g]; });
  try{
    const a = await storage.get('angebote', false);
    angebote = a ? JSON.parse(a.value) : [];
  }catch(e){ angebote = []; }
  try{
    const c = await storage.get('angebotsCounter', false);
    angebotsCounter = c ? parseInt(c.value)||0 : 0;
  }catch(e){ angebotsCounter = 0; }

  if(!positionen.length) addPosition();

  // Standard-Gültigkeit: heute + 14 Tage
  const d = new Date(); d.setDate(d.getDate()+14);
  $('#gueltigBis').value = d.toISOString().slice(0,10);

  renderFilamentList();
  renderGeneralInputs();
  renderTierList();
  renderMaterialGroups();
  renderPositionen();
  renderArchiv();
  updateTierHint();
  refreshLivePreview();
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
async function saveMaterialGroups(){
  try{ await storage.set('materialgruppen', JSON.stringify(materialgruppen), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveAngebote(){
  try{ await storage.set('angebote', JSON.stringify(angebote), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveAngebotsCounter(){
  try{ await storage.set('angebotsCounter', String(angebotsCounter), false); }
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
    if(tab.dataset.view==='kalk' && typeof refreshLivePreview==='function') refreshLivePreview();
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
    const group = groupOf(f.material);
    const rate = materialgruppen[group] ?? GROUP_DEFAULTS[group] ?? 0;
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
      <div class="field">
        <label title="Wird über die Materialgruppe unten festgelegt">Wartung/Std.</label>
        <span class="tier-tag" title="Gruppe: ${group}, bearbeitbar unter „Wartungskosten je Materialgruppe“">${group} · €${fmt(rate)}</span>
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
      if(field==='farbe' || field==='material') renderFilamentList();
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
  $('#genArbeit').value = allgemein.arbeit;
  $('#genAmsRuest').value = allgemein.amsRuestMin;
  $('#genAusschuss').value = allgemein.ausschussPct;
  $('#genRundung').value = String(allgemein.rundung);
  $('#genKleinunternehmer').checked = !!allgemein.kleinunternehmer;
  $('#genMwst').value = allgemein.mwst;
  $('#mwstFieldWrap').style.display = allgemein.kleinunternehmer ? 'none' : 'block';
}
['genStrompreis','genLeistung','genArbeit','genAmsRuest','genAusschuss','genMwst'].forEach(id=>{
  $('#'+id).addEventListener('change', ()=>{
    allgemein.strompreis  = parseFloat($('#genStrompreis').value)||0;
    allgemein.leistung    = parseFloat($('#genLeistung').value)||0;
    allgemein.arbeit      = parseFloat($('#genArbeit').value)||0;
    allgemein.amsRuestMin = parseFloat($('#genAmsRuest').value)||0;
    allgemein.ausschussPct= parseFloat($('#genAusschuss').value)||0;
    allgemein.mwst         = parseFloat($('#genMwst').value)||0;
    saveAllgemein();
    refreshLivePreview();
  });
});
$('#genRundung').addEventListener('change', ()=>{
  allgemein.rundung = parseFloat($('#genRundung').value)||0.01;
  saveAllgemein();
  refreshLivePreview();
});
$('#genKleinunternehmer').addEventListener('change', ()=>{
  allgemein.kleinunternehmer = $('#genKleinunternehmer').checked;
  $('#mwstFieldWrap').style.display = allgemein.kleinunternehmer ? 'none' : 'block';
  saveAllgemein();
  refreshLivePreview();
});

// ---------- Stammdaten: Wartungskosten je Materialgruppe ----------
function renderMaterialGroups(){
  const box = $('#groupList');
  box.innerHTML = GROUP_KEYS.map(g => `
    <div class="disc-row">
      <div class="field">
        <label>Materialgruppe</label>
        <input value="${g}" disabled style="opacity:0.7;">
      </div>
      <div class="field">
        <label>Wartung €/Std.</label>
        <input data-group="${g}" type="number" min="0" step="0.05" value="${materialgruppen[g] ?? GROUP_DEFAULTS[g] ?? 0}">
      </div>
      <span></span>
    </div>
  `).join('');

  box.querySelectorAll('[data-group]').forEach(el=>{
    el.addEventListener('input', e=>{
      materialgruppen[e.target.dataset.group] = parseFloat(e.target.value)||0;
      saveMaterialGroups();
      renderFilamentList(); // Anzeige der €/h-Badges in der Filamentliste aktualisieren
    });
  });
}

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
      refreshLivePreview();
    });
  });
  box.querySelectorAll('[data-delpos]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      positionen = positionen.filter(p=>p.id!==btn.dataset.delpos);
      if(!positionen.length) addPosition();
      renderPositionen();
      updateTierHint();
      refreshLivePreview();
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
      refreshLivePreview();
    });
  });
}

$('#addPositionBtn').addEventListener('click', ()=>{
  addPosition();
  renderPositionen();
  updateTierHint();
  refreshLivePreview();
});
$('#clearPositionsBtn').addEventListener('click', ()=>{
  positionen = [];
  addPosition();
  renderPositionen();
  updateTierHint();
  refreshLivePreview();
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
    refreshLivePreview();

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
    const unverified = new Set();
    const slots = [null,null,null,null];

    grams.slice(0,4).forEach((g, i)=>{
      const type = types[i] || types[0] || '';
      const colour = colours[i] || null;
      let match = colour ? findFilamentByTypeColor(type, colour) : null;
      if(!match && type){
        match = filamente.find(f => (f.material||'').toLowerCase() === type.toLowerCase());
        if(match) unverified.add(`${type} (Farbe nicht in Datei, bitte prüfen)`);
      }
      if(match){
        slots[i] = {filamentId: match.id, gramm: String(Math.round(g*10)/10)};
      } else {
        unmatched.add(type ? `${type}${colour?' '+colour:''}` : `Filament ${i+1} (${g} g)`);
      }
    });

    if(!grams.length && !druckzeitH){
      msg.innerHTML = `<div class="import-msg warn">In „${file.name}“ wurden keine Druckzeit-/Filamentangaben gefunden. Unterstützt werden G-Codes aus PrusaSlicer, SuperSlicer, OrcaSlicer, Bambu Studio und Cura (Kommentare am Dateiende).</div>`;
      return;
    }

    const isEmpty = p => !p.name && !parseFloat(p.druckzeit) && !parseFloat(p.arbeitszeit) && !p.slots.some(s=>s && s.filamentId);
    if(positionen.length === 1 && isEmpty(positionen[0])) positionen = [];

    addPosition({
      name: file.name.replace(/\.(gcode|gco|g)$/i, ''),
      stueckzahl: 1,
      druckzeit: druckzeitH,
      arbeitszeit: 0,
      slots
    });
    renderPositionen();
    updateTierHint();
    refreshLivePreview();

    let html = `<div class="import-msg ${(unmatched.size||unverified.size)?'warn':'ok'}">Position aus „${file.name}“ importiert (Druckzeit: ${druckzeitH} Std.). Stückzahl und Arbeitszeit bitte noch prüfen/eintragen.`;
    if(unverified.size) html += `\nFarbe nicht in Datei angegeben, bitte in der Position prüfen:\n– ${[...unverified].join('\n– ')}`;
    if(unmatched.size) html += `\nNicht zugeordnete Filamente (bitte manuell auswählen, ggf. erst in Stammdaten anlegen):\n– ${[...unmatched].join('\n– ')}`;
    html += '</div>';
    msg.innerHTML = html;

  }catch(e){
    console.error(e);
    msg.innerHTML = `<div class="import-msg warn">Datei konnte nicht gelesen werden: ${e.message}</div>`;
  }
}

$('#gcodeImportBtn').addEventListener('click', ()=> $('#gcodeFile').click());
$('#gcodeFile').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(file) importGcode(file);
  e.target.value = '';
});

// ---------- Berechnung (gemeinsam für Anzeige + CSV-Export) ----------
function roundPrice(value, step){
  if(!step || step<=0) return Math.round(value*100)/100;
  return Math.round(value/step) * step;
}

function computeQuote(){
  const marginPct = parseFloat($('#margin').value)||0;
  const extraDiscountPct = parseFloat($('#extraDiscount').value)||0;
  const jobName = $('#jobName').value.trim();

  let materialTotal=0, stromTotal=0, wartungTotal=0, arbeitTotal=0, amsRuestStunden=0, amsPositionen=0;
  const posLines = [];

  positionen.forEach((pos,idx)=>{
    const stueckzahl = parseInt(pos.stueckzahl)||1;
    const druckzeit = parseFloat(pos.druckzeit)||0;
    let arbeitszeit = parseFloat(pos.arbeitszeit)||0;

    const usedSlots = pos.slots.filter(s=> s && s.filamentId && parseFloat(s.gramm)>0);

    // AMS-Rüstzuschlag: automatisch, wenn eine Position mehr als 1 Filament nutzt (Multicolor über AMS)
    let amsZuschlagH = 0;
    if(usedSlots.length > 1){
      amsZuschlagH = (allgemein.amsRuestMin||0) / 60;
      amsRuestStunden += amsZuschlagH;
      amsPositionen++;
      arbeitszeit += amsZuschlagH;
    }

    const material = usedSlots.reduce((sum,s)=>{
      const f = filamente.find(x=>x.id===s.filamentId);
      if(!f) return sum;
      return sum + (parseFloat(s.gramm)/1000) * f.preis;
    },0);
    const strom = (allgemein.leistung/1000) * druckzeit * allgemein.strompreis;
    // Wartungssatz je Druckstunde: höchster Gruppenpreis der in dieser Position verwendeten Filamente
    const wartungssatz = usedSlots.reduce((max,s)=>{
      const f = filamente.find(x=>x.id===s.filamentId);
      const z = f ? (materialgruppen[groupOf(f.material)] ?? GROUP_DEFAULTS[groupOf(f.material)] ?? 0) : 0;
      return Math.max(max, z);
    }, 0);
    const wartung = wartungssatz * druckzeit;
    const arbeit = allgemein.arbeit * arbeitszeit;
    const subtotal = material+strom+wartung+arbeit;

    materialTotal += material; stromTotal += strom; wartungTotal += wartung; arbeitTotal += arbeit;

    posLines.push({
      nr: idx+1,
      name: pos.name || 'Ohne Namen',
      stueckzahl,
      subtotal,
      proStueck: subtotal/stueckzahl,
      amsZuschlag: amsZuschlagH > 0
    });
  });

  const sumStueckzahl = totalStueckzahl();
  const kostenSumme = materialTotal + stromTotal + wartungTotal + arbeitTotal;

  const ausschussBetrag = kostenSumme * ((allgemein.ausschussPct||0)/100);
  const zwischensumme = kostenSumme + ausschussBetrag;

  const gewinn = zwischensumme * (marginPct/100);
  const nachGewinn = zwischensumme + gewinn;

  const tier = findTier(sumStueckzahl);
  const tierPct = tier ? tier.rabatt : 0;
  const totalDiscountPct = tierPct + extraDiscountPct;
  const rabattBetrag = nachGewinn * (totalDiscountPct/100);
  const nettoGesamt = nachGewinn - rabattBetrag;

  const kleinunternehmer = !!allgemein.kleinunternehmer;
  const mwstSatz = kleinunternehmer ? 0 : (allgemein.mwst||0);
  const mwstBetrag = nettoGesamt * (mwstSatz/100);
  const bruttoGesamt = nettoGesamt + mwstBetrag;

  const gesamt = roundPrice(bruttoGesamt, allgemein.rundung);
  const rundungsDiff = gesamt - bruttoGesamt;

  return {jobName, posLines, materialTotal, stromTotal, wartungTotal, arbeitTotal,
    amsRuestStunden, amsPositionen, kostenSumme, ausschussPct: allgemein.ausschussPct||0, ausschussBetrag,
    zwischensumme, marginPct, gewinn, tierPct, extraDiscountPct, totalDiscountPct,
    rabattBetrag, nettoGesamt, kleinunternehmer, mwstSatz, mwstBetrag, bruttoGesamt,
    rundungsDiff, gesamt, sumStueckzahl};
}

function buildResultHtml(q){
  let html = '';
  if(q.jobName) html += `<h2 style="margin-bottom:14px;">${q.jobName}</h2>`;

  html += `<h3>Positionen</h3>`;
  html += q.posLines.map(l=>`<div class="pos-line"><span>${l.nr}. ${l.name} (${l.stueckzahl} Stk.)${l.amsZuschlag?' · AMS':''}</span><span>${fmt(l.subtotal)} € · ${fmt(l.proStueck)} €/Stk.</span></div>`).join('');

  html += `<h3>Kosten gesamt</h3>`;
  html += `<div class="line"><span>Materialkosten</span><span>${fmt(q.materialTotal)} €</span></div>`;
  html += `<div class="line"><span>Stromkosten</span><span>${fmt(q.stromTotal)} €</span></div>`;
  html += `<div class="line"><span>Wartung & Verschleiß</span><span>${fmt(q.wartungTotal)} €</span></div>`;
  let arbeitLabel = 'Arbeitskosten';
  if(q.amsPositionen>0) arbeitLabel += ` (inkl. AMS-Rüstzuschlag: ${q.amsPositionen} Pos. à ${allgemein.amsRuestMin} Min.)`;
  html += `<div class="line"><span>${arbeitLabel}</span><span>${fmt(q.arbeitTotal)} €</span></div>`;
  html += `<div class="line"><span>Kostensumme</span><span>${fmt(q.kostenSumme)} €</span></div>`;
  if(q.ausschussPct>0) html += `<div class="line"><span>Ausschuss-Puffer (${q.ausschussPct}%)</span><span>${fmt(q.ausschussBetrag)} €</span></div>`;
  html += `<div class="line"><span>Zwischensumme</span><span>${fmt(q.zwischensumme)} €</span></div>`;
  if(q.marginPct>0) html += `<div class="line"><span>Gewinnaufschlag (${q.marginPct}%)</span><span>${fmt(q.gewinn)} €</span></div>`;
  if(q.totalDiscountPct>0){
    let label = 'Nachlass';
    if(q.tierPct>0 && q.extraDiscountPct>0) label = `Nachlass (Mengenrabatt ${q.tierPct}% + Zusatz ${q.extraDiscountPct}%)`;
    else if(q.tierPct>0) label = `Mengenrabatt (${q.tierPct}%)`;
    else label = `Zusätzlicher Nachlass (${q.extraDiscountPct}%)`;
    html += `<div class="line"><span>${label}</span><span>−${fmt(q.rabattBetrag)} €</span></div>`;
  }
  html += `<div class="line"><span>Netto-Gesamt</span><span>${fmt(q.nettoGesamt)} €</span></div>`;
  if(q.kleinunternehmer){
    html += `<div class="line"><span>Umsatzsteuer</span><span>gem. §19 UStG nicht ausgewiesen</span></div>`;
  } else {
    html += `<div class="line"><span>zzgl. USt (${q.mwstSatz}%)</span><span>${fmt(q.mwstBetrag)} €</span></div>`;
  }
  html += `<div class="total"><span>Gesamtpreis (${q.sumStueckzahl} Stk.)</span><span>${fmt(q.gesamt)} €</span></div>`;
  if(q.sumStueckzahl>0) html += `<div class="line"><span>Ø Preis / Stück</span><span>${fmt(q.gesamt/q.sumStueckzahl)} €</span></div>`;
  return html;
}

$('#calcBtn').addEventListener('click', ()=>{
  const q = computeQuote();
  const panel = $('#resultPanel');
  panel.innerHTML = buildResultHtml(q);
  panel.style.display = 'block';
  panel.scrollIntoView({behavior:'smooth', block:'nearest'});
});

// ---------- Live-Vorschau ----------
let liveTimer = null;
function refreshLivePreview(){
  clearTimeout(liveTimer);
  liveTimer = setTimeout(()=>{
    try{
      const q = computeQuote();
      $('#livePreviewValue').textContent = `€${fmt(q.gesamt)}`;
    }catch(e){ /* still ok while editing */ }
  }, 200);
}
['margin','extraDiscount'].forEach(id=>{
  $('#'+id).addEventListener('input', refreshLivePreview);
});

// ---------- CSV-Export (Preisangebot) ----------
function csvNum(n){ return n.toFixed(2).replace('.', ','); }
function csvEsc(s){
  s = String(s ?? '');
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

function buildCsvRows(q, meta){
  const rows = [];
  rows.push(['Preisangebot']);
  if(meta && meta.nummer) rows.push(['Angebots-Nr.', meta.nummer]);
  rows.push(['Auftrag', q.jobName || '']);
  rows.push(['Datum', (meta && meta.datum) || new Date().toLocaleDateString('de-DE')]);
  if(meta && meta.gueltigBis) rows.push(['Gültig bis', meta.gueltigBis]);
  rows.push([]);
  rows.push(['Pos.','Produkt','Stückzahl','Einzelpreis (€)','Gesamtpreis (€)']);
  q.posLines.forEach(l=>{
    rows.push([l.nr, l.name, l.stueckzahl, csvNum(l.proStueck), csvNum(l.subtotal)]);
  });
  rows.push([]);
  rows.push(['','','','Kostensumme', csvNum(q.kostenSumme)]);
  if(q.ausschussPct>0) rows.push(['','','',`Ausschuss-Puffer (${q.ausschussPct}%)`, csvNum(q.ausschussBetrag)]);
  rows.push(['','','','Zwischensumme', csvNum(q.zwischensumme)]);
  if(q.marginPct>0) rows.push(['','','',`Gewinnaufschlag (${q.marginPct}%)`, csvNum(q.gewinn)]);
  if(q.totalDiscountPct>0){
    let label = 'Nachlass';
    if(q.tierPct>0 && q.extraDiscountPct>0) label = `Nachlass (Mengenrabatt ${q.tierPct}% + Zusatz ${q.extraDiscountPct}%)`;
    else if(q.tierPct>0) label = `Mengenrabatt (${q.tierPct}%)`;
    else label = `Zusätzlicher Nachlass (${q.extraDiscountPct}%)`;
    rows.push(['','','',label, '-' + csvNum(q.rabattBetrag)]);
  }
  rows.push(['','','','Netto-Gesamt', csvNum(q.nettoGesamt)]);
  rows.push(['','','','Umsatzsteuer', q.kleinunternehmer ? 'gem. §19 UStG nicht ausgewiesen' : `${q.mwstSatz}% = ${csvNum(q.mwstBetrag)} €`]);
  rows.push(['','','','Gesamtpreis', csvNum(q.gesamt)]);
  if(q.sumStueckzahl>0) rows.push(['','','','Ø Preis / Stück', csvNum(q.gesamt/q.sumStueckzahl)]);
  return rows;
}

function downloadCsv(rows, filename){
  const csv = '\uFEFF' + rows.map(r=>r.map(csvEsc).join(';')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

$('#exportCsvBtn').addEventListener('click', ()=>{
  const q = computeQuote();
  const rows = buildCsvRows(q, {nummer: $('#angebotsNr').value, gueltigBis: $('#gueltigBis').value});
  const safeName = (q.jobName || 'angebot').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  downloadCsv(rows, `preisangebot_${safeName || 'angebot'}.csv`);
});

// ---------- Archiv: Angebote speichern/laden/löschen ----------
function nextAngebotsNummer(){
  angebotsCounter++;
  const jahr = new Date().getFullYear();
  return `A-${jahr}-${String(angebotsCounter).padStart(3,'0')}`;
}

function renderArchiv(){
  const box = $('#archivList');
  box.innerHTML = '';
  $('#archivEmpty').style.display = angebote.length ? 'none' : 'block';

  [...angebote].reverse().forEach(a=>{
    const row = document.createElement('div');
    row.className = 'archiv-row';
    row.innerHTML = `
      <div class="arow-top">
        <span class="anr">${a.nummer}</span>
        <span class="aprice">${fmt(a.ergebnis.gesamt)} €</span>
      </div>
      <div class="aname">${a.jobName || 'Ohne Bezeichnung'}</div>
      <div class="ameta">Erstellt: ${a.datum} · Gültig bis: ${a.gueltigBis || '–'} · ${a.ergebnis.sumStueckzahl} Stk. · ${a.positionen.length} Position(en)</div>
      <div class="abtns">
        <button class="ghost-btn" data-load="${a.id}">Laden</button>
        <button class="ghost-btn" data-csv="${a.id}">⇩ CSV</button>
        <button class="icon-btn" data-delA="${a.id}" title="Angebot löschen">✕</button>
      </div>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-load]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const a = angebote.find(x=>x.id===btn.dataset.load);
      if(!a) return;
      positionen = JSON.parse(JSON.stringify(a.positionen));
      $('#jobName').value = a.jobName || '';
      $('#angebotsNr').value = a.nummer;
      $('#gueltigBis').value = a.gueltigBis || '';
      $('#margin').value = a.margin;
      $('#extraDiscount').value = a.extraDiscount;
      renderPositionen();
      updateTierHint();
      refreshLivePreview();
      document.querySelector('.tab[data-view="kalk"]').click();
    });
  });
  box.querySelectorAll('[data-csv]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const a = angebote.find(x=>x.id===btn.dataset.csv);
      if(!a) return;
      const rows = buildCsvRows(a.ergebnis, {nummer: a.nummer, datum: a.datum, gueltigBis: a.gueltigBis});
      const safeName = (a.jobName || 'angebot').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
      downloadCsv(rows, `preisangebot_${a.nummer}_${safeName || 'angebot'}.csv`);
    });
  });
  box.querySelectorAll('[data-delA]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      angebote = angebote.filter(x=>x.id!==btn.dataset.delA);
      saveAngebote();
      renderArchiv();
    });
  });
}

$('#saveAngebotBtn').addEventListener('click', ()=>{
  const q = computeQuote();
  if(!positionen.length || !q.sumStueckzahl){
    alert('Bitte zuerst mindestens eine Position mit Stückzahl anlegen.');
    return;
  }
  const nummer = nextAngebotsNummer();
  $('#angebotsNr').value = nummer;
  const eintrag = {
    id: uid('a'),
    nummer,
    datum: new Date().toLocaleDateString('de-DE'),
    gueltigBis: $('#gueltigBis').value,
    jobName: q.jobName,
    positionen: JSON.parse(JSON.stringify(positionen)),
    margin: q.marginPct,
    extraDiscount: q.extraDiscountPct,
    ergebnis: q
  };
  angebote.push(eintrag);
  saveAngebotsCounter();
  saveAngebote();
  renderArchiv();
  alert(`Angebot ${nummer} gespeichert (${fmt(q.gesamt)} €). Im Archiv abrufbar.`);
});

// ---------- Stammdaten-Backup ----------
$('#exportBackupBtn').addEventListener('click', ()=>{
  const backup = {
    exportiertAm: new Date().toISOString(),
    filamente, allgemein, mengenrabatt, materialgruppen
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `druckkalkulator_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

$('#importBackupBtn').addEventListener('click', ()=> $('#backupFile').click());
$('#backupFile').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const msg = $('#backupMsg');
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if(!confirm('Backup importieren? Das überschreibt deine aktuellen Stammdaten (Filamente, Materialgruppen, Mengenrabatt, allgemeine Einstellungen).')) return;

    if(Array.isArray(data.filamente)) filamente = data.filamente;
    if(data.allgemein) allgemein = Object.assign({}, allgemein, data.allgemein);
    if(Array.isArray(data.mengenrabatt)) mengenrabatt = data.mengenrabatt;
    if(data.materialgruppen) materialgruppen = data.materialgruppen;

    await Promise.all([saveFilamente(), saveAllgemein(), saveTiers(), saveMaterialGroups()]);
    renderFilamentList(); renderGeneralInputs(); renderTierList(); renderMaterialGroups(); renderPositionen();
    msg.innerHTML = `<div class="import-msg ok">Backup vom ${new Date(data.exportiertAm||Date.now()).toLocaleString('de-DE')} erfolgreich importiert.</div>`;
  }catch(err){
    msg.innerHTML = `<div class="import-msg warn">Backup konnte nicht gelesen werden: ${err.message}</div>`;
  }
});

loadData();
