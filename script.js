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

// Grobe Dichte-Richtwerte (g/cm³) je Material, nur für die Sofortschätzung aus STL/3MF (ohne Slicing) genutzt
const MATERIAL_DENSITY = {
  "PLA":1.24, "PETG":1.27, "TPU":1.21, "ABS":1.04, "ASA":1.07, "PC":1.20,
  "PA (Nylon)":1.14, "PVA":1.23, "PLA-CF":1.30, "PETG-CF":1.30, "PA-CF":1.20,
  "PET-CF":1.35, "PPA-CF":1.25, "Sonstiges":1.24
};

function groupOf(material){ return MATERIAL_TO_GROUP[material] || "PC/PA"; }

let filamente = [];              // [{id, material, farbe, preis, farbHex}]
let firma = { name:'', ansprechpartner:'', adresse:'', telefon:'', email:'', website:'', steuernummer:'', ustId:'', iban:'', bic:'', logoDataUrl:'', logoW:0, logoH:0 };
let allgemein = { strompreis:0.32, leistung:150, arbeit:20, amsRuestMin:10, ausschussPct:5, rundung:0.10, kleinunternehmer:true, mwst:19, expressPct:25, stdProTag:16, pufferTage:2, versandStandard:0, infillEstimatePct:20, volumenrateMm3S:15 };
let mengenrabatt = [];           // [{id, abStueck, rabatt}]
let materialgruppen = {};        // {"PLA": 0.30, "ASA/ABS": 0.45, ...} – vollständiger Wartungssatz €/h je Materialgruppe
let zubehoer = [];               // [{id, name, preis}] – Zubehör/Hardware, Preis pro Stück
let drucker = [];                // [{id, name, leistung, amsFaehig}]
let kunden = [];                 // [{id, name, firma, adresse, email, telefon}]
let vorlagen = [];                // [{id, name, druckzeit, arbeitszeit, slots, zubehoerItems, druckerId}]
let positionen = [];             // [{id, name, stueckzahl, druckzeit, arbeitszeit, druckerId, zubehoerItems, slots:[{filamentId,gramm}x4]}]
let angebote = [];               // [{id, nummer, datum, gueltigBis, liefertermin, jobName, kunde, express, expressPct, positionen, margin, extraDiscount, ergebnis}]
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
    const fi = await storage.get('firma', false);
    if(fi) firma = Object.assign({}, firma, JSON.parse(fi.value));
  }catch(e){ /* Standardwerte bleiben */ }
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
    const z = await storage.get('zubehoer', false);
    zubehoer = z ? JSON.parse(z.value) : [];
  }catch(e){ zubehoer = []; }
  try{
    const d = await storage.get('drucker', false);
    drucker = d ? JSON.parse(d.value) : [];
  }catch(e){ drucker = []; }
  if(!drucker.length){
    // Migration/Erstbefüllung: bisherige globale Druckerleistung als Basis für zwei Standard-Profile übernehmen
    const seedLeistung = allgemein.leistung || 150;
    drucker = [
      {id: uid('d'), name:'P1S #1', leistung: seedLeistung, amsFaehig:false, anschaffungspreis:0, lebensdauerStd:0},
      {id: uid('d'), name:'P1S #2 (AMS)', leistung: seedLeistung, amsFaehig:true, anschaffungspreis:0, lebensdauerStd:0}
    ];
    saveDrucker();
  }
  try{
    const k = await storage.get('kunden', false);
    kunden = k ? JSON.parse(k.value) : [];
  }catch(e){ kunden = []; }
  try{
    const v = await storage.get('vorlagen', false);
    vorlagen = v ? JSON.parse(v.value) : [];
  }catch(e){ vorlagen = []; }
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
  $('#expressPct').value = allgemein.expressPct;
  $('#versand').value = allgemein.versandStandard;

  renderFirmaInputs();
  renderFilamentList();
  renderDruckerList();
  renderZubehoerList();
  renderKundenVerwaltung();
  renderKundenDatalist();
  renderVorlagenList();
  renderVorlageSelect();
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
async function saveFirma(){
  try{
    await storage.set('firma', JSON.stringify(firma), false);
    flashSaved('#firmaSaveMsg');
  }catch(e){ console.error('Speichern fehlgeschlagen', e); }
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
async function saveZubehoer(){
  try{ await storage.set('zubehoer', JSON.stringify(zubehoer), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveDrucker(){
  try{ await storage.set('drucker', JSON.stringify(drucker), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveKunden(){
  try{ await storage.set('kunden', JSON.stringify(kunden), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveVorlagen(){
  try{ await storage.set('vorlagen', JSON.stringify(vorlagen), false); }
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
function flashSaved(sel){
  const el = $(sel || '#genSaveMsg');
  if(!el) return;
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
    if(tab.dataset.view==='kunden' && typeof renderKundenVerwaltung==='function') renderKundenVerwaltung();
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

// ---------- Stammdaten: Firmenprofil (Absender) ----------
function renderFirmaInputs(){
  $('#firmaName').value = firma.name||'';
  $('#firmaAnsprechpartner').value = firma.ansprechpartner||'';
  $('#firmaTelefon').value = firma.telefon||'';
  $('#firmaEmail').value = firma.email||'';
  $('#firmaWebsite').value = firma.website||'';
  $('#firmaAdresse').value = firma.adresse||'';
  $('#firmaUstId').value = firma.ustId||'';
  $('#firmaSteuernummer').value = firma.steuernummer||'';
  $('#firmaIban').value = firma.iban||'';
  $('#firmaBic').value = firma.bic||'';
  if(firma.logoDataUrl){
    $('#firmaLogoPreview').src = firma.logoDataUrl;
    $('#firmaLogoPreviewWrap').style.display = 'block';
  } else {
    $('#firmaLogoPreviewWrap').style.display = 'none';
  }
}
['firmaName','firmaAnsprechpartner','firmaTelefon','firmaEmail','firmaWebsite','firmaAdresse','firmaUstId','firmaSteuernummer','firmaIban','firmaBic'].forEach(id=>{
  $('#'+id).addEventListener('change', ()=>{
    firma.name = $('#firmaName').value.trim();
    firma.ansprechpartner = $('#firmaAnsprechpartner').value.trim();
    firma.telefon = $('#firmaTelefon').value.trim();
    firma.email = $('#firmaEmail').value.trim();
    firma.website = $('#firmaWebsite').value.trim();
    firma.adresse = $('#firmaAdresse').value.trim();
    firma.ustId = $('#firmaUstId').value.trim();
    firma.steuernummer = $('#firmaSteuernummer').value.trim();
    firma.iban = $('#firmaIban').value.trim();
    firma.bic = $('#firmaBic').value.trim();
    saveFirma();
  });
});

$('#firmaLogoBtn').addEventListener('click', ()=> $('#firmaLogoFile').click());
$('#firmaLogoFile').addEventListener('change', e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    const img = new Image();
    img.onload = ()=>{
      // Vor dem Speichern verkleinern, damit localStorage nicht unnötig aufgebläht wird
      const maxDim = 400;
      let w = img.width, h = img.height;
      if(w > maxDim || h > maxDim){
        const scale = Math.min(maxDim/w, maxDim/h);
        w = Math.round(w*scale); h = Math.round(h*scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      firma.logoDataUrl = canvas.toDataURL('image/png');
      firma.logoW = w; firma.logoH = h;
      saveFirma();
      renderFirmaInputs();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
$('#firmaLogoRemoveBtn').addEventListener('click', ()=>{
  firma.logoDataUrl = ''; firma.logoW = 0; firma.logoH = 0;
  saveFirma();
  renderFirmaInputs();
});

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

// ---------- Stammdaten: Drucker ----------
// Abschreibung: Anschaffungspreis / erwartete Lebensdauer (Std.) = zusätzlicher €/Std.-Kostenfaktor
function druckerAbschreibungProStunde(d){
  if(!d || !d.lebensdauerStd) return 0;
  return (d.anschaffungspreis||0) / d.lebensdauerStd;
}

function renderDruckerList(){
  const box = $('#druckerList');
  box.innerHTML = '';
  $('#druckerEmpty').style.display = drucker.length ? 'none' : 'block';

  drucker.forEach(d=>{
    const card = document.createElement('div');
    card.className = 'drucker-card';
    const abschreibung = druckerAbschreibungProStunde(d);
    card.innerHTML = `
      <div class="drow-top">
        <div class="row g3">
          <div class="field">
            <label>Name</label>
            <input data-id="${d.id}" data-field="name" value="${d.name||''}" placeholder="z. B. P1S #1">
          </div>
          <div class="field">
            <label>Leistung (W)</label>
            <input data-id="${d.id}" data-field="leistung" type="number" min="0" step="1" value="${d.leistung||0}">
          </div>
          <label class="chk-field">
            <input type="checkbox" data-id="${d.id}" data-field="amsFaehig" ${d.amsFaehig?'checked':''}>
            AMS-fähig
          </label>
        </div>
        <button class="icon-btn" data-del="${d.id}" title="Drucker löschen">✕</button>
      </div>
      <div class="row g3">
        <div class="field">
          <label>Anschaffungspreis (€)</label>
          <input data-id="${d.id}" data-field="anschaffungspreis" type="number" min="0" step="10" value="${d.anschaffungspreis||0}">
        </div>
        <div class="field">
          <label>Erwartete Lebensdauer (Std.)</label>
          <input data-id="${d.id}" data-field="lebensdauerStd" type="number" min="0" step="100" value="${d.lebensdauerStd||0}">
        </div>
        <div class="field">
          <label>Abschreibung</label>
          <span class="tier-tag">€${fmt(abschreibung)} / Std.</span>
        </div>
      </div>
    `;
    box.appendChild(card);
  });

  box.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('input', e=>{
      const d = drucker.find(x=>x.id===e.target.dataset.id);
      const field = e.target.dataset.field;
      d[field] = field==='amsFaehig' ? e.target.checked : (field==='name' ? e.target.value : (parseFloat(e.target.value)||0));
      saveDrucker();
      if(field==='anschaffungspreis' || field==='lebensdauerStd') renderDruckerList();
      renderPositionen();
      refreshLivePreview();
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      drucker = drucker.filter(x=>x.id!==btn.dataset.del);
      positionen.forEach(p=>{ if(p.druckerId===btn.dataset.del) p.druckerId = drucker[0] ? drucker[0].id : ''; });
      saveDrucker();
      renderDruckerList();
      renderPositionen();
      refreshLivePreview();
    });
  });
}

$('#addDruckerBtn').addEventListener('click', ()=>{
  drucker.push({id:uid('d'), name:`Drucker ${drucker.length+1}`, leistung:150, amsFaehig:false, anschaffungspreis:0, lebensdauerStd:0});
  saveDrucker();
  renderDruckerList();
  renderPositionen();
});

// ---------- Stammdaten: Zubehör (Gewindeeinsätze, Schrauben, Muttern, …) ----------
function renderZubehoerList(){
  const box = $('#zubehoerList');
  box.innerHTML = '';
  $('#zubehoerEmpty').style.display = zubehoer.length ? 'none' : 'block';

  zubehoer.forEach(z=>{
    const row = document.createElement('div');
    row.className = 'disc-row';
    row.innerHTML = `
      <div class="field">
        <label>Bezeichnung</label>
        <input data-id="${z.id}" data-field="name" value="${z.name||''}" placeholder="z. B. Gewindeeinsatz M3x5">
      </div>
      <div class="field">
        <label>€ / Stück</label>
        <input data-id="${z.id}" data-field="preis" type="number" min="0" step="0.01" value="${z.preis||0}">
      </div>
      <button class="icon-btn" data-del="${z.id}" title="Zubehör löschen">✕</button>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('input', e=>{
      const z = zubehoer.find(x=>x.id===e.target.dataset.id);
      const field = e.target.dataset.field;
      z[field] = field==='preis' ? (parseFloat(e.target.value)||0) : e.target.value;
      saveZubehoer();
      renderPositionen();
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      zubehoer = zubehoer.filter(x=>x.id!==btn.dataset.del);
      positionen.forEach(p=>{ p.zubehoerItems = (p.zubehoerItems||[]).filter(it=>it.zubehoerId!==btn.dataset.del); });
      saveZubehoer();
      renderZubehoerList();
      renderPositionen();
    });
  });
}

$('#addZubehoerBtn').addEventListener('click', ()=>{
  zubehoer.push({id:uid('z'), name:'', preis:0});
  saveZubehoer();
  renderZubehoerList();
});

// ---------- Kundenverwaltung (eigener Tab) ----------
let kundenVerwaltungOpen = new Set(); // IDs der aufgeklappten Kunden (nur zur Laufzeit)
let kundenSucheText = '';

function renderKundenDatalist(){
  $('#kundenDatalist').innerHTML = kunden.map(k=>`<option value="${(k.name||'').replace(/"/g,'&quot;')}">`).join('');
}

$('#kundeName').addEventListener('input', ()=>{
  const name = $('#kundeName').value.trim();
  if(!name) return;
  const k = kunden.find(x=> (x.name||'').trim().toLowerCase() === name.toLowerCase());
  if(k){
    $('#kundeFirma').value = k.firma||'';
    $('#kundeEmail').value = k.email||'';
    $('#kundeTelefon').value = k.telefon||'';
    $('#kundeAdresse').value = k.adresse||'';
  }
});

function upsertKunde(){
  const name = $('#kundeName').value.trim();
  if(!name) return null;
  const data = {
    name,
    firma: $('#kundeFirma').value.trim(),
    email: $('#kundeEmail').value.trim(),
    telefon: $('#kundeTelefon').value.trim(),
    adresse: $('#kundeAdresse').value.trim()
  };
  let k = kunden.find(x=> (x.name||'').trim().toLowerCase() === name.toLowerCase());
  if(k){ Object.assign(k, data); }
  else { k = Object.assign({id:uid('k')}, data); kunden.push(k); }
  saveKunden();
  renderKundenVerwaltung();
  renderKundenDatalist();
  return k;
}

// Angebote, Gesamtumsatz und letztes Angebot für einen Kunden (Namensabgleich, case-insensitive)
function kundeStats(k){
  const name = (k.name||'').trim().toLowerCase();
  const matches = name ? angebote.filter(a => a.kunde && (a.kunde.name||'').trim().toLowerCase() === name) : [];
  const summe = matches.reduce((s,a)=> s + (a.ergebnis && a.ergebnis.gesamt || 0), 0);
  const angenommen = matches.filter(a => angebotStatusInfo(a).value === 'angenommen');
  const summeAngenommen = angenommen.reduce((s,a)=> s + (a.ergebnis && a.ergebnis.gesamt || 0), 0);
  return {matches, summe, angenommenCount: angenommen.length, summeAngenommen, letztes: matches.length ? matches[matches.length-1] : null};
}

function renderKundenVerwaltung(){
  const box = $('#kundenVerwaltungList');
  box.innerHTML = '';
  const q = kundenSucheText.trim().toLowerCase();
  const list = kunden
    .filter(k => !q || (k.name||'').toLowerCase().includes(q) || (k.firma||'').toLowerCase().includes(q))
    .sort((a,b)=> (a.name||'').localeCompare(b.name||'', 'de', {sensitivity:'base'}));
  $('#kundenVerwaltungEmpty').style.display = list.length ? 'none' : 'block';

  list.forEach(k=>{
    const {matches, summe, angenommenCount, summeAngenommen, letztes} = kundeStats(k);
    const row = document.createElement('div');
    row.className = 'kv-row' + (kundenVerwaltungOpen.has(k.id) ? ' open' : '');
    row.innerHTML = `
      <div class="kv-head" data-toggle="${k.id}">
        <div><span class="kv-name">${k.name || 'Ohne Namen'}</span>${k.firma?`<span class="kv-meta"> · ${k.firma}</span>`:''}</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="kv-meta">${matches.length} Angebot(e)${matches.length?' · '+fmt(summe)+' €':''}</span>
          <span class="kv-chevron">▶</span>
        </div>
      </div>
      <div class="kv-body">
        <div class="row g3">
          <div class="field">
            <label>Name</label>
            <input data-kv="${k.id}" data-field="name" value="${k.name||''}">
          </div>
          <div class="field">
            <label>Firma</label>
            <input data-kv="${k.id}" data-field="firma" value="${k.firma||''}">
          </div>
          <div class="field">
            <label>Telefon</label>
            <input data-kv="${k.id}" data-field="telefon" value="${k.telefon||''}">
          </div>
        </div>
        <div class="row g2" style="margin-top:12px;">
          <div class="field">
            <label>E-Mail</label>
            <input data-kv="${k.id}" data-field="email" type="email" value="${k.email||''}">
          </div>
          <div class="field">
            <label>Anschrift</label>
            <input data-kv="${k.id}" data-field="adresse" value="${k.adresse||''}" placeholder="Straße, PLZ Ort">
          </div>
        </div>
        <div class="kv-stats">
          <span>Angebote gesamt: <b>${matches.length}</b></span>
          <span>Gesamtumsatz: <b>${fmt(summe)} €</b></span>
          <span>Angenommen: <b>${angenommenCount} (${fmt(summeAngenommen)} €)</b></span>
          <span>Letztes Angebot: <b>${letztes ? letztes.nummer+' ('+letztes.datum+')' : '–'}</b></span>
        </div>
        <div class="btn-row" style="margin-bottom:4px;">
          <button class="ghost-btn" data-newangebot="${k.id}">+ Neues Angebot für diesen Kunden</button>
          <button class="icon-btn" data-delkv="${k.id}" title="Kunde löschen">✕</button>
        </div>
        ${matches.length ? '<div class="slot-title" style="margin-top:10px;">ZURÜCKLIEGENDE ANGEBOTE</div>' : ''}
        ${[...matches].reverse().map(a=>{
          const info = angebotStatusInfo(a);
          return `
          <div class="kv-angebot-row">
            <span>${a.nummer} · ${a.datum} · ${a.ergebnis.sumStueckzahl} Stk. · <span class="status-tag ${info.cls}">${info.label}</span></span>
            <span style="display:flex; align-items:center; gap:8px;">
              <b style="color:var(--accent);">${fmt(a.ergebnis.gesamt)} €</b>
              <button class="ghost-btn" data-kvload="${a.id}">Laden</button>
            </span>
          </div>
        `;}).join('')}
      </div>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-toggle]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.dataset.toggle;
      if(kundenVerwaltungOpen.has(id)) kundenVerwaltungOpen.delete(id); else kundenVerwaltungOpen.add(id);
      renderKundenVerwaltung();
    });
  });
  box.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('click', e=> e.stopPropagation());
    el.addEventListener('input', e=>{
      const k = kunden.find(x=>x.id===e.target.dataset.kv);
      k[e.target.dataset.field] = e.target.value;
      saveKunden();
      renderKundenDatalist();
    });
  });
  box.querySelectorAll('[data-delkv]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      if(!confirm('Kunde wirklich löschen? Bereits gespeicherte Angebote bleiben im Archiv erhalten.')) return;
      kunden = kunden.filter(x=>x.id!==btn.dataset.delkv);
      kundenVerwaltungOpen.delete(btn.dataset.delkv);
      saveKunden();
      renderKundenVerwaltung();
      renderKundenDatalist();
    });
  });
  box.querySelectorAll('[data-newangebot]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const k = kunden.find(x=>x.id===btn.dataset.newangebot);
      if(!k) return;
      $('#kundeName').value = k.name||'';
      $('#kundeFirma').value = k.firma||'';
      $('#kundeEmail').value = k.email||'';
      $('#kundeTelefon').value = k.telefon||'';
      $('#kundeAdresse').value = k.adresse||'';
      document.querySelector('.tab[data-view="kalk"]').click();
    });
  });
  box.querySelectorAll('[data-kvload]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      loadAngebotInForm(angebote.find(x=>x.id===btn.dataset.kvload));
    });
  });
}

$('#addKundeVerwaltungBtn').addEventListener('click', ()=>{
  const neu = {id:uid('k'), name:'Neuer Kunde', firma:'', email:'', telefon:'', adresse:''};
  kunden.push(neu);
  kundenVerwaltungOpen.add(neu.id);
  saveKunden();
  renderKundenVerwaltung();
  renderKundenDatalist();
});

$('#kundenSuche').addEventListener('input', ()=>{
  kundenSucheText = $('#kundenSuche').value;
  renderKundenVerwaltung();
});

// ---------- Stammdaten: Allgemeine Kosten ----------
function renderGeneralInputs(){
  $('#genStrompreis').value = allgemein.strompreis;
  $('#genArbeit').value = allgemein.arbeit;
  $('#genAmsRuest').value = allgemein.amsRuestMin;
  $('#genAusschuss').value = allgemein.ausschussPct;
  $('#genRundung').value = String(allgemein.rundung);
  $('#genExpressPct').value = allgemein.expressPct;
  $('#genStdProTag').value = allgemein.stdProTag;
  $('#genPufferTage').value = allgemein.pufferTage;
  $('#genVersand').value = allgemein.versandStandard;
  $('#genInfillEstimate').value = allgemein.infillEstimatePct;
  $('#genVolumenrate').value = allgemein.volumenrateMm3S;
  $('#genKleinunternehmer').checked = !!allgemein.kleinunternehmer;
  $('#genMwst').value = allgemein.mwst;
  $('#mwstFieldWrap').style.display = allgemein.kleinunternehmer ? 'none' : 'block';
}
['genStrompreis','genArbeit','genAmsRuest','genAusschuss','genMwst','genExpressPct','genStdProTag','genPufferTage','genVersand','genInfillEstimate','genVolumenrate'].forEach(id=>{
  $('#'+id).addEventListener('change', ()=>{
    allgemein.strompreis  = parseFloat($('#genStrompreis').value)||0;
    allgemein.arbeit      = parseFloat($('#genArbeit').value)||0;
    allgemein.amsRuestMin = parseFloat($('#genAmsRuest').value)||0;
    allgemein.ausschussPct= parseFloat($('#genAusschuss').value)||0;
    allgemein.mwst         = parseFloat($('#genMwst').value)||0;
    allgemein.expressPct   = parseFloat($('#genExpressPct').value)||0;
    allgemein.stdProTag    = parseFloat($('#genStdProTag').value)||16;
    allgemein.pufferTage   = parseFloat($('#genPufferTage').value)||0;
    allgemein.versandStandard = parseFloat($('#genVersand').value)||0;
    allgemein.infillEstimatePct = parseFloat($('#genInfillEstimate').value)||20;
    allgemein.volumenrateMm3S = parseFloat($('#genVolumenrate').value)||15;
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

// ---------- Stammdaten: Positionsvorlagen ----------
function renderVorlagenList(){
  const box = $('#vorlagenList');
  box.innerHTML = '';
  $('#vorlagenEmpty').style.display = vorlagen.length ? 'none' : 'block';

  vorlagen.forEach(v=>{
    const usedSlots = (v.slots||[]).filter(s=>s && s.filamentId).length;
    const zubCount = (v.zubehoerItems||[]).filter(z=>z.zubehoerId).length;
    const row = document.createElement('div');
    row.className = 'vorlage-row';
    row.innerHTML = `
      <div>
        <div class="vname">${v.name}</div>
        <div class="vmeta">${v.druckzeit||0} Std. Druck · ${usedSlots} Filament(e)${zubCount?` · ${zubCount} Zubehör-Art(en)`:''}</div>
      </div>
      <button class="icon-btn" data-delvorlage="${v.id}" title="Vorlage löschen">✕</button>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-delvorlage]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      vorlagen = vorlagen.filter(x=>x.id!==btn.dataset.delvorlage);
      saveVorlagen();
      renderVorlagenList();
      renderVorlageSelect();
    });
  });
}

function renderVorlageSelect(){
  const sel = $('#vorlageSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">Vorlage wählen…</option>' + vorlagen.map(v=>`<option value="${v.id}">${v.name}</option>`).join('');
  sel.value = vorlagen.some(v=>v.id===current) ? current : '';
}

$('#vorlageLadenBtn').addEventListener('click', ()=>{
  const id = $('#vorlageSelect').value;
  if(!id) return;
  const v = vorlagen.find(x=>x.id===id);
  if(!v) return;
  const isEmpty = p => !p.name && !parseFloat(p.druckzeit) && !parseFloat(p.arbeitszeit) && !p.slots.some(s=>s && s.filamentId);
  if(positionen.length === 1 && isEmpty(positionen[0])) positionen = [];
  addPosition({
    name: v.name,
    stueckzahl: 1,
    druckzeit: v.druckzeit,
    arbeitszeit: v.arbeitszeit,
    slots: JSON.parse(JSON.stringify(v.slots||[null,null,null,null])),
    zubehoerItems: JSON.parse(JSON.stringify(v.zubehoerItems||[])),
    druckerId: v.druckerId && drucker.some(d=>d.id===v.druckerId) ? v.druckerId : (drucker[0] ? drucker[0].id : '')
  });
  renderPositionen();
  updateTierHint();
  refreshLivePreview();
  $('#vorlageSelect').value = '';
});

// ---------- Kalkulation: Positionen (Produkte) ----------
function addPosition(prefill){
  positionen.push(Object.assign({
    id: uid('p'),
    name: '',
    stueckzahl: 1,
    druckzeit: 0,
    arbeitszeit: 0,
    druckerId: drucker.length ? drucker[0].id : '',
    zubehoerItems: [],
    slots: [null,null,null,null]
  }, prefill||{}));
}

function updateAmsWarn(pos, card){
  const warnEl = card.querySelector(`[data-amswarn="${pos.id}"]`);
  if(!warnEl) return;
  const usedCount = pos.slots.filter(s=>s && s.filamentId && parseFloat(s.gramm)>0).length;
  const d = drucker.find(x=>x.id===pos.druckerId);
  if(usedCount>1 && (!d || !d.amsFaehig)){
    warnEl.style.display = 'block';
    warnEl.textContent = '⚠ Mehrere Filamente gewählt, aber der zugeordnete Drucker ist nicht AMS-fähig – kein automatischer AMS-Rüstzuschlag, Farbwechsel ggf. nur manuell möglich.';
  } else {
    warnEl.style.display = 'none';
  }
}

function renderPositionen(){
  const box = $('#positionList');
  box.innerHTML = '';

  positionen.forEach((pos, idx)=>{
    if(!pos.zubehoerItems) pos.zubehoerItems = [];
    if(!pos.druckerId && drucker.length) pos.druckerId = drucker[0].id;
    const card = document.createElement('div');
    card.className = 'position';
    card.innerHTML = `
      <div class="position-head">
        <span class="pos-tag">POSITION ${idx+1}</span>
        <div class="pos-actions">
          <button class="icon-btn" data-duppos="${pos.id}" title="Position duplizieren">⧉</button>
          <button class="icon-btn" data-savevorlage="${pos.id}" title="Als Vorlage speichern">💾</button>
          <button class="icon-btn" data-delpos="${pos.id}" title="Position löschen">✕</button>
        </div>
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
          <label>Drucker</label>
          <select data-pos="${pos.id}" data-pfield="druckerId">
            ${drucker.length ? drucker.map(d=>`<option value="${d.id}" ${d.id===pos.druckerId?'selected':''}>${d.name}${d.amsFaehig?' (AMS)':''}</option>`).join('') : '<option value="">— keine Drucker angelegt —</option>'}
          </select>
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
      <div class="pos-warn" data-amswarn="${pos.id}" style="display:none;"></div>
      <div data-zubbox="${pos.id}"></div>
      <button class="ghost-btn" data-addzub="${pos.id}" type="button" style="margin-top:2px;">+ Zubehör</button>
    `;
    box.appendChild(card);
    renderSlotsForPosition(pos, card.querySelector(`[data-slotbox="${pos.id}"]`));
    renderZubItemsForPosition(pos, card.querySelector(`[data-zubbox="${pos.id}"]`));
    card.querySelector(`[data-addzub="${pos.id}"]`).addEventListener('click', ()=>{
      pos.zubehoerItems.push({zubehoerId:'', anzahl:1});
      renderZubItemsForPosition(pos, card.querySelector(`[data-zubbox="${pos.id}"]`));
      refreshLivePreview();
    });
    updateAmsWarn(pos, card);
    card.addEventListener('input', ()=> updateAmsWarn(pos, card));
  });

  box.querySelectorAll('[data-pfield]').forEach(el=>{
    el.addEventListener('input', e=>{
      const pos = positionen.find(p=>p.id===e.target.dataset.pos);
      const field = e.target.dataset.pfield;
      pos[field] = e.target.value;
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
  box.querySelectorAll('[data-duppos]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = positionen.findIndex(p=>p.id===btn.dataset.duppos);
      if(idx<0) return;
      const clone = JSON.parse(JSON.stringify(positionen[idx]));
      clone.id = uid('p');
      positionen.splice(idx+1,0,clone);
      renderPositionen();
      updateTierHint();
      refreshLivePreview();
    });
  });
  box.querySelectorAll('[data-savevorlage]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const pos = positionen.find(p=>p.id===btn.dataset.savevorlage);
      if(!pos) return;
      const name = prompt('Name der Vorlage:', pos.name || '');
      if(!name || !name.trim()) return;
      vorlagen.push({
        id: uid('v'), name: name.trim(),
        druckzeit: pos.druckzeit, arbeitszeit: pos.arbeitszeit,
        slots: JSON.parse(JSON.stringify(pos.slots)),
        zubehoerItems: JSON.parse(JSON.stringify(pos.zubehoerItems)),
        druckerId: pos.druckerId
      });
      saveVorlagen();
      renderVorlagenList();
      renderVorlageSelect();
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

function renderZubItemsForPosition(pos, container){
  container.innerHTML = '';
  if(!pos.zubehoerItems.length) return;
  pos.zubehoerItems.forEach((item,i)=>{
    const row = document.createElement('div');
    row.className = 'zub-item';
    row.innerHTML = `
      <div class="field">
        <label>Zubehör</label>
        <select data-zidx="${i}" data-zfield="zubehoerId">
          <option value="">— keins —</option>
          ${zubehoer.map(z=>`<option value="${z.id}" ${z.id===item.zubehoerId?'selected':''}>${z.name||'Unbenannt'} (${fmt(z.preis)} €/Stk.)</option>`).join('')}
        </select>
      </div>
      <div class="field qty">
        <label>Anzahl</label>
        <input data-zidx="${i}" data-zfield="anzahl" type="number" min="0" step="1" value="${item.anzahl}">
      </div>
      <button class="icon-btn" data-delzub="${i}" title="Zeile entfernen">✕</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('[data-zfield]').forEach(el=>{
    el.addEventListener('input', e=>{
      const i = parseInt(e.target.dataset.zidx);
      pos.zubehoerItems[i][e.target.dataset.zfield] = e.target.value;
      refreshLivePreview();
    });
  });
  container.querySelectorAll('[data-delzub]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      pos.zubehoerItems.splice(parseInt(btn.dataset.delzub),1);
      renderZubItemsForPosition(pos, container);
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

// ---------- Sofortschätzung aus STL/3MF (ungesliced, ohne Slicing) ----------
// Massivvolumen eines Dreiecksnetzes über die Divergenz-/Tetraeder-Formel (Vorzeichen je nach Normalenrichtung)
function meshSignedVolumeMm3(vertices, triangles){
  let vol = 0;
  for(const t of triangles){
    const v1 = vertices[t[0]], v2 = vertices[t[1]], v3 = vertices[t[2]];
    if(!v1 || !v2 || !v3) continue;
    vol += (v1[0]*(v2[1]*v3[2]-v3[1]*v2[2])
          - v1[1]*(v2[0]*v3[2]-v3[0]*v2[2])
          + v1[2]*(v2[0]*v3[1]-v3[0]*v2[1])) / 6;
  }
  return Math.abs(vol);
}

function parseStlBinary(buffer){
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  const vertices = [], triangles = [];
  let offset = 84;
  for(let i=0;i<triCount;i++){
    offset += 12; // Normalenvektor überspringen
    const idx = [];
    for(let k=0;k<3;k++){
      const x = dv.getFloat32(offset, true); offset+=4;
      const y = dv.getFloat32(offset, true); offset+=4;
      const z = dv.getFloat32(offset, true); offset+=4;
      vertices.push([x,y,z]);
      idx.push(vertices.length-1);
    }
    triangles.push(idx);
    offset += 2; // Attribut-Byte-Count
  }
  return {vertices, triangles};
}

function parseStlAscii(text){
  const vertices = [];
  const vertexRegex = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  while((m = vertexRegex.exec(text)) !== null){
    vertices.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }
  const triangles = [];
  for(let i=0;i+2<vertices.length;i+=3) triangles.push([i,i+1,i+2]);
  return {vertices, triangles};
}

function parseStlVolumeMm3(buffer){
  const dv = new DataView(buffer);
  let parsed = null;
  if(buffer.byteLength >= 84){
    const triCount = dv.getUint32(80, true);
    if(84 + triCount*50 === buffer.byteLength) parsed = parseStlBinary(buffer);
  }
  if(!parsed) parsed = parseStlAscii(new TextDecoder('utf-8').decode(buffer));
  if(!parsed.triangles.length) throw new Error('Keine Dreiecke in der STL-Datei gefunden.');
  return meshSignedVolumeMm3(parsed.vertices, parsed.triangles);
}

const MODEL_UNIT_TO_MM = {micron:0.001, millimeter:1, centimeter:10, meter:1000, inch:25.4, foot:304.8};

async function parse3mfVolumeMm3(file){
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const modelEntry = Object.keys(zip.files).find(k => /3d\/3dmodel\.model$/i.test(k));
  if(!modelEntry) throw new Error('Kein 3D-Modell in der Datei gefunden (evtl. keine gültige 3MF-Datei).');
  const xml = await zip.files[modelEntry].async('text');

  const unitMatch = xml.match(/<model[^>]*\bunit="([^"]+)"/i);
  const scale = MODEL_UNIT_TO_MM[(unitMatch ? unitMatch[1] : 'millimeter').toLowerCase()] || 1;

  let totalVolumeMm3 = 0;
  const objectRegex = /<object\b[^>]*>([\s\S]*?)<\/object>/g;
  let om;
  while((om = objectRegex.exec(xml)) !== null){
    const meshMatch = om[1].match(/<mesh>([\s\S]*?)<\/mesh>/);
    if(!meshMatch) continue;
    const meshXml = meshMatch[1];
    const vertices = [];
    const vertexRegex = /<vertex\s+x="([-\d.eE+]+)"\s+y="([-\d.eE+]+)"\s+z="([-\d.eE+]+)"/g;
    let vm;
    while((vm = vertexRegex.exec(meshXml)) !== null){
      vertices.push([parseFloat(vm[1])*scale, parseFloat(vm[2])*scale, parseFloat(vm[3])*scale]);
    }
    const triangles = [];
    const triRegex = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
    let tm;
    while((tm = triRegex.exec(meshXml)) !== null){
      triangles.push([parseInt(tm[1]), parseInt(tm[2]), parseInt(tm[3])]);
    }
    totalVolumeMm3 += meshSignedVolumeMm3(vertices, triangles);
  }
  if(totalVolumeMm3 <= 0) throw new Error('Konnte kein druckbares Volumen aus der Datei berechnen (evtl. schon gesliced – dafür „Gesliste .gcode.3mf importieren“ nutzen).');
  return totalVolumeMm3;
}

async function importInstantEstimate(file){
  const msg = $('#mf3Msg');
  msg.innerHTML = `<div class="import-msg">Berechne Volumen aus „${file.name}“…</div>`;
  try{
    const ext = file.name.split('.').pop().toLowerCase();
    let volumeMm3;
    if(ext === 'stl'){
      volumeMm3 = parseStlVolumeMm3(await file.arrayBuffer());
    } else if(ext === '3mf'){
      volumeMm3 = await parse3mfVolumeMm3(file);
    } else {
      msg.innerHTML = `<div class="import-msg warn">Nicht unterstütztes Dateiformat. Bitte .stl oder eine ungeslicte .3mf wählen.</div>`;
      return;
    }
    showEstimateForm(file.name, volumeMm3/1000);
  }catch(e){
    console.error(e);
    msg.innerHTML = `<div class="import-msg warn">Datei konnte nicht gelesen werden: ${e.message}</div>`;
  }
}

function showEstimateForm(fileName, volumeCm3){
  const msg = $('#mf3Msg');
  const infillDefault = allgemein.infillEstimatePct ?? 20;
  msg.innerHTML = `
    <div class="import-msg ok">Berechnetes Modellvolumen: ${fmt(volumeCm3)} cm³ (reines Massivvolumen, ohne Infill/Wandstärke berücksichtigt).</div>
    <div class="panel" style="margin:10px 0 0; padding:14px;">
      <p class="hint" style="margin-bottom:12px;">⚡ <strong>Sofortschätzung ohne Slicing</strong> – deutlich ungenauer als der 3MF/G-Code-Import mit echten Slicer-Daten (ignoriert Wandstärken, Stützstrukturen, echte Druckgeschwindigkeit). Nur als grobe Vorab-Einschätzung nutzen und vor dem Angebot mit einem echten Slice prüfen.</p>
      <div class="row g3">
        <div class="field">
          <label>Material</label>
          <select id="estMaterial">
            ${filamente.length ? filamente.map(f=>`<option value="${f.id}">${f.material} · ${f.farbe||'ohne Farbname'}</option>`).join('') : '<option value="">— erst Filament in Stammdaten anlegen —</option>'}
          </select>
        </div>
        <div class="field">
          <label>Infill (%)</label>
          <input id="estInfill" type="number" min="1" max="100" step="1" value="${infillDefault}">
        </div>
        <div class="field">
          <label>Stückzahl</label>
          <input id="estStueckzahl" type="number" min="1" step="1" value="1">
        </div>
      </div>
      <button class="add-btn" id="estUebernehmenBtn" style="margin-top:12px;" ${filamente.length?'':'disabled'}>+ Als Position übernehmen</button>
    </div>
  `;
  $('#estUebernehmenBtn').addEventListener('click', ()=>{
    const fil = filamente.find(f=>f.id===$('#estMaterial').value);
    if(!fil) return;
    const infillPct = parseFloat($('#estInfill').value)||20;
    const stueckzahl = parseInt($('#estStueckzahl').value)||1;
    const density = MATERIAL_DENSITY[fil.material] ?? 1.24;
    const grams = volumeCm3 * (infillPct/100) * density;
    const filamentVolumeMm3 = density>0 ? (grams/density) * 1000 : 0;
    const rate = allgemein.volumenrateMm3S || 15;
    const druckzeitH = filamentVolumeMm3 / rate / 3600;

    const isEmpty = p => !p.name && !parseFloat(p.druckzeit) && !parseFloat(p.arbeitszeit) && !p.slots.some(s=>s && s.filamentId);
    if(positionen.length === 1 && isEmpty(positionen[0])) positionen = [];
    addPosition({
      name: `${fileName.replace(/\.(stl|3mf)$/i,'')} (Sofortschätzung ⚡ – bitte prüfen)`,
      stueckzahl,
      druckzeit: +druckzeitH.toFixed(2),
      arbeitszeit: 0,
      slots: [{filamentId: fil.id, gramm: String(Math.round(grams*10)/10)}, null, null, null]
    });
    renderPositionen();
    updateTierHint();
    refreshLivePreview();
    $('#mf3Msg').innerHTML = `<div class="import-msg ok">Position aus „${fileName}“ als Sofortschätzung übernommen (${fmt(grams)} g, ${druckzeitH.toFixed(2)} Std.). Bitte vor dem Angebot mit einem echten Slice prüfen.</div>`;
  });
}

$('#estimateImportBtn').addEventListener('click', ()=> $('#estimateFile').click());
$('#estimateFile').addEventListener('change', e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(file) importInstantEstimate(file);
});

// ---------- Liefertermin-Schätzung & Express ----------
function estimateLieferterminInfo(){
  const gesamtStd = positionen.reduce((s,p)=> s + (parseFloat(p.druckzeit)||0), 0);
  const anzahlDrucker = Math.max(drucker.length, 1);
  const stdProTag = allgemein.stdProTag || 16;
  const tageDruck = gesamtStd>0 ? Math.ceil(gesamtStd / anzahlDrucker / stdProTag) : 0;
  let pufferTage = allgemein.pufferTage || 0;
  if($('#express').checked) pufferTage = Math.ceil(pufferTage/2);
  const gesamtTage = Math.max(tageDruck + pufferTage, 1);
  const d = new Date(); d.setDate(d.getDate()+gesamtTage);
  return {gesamtStd, anzahlDrucker, stdProTag, tageDruck, pufferTage, gesamtTage, datum:d};
}

function updateTerminHint(){
  const info = estimateLieferterminInfo();
  $('#terminHint').textContent = `Geschätzt: ${fmt(info.gesamtStd)} Std. Druckzeit über ${info.anzahlDrucker} Drucker (${info.stdProTag} Std./Tag) → ${info.tageDruck} Tag(e) + ${info.pufferTage} Puffertag(e) ≈ ${info.datum.toLocaleDateString('de-DE')}. Mit „Termin schätzen“ übernehmen.`;
}

$('#terminSchaetzenBtn').addEventListener('click', ()=>{
  const info = estimateLieferterminInfo();
  $('#liefertermin').value = info.datum.toISOString().slice(0,10);
});

$('#express').addEventListener('change', ()=>{
  if($('#express').checked && !(parseFloat($('#expressPct').value)>0)) $('#expressPct').value = allgemein.expressPct;
  refreshLivePreview();
});
$('#expressPct').addEventListener('input', refreshLivePreview);

// ---------- Berechnung (gemeinsam für Anzeige + CSV/PDF-Export) ----------
function roundPrice(value, step){
  if(!step || step<=0) return Math.round(value*100)/100;
  return Math.round(value/step) * step;
}

function computeQuote(){
  const marginPct = parseFloat($('#margin').value)||0;
  const extraDiscountPct = parseFloat($('#extraDiscount').value)||0;
  const jobName = $('#jobName').value.trim();
  const expressOn = $('#express').checked;
  const expressPct = expressOn ? (parseFloat($('#expressPct').value)||0) : 0;
  const kunde = {
    name: $('#kundeName').value.trim(),
    firma: $('#kundeFirma').value.trim(),
    email: $('#kundeEmail').value.trim(),
    telefon: $('#kundeTelefon').value.trim(),
    adresse: $('#kundeAdresse').value.trim()
  };
  const liefertermin = $('#liefertermin').value;
  const versandBetrag = parseFloat($('#versand').value)||0;

  let materialTotal=0, stromTotal=0, wartungTotal=0, arbeitTotal=0, zubehoerTotal=0, abschreibungTotal=0, amsRuestStunden=0, amsPositionen=0;
  const posLines = [];

  positionen.forEach((pos,idx)=>{
    const stueckzahl = parseInt(pos.stueckzahl)||1;
    const druckzeit = parseFloat(pos.druckzeit)||0;
    let arbeitszeit = parseFloat(pos.arbeitszeit)||0;

    const usedSlots = pos.slots.filter(s=> s && s.filamentId && parseFloat(s.gramm)>0);
    const posDrucker = drucker.find(d=>d.id===pos.druckerId) || drucker[0] || null;

    // AMS-Rüstzuschlag: automatisch, wenn eine Position mehr als 1 Filament nutzt UND der zugeordnete Drucker AMS-fähig ist
    let amsZuschlagH = 0;
    let amsWarn = false;
    if(usedSlots.length > 1){
      if(posDrucker && posDrucker.amsFaehig){
        amsZuschlagH = (allgemein.amsRuestMin||0) / 60;
        amsRuestStunden += amsZuschlagH;
        amsPositionen++;
        arbeitszeit += amsZuschlagH;
      } else {
        amsWarn = true;
      }
    }

    const material = usedSlots.reduce((sum,s)=>{
      const f = filamente.find(x=>x.id===s.filamentId);
      if(!f) return sum;
      return sum + (parseFloat(s.gramm)/1000) * f.preis;
    },0);
    const leistungW = posDrucker ? (posDrucker.leistung||0) : (allgemein.leistung||0);
    const strom = (leistungW/1000) * druckzeit * allgemein.strompreis;
    // Wartungssatz je Druckstunde: höchster Gruppenpreis der in dieser Position verwendeten Filamente
    const wartungssatz = usedSlots.reduce((max,s)=>{
      const f = filamente.find(x=>x.id===s.filamentId);
      const z = f ? (materialgruppen[groupOf(f.material)] ?? GROUP_DEFAULTS[groupOf(f.material)] ?? 0) : 0;
      return Math.max(max, z);
    }, 0);
    const wartung = wartungssatz * druckzeit;
    const arbeit = allgemein.arbeit * arbeitszeit;
    const zub = (pos.zubehoerItems||[]).reduce((sum,it)=>{
      const z = zubehoer.find(x=>x.id===it.zubehoerId);
      if(!z) return sum;
      return sum + (parseFloat(it.anzahl)||0) * z.preis;
    },0);
    const abschreibung = druckerAbschreibungProStunde(posDrucker) * druckzeit;
    const subtotal = material+strom+wartung+arbeit+zub+abschreibung;

    materialTotal += material; stromTotal += strom; wartungTotal += wartung; arbeitTotal += arbeit; zubehoerTotal += zub; abschreibungTotal += abschreibung;

    posLines.push({
      nr: idx+1,
      name: pos.name || 'Ohne Namen',
      stueckzahl,
      subtotal,
      proStueck: subtotal/stueckzahl,
      amsZuschlag: amsZuschlagH > 0,
      amsWarn,
      druckerName: posDrucker ? posDrucker.name : '–'
    });
  });

  const sumStueckzahl = totalStueckzahl();
  const kostenSumme = materialTotal + stromTotal + wartungTotal + arbeitTotal + zubehoerTotal + abschreibungTotal + versandBetrag;

  const ausschussBetrag = kostenSumme * ((allgemein.ausschussPct||0)/100);
  const zwischensumme = kostenSumme + ausschussBetrag;

  const expressBetrag = zwischensumme * (expressPct/100);
  const nachExpress = zwischensumme + expressBetrag;

  const gewinn = nachExpress * (marginPct/100);
  const nachGewinn = nachExpress + gewinn;

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

  return {jobName, kunde, liefertermin, posLines, materialTotal, stromTotal, wartungTotal, arbeitTotal, zubehoerTotal, abschreibungTotal, versandBetrag,
    amsRuestStunden, amsPositionen, kostenSumme, ausschussPct: allgemein.ausschussPct||0, ausschussBetrag,
    zwischensumme, expressOn, expressPct, expressBetrag, marginPct, gewinn, tierPct, extraDiscountPct, totalDiscountPct,
    rabattBetrag, nettoGesamt, kleinunternehmer, mwstSatz, mwstBetrag, bruttoGesamt,
    rundungsDiff, gesamt, sumStueckzahl};
}

function buildResultHtml(q){
  let html = '';
  if(q.jobName) html += `<h2 style="margin-bottom:2px;">${q.jobName}</h2>`;
  if(q.kunde && q.kunde.name) html += `<div style="color:var(--muted); font-size:12.5px; margin-bottom:4px;">Kunde: ${q.kunde.name}${q.kunde.firma?' · '+q.kunde.firma:''}</div>`;
  if(q.liefertermin) html += `<div style="color:var(--muted); font-size:12.5px; margin-bottom:14px;">Voraussichtlicher Liefertermin: ${new Date(q.liefertermin+'T00:00:00').toLocaleDateString('de-DE')}</div>`;

  html += `<h3>Positionen</h3>`;
  html += q.posLines.map(l=>`<div class="pos-line"><span>${l.nr}. ${l.name} (${l.stueckzahl} Stk.)${l.amsZuschlag?' · AMS':''}${l.amsWarn?' · ⚠ kein AMS':''}</span><span>${fmt(l.subtotal)} € · ${fmt(l.proStueck)} €/Stk.</span></div>`).join('');

  html += `<h3>Kosten gesamt</h3>`;
  html += `<div class="line"><span>Materialkosten</span><span>${fmt(q.materialTotal)} €</span></div>`;
  html += `<div class="line"><span>Stromkosten</span><span>${fmt(q.stromTotal)} €</span></div>`;
  html += `<div class="line"><span>Wartung & Verschleiß</span><span>${fmt(q.wartungTotal)} €</span></div>`;
  let arbeitLabel = 'Arbeitskosten';
  if(q.amsPositionen>0) arbeitLabel += ` (inkl. AMS-Rüstzuschlag: ${q.amsPositionen} Pos. à ${allgemein.amsRuestMin} Min.)`;
  html += `<div class="line"><span>${arbeitLabel}</span><span>${fmt(q.arbeitTotal)} €</span></div>`;
  if(q.zubehoerTotal>0) html += `<div class="line"><span>Zubehör/Hardware</span><span>${fmt(q.zubehoerTotal)} €</span></div>`;
  if(q.abschreibungTotal>0) html += `<div class="line"><span>Maschinenabschreibung</span><span>${fmt(q.abschreibungTotal)} €</span></div>`;
  if(q.versandBetrag>0) html += `<div class="line"><span>Versand & Verpackung</span><span>${fmt(q.versandBetrag)} €</span></div>`;
  html += `<div class="line"><span>Kostensumme</span><span>${fmt(q.kostenSumme)} €</span></div>`;
  if(q.ausschussPct>0) html += `<div class="line"><span>Ausschuss-Puffer (${q.ausschussPct}%)</span><span>${fmt(q.ausschussBetrag)} €</span></div>`;
  html += `<div class="line"><span>Zwischensumme</span><span>${fmt(q.zwischensumme)} €</span></div>`;
  if(q.expressPct>0) html += `<div class="line"><span>Express-Zuschlag (${q.expressPct}%)</span><span>${fmt(q.expressBetrag)} €</span></div>`;
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
    try{ updateTerminHint(); }catch(e){ /* still ok while editing */ }
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
  if(q.liefertermin) rows.push(['Voraussichtlicher Liefertermin', new Date(q.liefertermin+'T00:00:00').toLocaleDateString('de-DE')]);
  if(q.kunde && q.kunde.name){
    rows.push([]);
    rows.push(['Kunde', q.kunde.name]);
    if(q.kunde.firma) rows.push(['Firma', q.kunde.firma]);
    if(q.kunde.adresse) rows.push(['Adresse', q.kunde.adresse]);
    if(q.kunde.email) rows.push(['E-Mail', q.kunde.email]);
    if(q.kunde.telefon) rows.push(['Telefon', q.kunde.telefon]);
  }
  rows.push([]);
  rows.push(['Pos.','Produkt','Stückzahl','Einzelpreis (€)','Gesamtpreis (€)']);
  q.posLines.forEach(l=>{
    rows.push([l.nr, l.name, l.stueckzahl, csvNum(l.proStueck), csvNum(l.subtotal)]);
  });
  rows.push([]);
  rows.push(['','','','Kostensumme', csvNum(q.kostenSumme)]);
  if(q.zubehoerTotal>0) rows.push(['','','','davon Zubehör/Hardware', csvNum(q.zubehoerTotal)]);
  if(q.abschreibungTotal>0) rows.push(['','','','davon Maschinenabschreibung', csvNum(q.abschreibungTotal)]);
  if(q.versandBetrag>0) rows.push(['','','','davon Versand & Verpackung', csvNum(q.versandBetrag)]);
  if(q.ausschussPct>0) rows.push(['','','',`Ausschuss-Puffer (${q.ausschussPct}%)`, csvNum(q.ausschussBetrag)]);
  rows.push(['','','','Zwischensumme', csvNum(q.zwischensumme)]);
  if(q.expressPct>0) rows.push(['','','',`Express-Zuschlag (${q.expressPct}%)`, csvNum(q.expressBetrag)]);
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
  const csv = '﻿' + rows.map(r=>r.map(csvEsc).join(';')).join('\n');
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

// ---------- PDF-Export (Preisangebot) ----------
function buildPdfDoc(q, meta){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 15;

  // Briefkopf: Logo + Absenderdaten aus dem Firmenprofil (Stammdaten)
  let headBottom = y;
  if(firma.logoDataUrl){
    try{
      const typeMatch = /^data:image\/(\w+);/.exec(firma.logoDataUrl);
      const imgFormat = typeMatch ? typeMatch[1].toUpperCase() : 'PNG';
      const maxW = 35, maxH = 20;
      let w = maxW, h = maxH;
      if(firma.logoW && firma.logoH){
        const ratio = firma.logoW / firma.logoH;
        if(maxW / ratio <= maxH){ w = maxW; h = maxW / ratio; }
        else { h = maxH; w = maxH * ratio; }
      }
      doc.addImage(firma.logoDataUrl, imgFormat, 14, y, w, h);
      headBottom = Math.max(headBottom, y + h);
    }catch(e){ /* Logo nicht lesbar - PDF trotzdem ohne Logo erzeugen */ }
  }
  if(firma.name || firma.adresse || firma.email || firma.telefon){
    let fy = y + 4;
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    if(firma.name){ doc.text(firma.name, 196, fy, {align:'right'}); fy += 5; }
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    [
      firma.ansprechpartner,
      firma.adresse,
      [firma.telefon, firma.email].filter(Boolean).join(' · '),
      firma.website,
      firma.ustId ? `USt-ID: ${firma.ustId}` : (firma.steuernummer ? `St.-Nr.: ${firma.steuernummer}` : '')
    ].filter(Boolean).forEach(line=>{ doc.text(line, 196, fy, {align:'right'}); fy += 4; });
    doc.setTextColor(0);
    headBottom = Math.max(headBottom, fy);
  }
  if(headBottom > y){
    y = headBottom + 4;
    doc.setDrawColor(220); doc.line(14, y, 196, y);
    y += 8;
  }

  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.text('Preisangebot', 14, y); y += 8;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  if(meta && meta.nummer && meta.nummer !== 'wird beim Speichern vergeben'){ doc.text(`Angebots-Nr.: ${meta.nummer}`, 14, y); y += 5; }
  doc.text(`Datum: ${(meta && meta.datum) || new Date().toLocaleDateString('de-DE')}`, 14, y); y += 5;
  if(meta && meta.gueltigBis){ doc.text(`Gültig bis: ${meta.gueltigBis}`, 14, y); y += 5; }
  if(q.liefertermin){ doc.text(`Voraussichtlicher Liefertermin: ${new Date(q.liefertermin+'T00:00:00').toLocaleDateString('de-DE')}`, 14, y); y += 5; }
  if(q.jobName){ doc.text(`Auftrag: ${q.jobName}`, 14, y); y += 5; }
  y += 3;

  if(q.kunde && q.kunde.name){
    doc.setFont('helvetica','bold'); doc.text('Kunde', 14, y); y += 5;
    doc.setFont('helvetica','normal');
    doc.text(q.kunde.name, 14, y); y += 5;
    if(q.kunde.firma){ doc.text(q.kunde.firma, 14, y); y += 5; }
    if(q.kunde.adresse){ doc.text(q.kunde.adresse, 14, y); y += 5; }
    if(q.kunde.email){ doc.text(q.kunde.email, 14, y); y += 5; }
    if(q.kunde.telefon){ doc.text(q.kunde.telefon, 14, y); y += 5; }
    y += 3;
  }

  doc.autoTable({
    startY: y,
    head: [['Pos.','Produkt','Stückzahl','Einzelpreis (€)','Gesamtpreis (€)']],
    body: q.posLines.map(l=>[l.nr, l.name, l.stueckzahl, fmt(l.proStueck), fmt(l.subtotal)]),
    theme: 'grid',
    headStyles: {fillColor:[242,84,45]},
    styles: {fontSize:9}
  });
  y = doc.lastAutoTable.finalY + 8;

  const summaryRows = [];
  summaryRows.push(['Kostensumme', fmt(q.kostenSumme)+' €']);
  if(q.zubehoerTotal>0) summaryRows.push(['davon Zubehör/Hardware', fmt(q.zubehoerTotal)+' €']);
  if(q.abschreibungTotal>0) summaryRows.push(['davon Maschinenabschreibung', fmt(q.abschreibungTotal)+' €']);
  if(q.versandBetrag>0) summaryRows.push(['davon Versand & Verpackung', fmt(q.versandBetrag)+' €']);
  if(q.ausschussPct>0) summaryRows.push([`Ausschuss-Puffer (${q.ausschussPct}%)`, fmt(q.ausschussBetrag)+' €']);
  summaryRows.push(['Zwischensumme', fmt(q.zwischensumme)+' €']);
  if(q.expressPct>0) summaryRows.push([`Express-Zuschlag (${q.expressPct}%)`, fmt(q.expressBetrag)+' €']);
  if(q.marginPct>0) summaryRows.push([`Gewinnaufschlag (${q.marginPct}%)`, fmt(q.gewinn)+' €']);
  if(q.totalDiscountPct>0){
    let label = 'Nachlass';
    if(q.tierPct>0 && q.extraDiscountPct>0) label = `Nachlass (Mengenrabatt ${q.tierPct}% + Zusatz ${q.extraDiscountPct}%)`;
    else if(q.tierPct>0) label = `Mengenrabatt (${q.tierPct}%)`;
    else label = `Zusätzlicher Nachlass (${q.extraDiscountPct}%)`;
    summaryRows.push([label, '−'+fmt(q.rabattBetrag)+' €']);
  }
  summaryRows.push(['Netto-Gesamt', fmt(q.nettoGesamt)+' €']);
  summaryRows.push(['Umsatzsteuer', q.kleinunternehmer ? 'gem. §19 UStG nicht ausgewiesen' : `${q.mwstSatz}% = ${fmt(q.mwstBetrag)} €`]);
  summaryRows.push(['Gesamtpreis', fmt(q.gesamt)+' €']);
  if(q.sumStueckzahl>0) summaryRows.push(['Ø Preis / Stück', fmt(q.gesamt/q.sumStueckzahl)+' €']);

  doc.autoTable({
    startY: y,
    body: summaryRows,
    theme: 'plain',
    styles: {fontSize:10},
    columnStyles: {0:{cellWidth:120}, 1:{halign:'right'}},
    didParseCell: function(data){
      if(data.row.index === summaryRows.length-1){ data.cell.styles.fontStyle='bold'; data.cell.styles.fontSize=12; }
    }
  });

  const footerLines = [];
  if(firma.iban) footerLines.push(`Zahlung per Überweisung: IBAN ${firma.iban}${firma.bic ? ' · BIC '+firma.bic : ''}${firma.name ? ' · '+firma.name : ''}`);
  if(q.kleinunternehmer) footerLines.push('Gemäß §19 UStG wird keine Umsatzsteuer berechnet und ausgewiesen.');
  if(footerLines.length){
    y = doc.lastAutoTable.finalY + 8;
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120);
    footerLines.forEach(line=>{ doc.text(line, 14, y); y += 4; });
  }

  return doc;
}

function pdfSafeName(q, prefix){
  const safeName = (q.jobName || 'angebot').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return `preisangebot_${prefix?prefix+'_':''}${safeName || 'angebot'}.pdf`;
}

$('#exportPdfBtn').addEventListener('click', ()=>{
  if(!window.jspdf){ alert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung beim ersten Laden der Seite erforderlich).'); return; }
  const q = computeQuote();
  const doc = buildPdfDoc(q, {nummer: $('#angebotsNr').value, gueltigBis: $('#gueltigBis').value});
  doc.save(pdfSafeName(q));
});

// ---------- Angebot per E-Mail senden ----------
$('#mailAngebotBtn').addEventListener('click', ()=>{
  if(!window.jspdf){ alert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung beim ersten Laden der Seite erforderlich).'); return; }
  const q = computeQuote();
  if(!positionen.length || !q.sumStueckzahl){
    alert('Bitte zuerst mindestens eine Position mit Stückzahl anlegen.');
    return;
  }
  const doc = buildPdfDoc(q, {nummer: $('#angebotsNr').value, gueltigBis: $('#gueltigBis').value});
  const filename = pdfSafeName(q);
  doc.save(filename);

  const to = q.kunde.email || '';
  const nummer = $('#angebotsNr').value;
  const subject = `Ihr Angebot${nummer && nummer!=='wird beim Speichern vergeben' ? ' '+nummer : ''}${q.jobName ? ' – '+q.jobName : ''}`;
  const anrede = q.kunde.name ? `Hallo ${q.kunde.name.split(' ')[0]},` : 'Hallo,';
  const body = `${anrede}\n\nanbei unser Angebot über ${fmt(q.gesamt)} € (${q.sumStueckzahl} Stk.).\n\nBitte die soeben heruntergeladene Datei „${filename}“ dieser E-Mail noch manuell anhängen – aus Sicherheitsgründen können Browser Anhänge nicht automatisch beifügen.\n\nViele Grüße${firma.name ? '\n'+firma.name : ''}`;
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

// ---------- Archiv: Angebote speichern/laden/löschen ----------
function nextAngebotsNummer(){
  angebotsCounter++;
  const jahr = new Date().getFullYear();
  return `A-${jahr}-${String(angebotsCounter).padStart(3,'0')}`;
}

// Lädt ein gespeichertes Angebot zum Weiterbearbeiten in die Kalkulation (Archiv + Kunden-Tab)
function loadAngebotInForm(a){
  if(!a) return;
  positionen = JSON.parse(JSON.stringify(a.positionen));
  positionen.forEach(p=>{
    if(!p.druckerId || !drucker.some(d=>d.id===p.druckerId)) p.druckerId = drucker[0] ? drucker[0].id : '';
    if(!p.zubehoerItems) p.zubehoerItems = [];
  });
  $('#jobName').value = a.jobName || '';
  $('#angebotsNr').value = a.nummer;
  $('#gueltigBis').value = a.gueltigBis || '';
  $('#liefertermin').value = a.liefertermin || '';
  $('#margin').value = a.margin;
  $('#extraDiscount').value = a.extraDiscount;
  $('#express').checked = !!a.express;
  $('#expressPct').value = a.expressPct || allgemein.expressPct;
  $('#versand').value = a.versand || 0;
  const k = a.kunde || {};
  $('#kundeName').value = k.name || '';
  $('#kundeFirma').value = k.firma || '';
  $('#kundeEmail').value = k.email || '';
  $('#kundeTelefon').value = k.telefon || '';
  $('#kundeAdresse').value = k.adresse || '';
  renderPositionen();
  updateTierHint();
  refreshLivePreview();
  document.querySelector('.tab[data-view="kalk"]').click();
}

// Status eines Angebots inkl. automatischer "Abgelaufen"-Anzeige (offen + gültig-bis überschritten)
function angebotStatusInfo(a){
  const STATUS_MAP = {
    offen: {label:'Offen', cls:'status-offen'},
    angenommen: {label:'Angenommen', cls:'status-angenommen'},
    abgelehnt: {label:'Abgelehnt', cls:'status-abgelehnt'}
  };
  const value = (a.status && STATUS_MAP[a.status]) ? a.status : 'offen';
  if(value === 'offen' && a.gueltigBis){
    const heute = new Date(); heute.setHours(0,0,0,0);
    if(new Date(a.gueltigBis+'T00:00:00') < heute){
      return {value, label:'Abgelaufen', cls:'status-abgelaufen'};
    }
  }
  return Object.assign({value}, STATUS_MAP[value]);
}

function renderArchiv(){
  const box = $('#archivList');
  box.innerHTML = '';
  $('#archivEmpty').style.display = angebote.length ? 'none' : 'block';

  [...angebote].reverse().forEach(a=>{
    const info = angebotStatusInfo(a);
    const offenLabel = info.value === 'offen' ? info.label : 'Offen';
    const row = document.createElement('div');
    row.className = 'archiv-row';
    row.innerHTML = `
      <div class="arow-top">
        <span class="anr">${a.nummer}</span>
        <span class="aprice">${fmt(a.ergebnis.gesamt)} €</span>
      </div>
      <div class="aname">${a.jobName || 'Ohne Bezeichnung'}${a.kunde && a.kunde.name ? ' · '+a.kunde.name : ''}</div>
      <div class="ameta">Erstellt: ${a.datum} · Gültig bis: ${a.gueltigBis || '–'}${a.liefertermin ? ' · Liefertermin: '+new Date(a.liefertermin+'T00:00:00').toLocaleDateString('de-DE') : ''} · ${a.ergebnis.sumStueckzahl} Stk. · ${a.positionen.length} Position(en)${a.express?' · Express':''}</div>
      <div class="abtns">
        <select class="status-select ${info.cls}" data-statussel="${a.id}" title="Angebots-Status">
          <option value="offen" ${info.value==='offen'?'selected':''}>${offenLabel}</option>
          <option value="angenommen" ${info.value==='angenommen'?'selected':''}>Angenommen</option>
          <option value="abgelehnt" ${info.value==='abgelehnt'?'selected':''}>Abgelehnt</option>
        </select>
        <button class="ghost-btn" data-load="${a.id}">Laden</button>
        <button class="ghost-btn" data-csv="${a.id}">⇩ CSV</button>
        <button class="ghost-btn" data-pdf="${a.id}">⇩ PDF</button>
        <button class="icon-btn" data-delA="${a.id}" title="Angebot löschen">✕</button>
      </div>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-statussel]').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const a = angebote.find(x=>x.id===e.target.dataset.statussel);
      a.status = e.target.value;
      saveAngebote();
      renderArchiv();
      renderKundenVerwaltung();
    });
  });
  box.querySelectorAll('[data-load]').forEach(btn=>{
    btn.addEventListener('click', ()=> loadAngebotInForm(angebote.find(x=>x.id===btn.dataset.load)));
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
  box.querySelectorAll('[data-pdf]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(!window.jspdf){ alert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung beim ersten Laden der Seite erforderlich).'); return; }
      const a = angebote.find(x=>x.id===btn.dataset.pdf);
      if(!a) return;
      const doc = buildPdfDoc(a.ergebnis, {nummer: a.nummer, datum: a.datum, gueltigBis: a.gueltigBis});
      doc.save(pdfSafeName(a.ergebnis, a.nummer));
    });
  });
  box.querySelectorAll('[data-delA]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      angebote = angebote.filter(x=>x.id!==btn.dataset.delA);
      saveAngebote();
      renderArchiv();
      renderKundenVerwaltung();
    });
  });
}

$('#saveAngebotBtn').addEventListener('click', ()=>{
  const q = computeQuote();
  if(!positionen.length || !q.sumStueckzahl){
    alert('Bitte zuerst mindestens eine Position mit Stückzahl anlegen.');
    return;
  }
  if(q.kunde.name) upsertKunde();
  const nummer = nextAngebotsNummer();
  $('#angebotsNr').value = nummer;
  const eintrag = {
    id: uid('a'),
    nummer,
    status: 'offen',
    datum: new Date().toLocaleDateString('de-DE'),
    gueltigBis: $('#gueltigBis').value,
    liefertermin: $('#liefertermin').value,
    jobName: q.jobName,
    kunde: q.kunde,
    express: q.expressOn,
    expressPct: q.expressPct,
    versand: q.versandBetrag,
    positionen: JSON.parse(JSON.stringify(positionen)),
    margin: q.marginPct,
    extraDiscount: q.extraDiscountPct,
    ergebnis: q
  };
  angebote.push(eintrag);
  saveAngebotsCounter();
  saveAngebote();
  renderArchiv();
  renderKundenVerwaltung();
  alert(`Angebot ${nummer} gespeichert (${fmt(q.gesamt)} €). Im Archiv abrufbar.`);
});

// ---------- Stammdaten-Backup ----------
$('#exportBackupBtn').addEventListener('click', ()=>{
  const backup = {
    exportiertAm: new Date().toISOString(),
    firma, filamente, allgemein, mengenrabatt, materialgruppen, zubehoer, drucker, kunden, vorlagen
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
    if(!confirm('Backup importieren? Das überschreibt deine aktuellen Stammdaten (Firmenprofil, Filamente, Drucker, Zubehör, Kunden, Vorlagen, Materialgruppen, Mengenrabatt, allgemeine Einstellungen).')) return;

    if(data.firma) firma = Object.assign({}, firma, data.firma);
    if(Array.isArray(data.filamente)) filamente = data.filamente;
    if(data.allgemein) allgemein = Object.assign({}, allgemein, data.allgemein);
    if(Array.isArray(data.mengenrabatt)) mengenrabatt = data.mengenrabatt;
    if(data.materialgruppen) materialgruppen = data.materialgruppen;
    if(Array.isArray(data.zubehoer)) zubehoer = data.zubehoer;
    if(Array.isArray(data.drucker) && data.drucker.length) drucker = data.drucker;
    if(Array.isArray(data.kunden)) kunden = data.kunden;
    if(Array.isArray(data.vorlagen)) vorlagen = data.vorlagen;

    await Promise.all([saveFirma(), saveFilamente(), saveAllgemein(), saveTiers(), saveMaterialGroups(), saveZubehoer(), saveDrucker(), saveKunden(), saveVorlagen()]);
    renderFirmaInputs(); renderFilamentList(); renderGeneralInputs(); renderTierList(); renderMaterialGroups(); renderPositionen();
    renderDruckerList(); renderZubehoerList(); renderKundenVerwaltung(); renderKundenDatalist(); renderVorlagenList(); renderVorlageSelect();
    msg.innerHTML = `<div class="import-msg ok">Backup vom ${new Date(data.exportiertAm||Date.now()).toLocaleString('de-DE')} erfolgreich importiert.</div>`;
  }catch(err){
    msg.innerHTML = `<div class="import-msg warn">Backup konnte nicht gelesen werden: ${err.message}</div>`;
  }
});

loadData();
