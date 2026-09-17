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

// In der Electron-App kann das Fenster nach einem nativen confirm()/alert()-Dialog den
// Tastaturfokus verlieren, sodass sich danach nichts mehr eintippen lässt. Fenster nach
// jedem Dialog automatisch wieder fokussieren (bekannter Workaround für dieses Electron-Verhalten).
(function fixDialogFocusLoss(){
  const nativeConfirm = window.confirm.bind(window);
  const nativeAlert = window.alert.bind(window);
  function refocus(){
    window.focus();
    setTimeout(()=> window.focus(), 0);
  }
  window.confirm = (msg)=>{ const result = nativeConfirm(msg); refocus(); return result; };
  window.alert = (msg)=>{ nativeAlert(msg); refocus(); };
})();

// Sichtbares Fehler-Banner statt eines stillen Absturzes: falls ein unerwarteter Fehler die
// Ausführung unterbricht, sieht man wenigstens WAS schiefgelaufen ist, statt nur "geht nicht mehr".
(function showFatalErrorsVisibly(){
  function showBanner(text){
    let banner = document.getElementById('fatalErrorBanner');
    if(!banner){
      banner = document.createElement('div');
      banner.id = 'fatalErrorBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;padding:10px 14px;font:12px/1.4 monospace;white-space:pre-wrap;max-height:45vh;overflow:auto;';
      document.body.appendChild(banner);
    }
    banner.textContent += (banner.textContent ? '\n\n' : '⚠ Unerwarteter Fehler – bitte diesen Text weitergeben:\n\n') + text;
  }
  window.addEventListener('error', e=>{
    showBanner(`${e.message}\n${e.filename||''}:${e.lineno||''}:${e.colno||''}`);
  });
  window.addEventListener('unhandledrejection', e=>{
    const r = e.reason;
    showBanner(r && r.stack ? r.stack : String(r));
  });
})();

// Eigene Hinweis-/Bestätigungsdialoge statt window.alert()/window.confirm(): native Dialoge
// können in der Electron-App das Fenster nach dem Schließen ohne Tastaturfokus zurücklassen
// (nichts lässt sich mehr eintippen). Diese Dialoge laufen komplett innerhalb der Seite ab.
function showAlert(message){
  return new Promise(resolve=>{
    const overlay = $('#customDialogOverlay');
    const okBtn = $('#customDialogOkBtn');
    const cancelBtn = $('#customDialogCancelBtn');
    $('#customDialogMessage').textContent = message;
    cancelBtn.style.display = 'none';
    overlay.style.display = 'flex';
    function onOk(){
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.style.display = '';
      resolve();
    }
    okBtn.addEventListener('click', onOk);
  });
}
function showConfirm(message){
  return new Promise(resolve=>{
    const overlay = $('#customDialogOverlay');
    const okBtn = $('#customDialogOkBtn');
    const cancelBtn = $('#customDialogCancelBtn');
    $('#customDialogMessage').textContent = message;
    cancelBtn.style.display = '';
    overlay.style.display = 'flex';
    function cleanup(){
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onOk(){ cleanup(); resolve(true); }
    function onCancel(){ cleanup(); resolve(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// Materialkatalog nach Basis-Polymer gruppiert (erscheint im Filament-Dropdown als Optgroups,
// damit trotz der vielen Sorten alles übersichtlich bleibt).
const MATERIAL_FAMILIES = [
  { label:"PLA", items:["PLA Standard","PLA Matte","PLA Silk","PLA HF","PLA Tough","PLA-CF","PLA-GF","PLA Wood","PLA Marble","PLA Glow","PLA Metal / Glitter / Spezial"] },
  { label:"PETG", items:["PETG Standard","PETG HF","PETG-CF","PETG-GF","PETG Transparent","PETG Recycled"] },
  { label:"ABS / ASA", items:["ABS","ABS-GF","ABS-ESD","ASA","ASA-CF","ASA-GF","ASA-ESD"] },
  { label:"PC", items:["PC","PC-CF","PC-GF","PC-ABS","PC-FR"] },
  { label:"PA / Nylon", items:["PA / Nylon","PA6","PA12","PA-CF","PA6-CF","PA12-CF","PAHT-CF","PA6-GF","PA12-GF","PPA-CF","PPA-GF","PPS-CF","PPS-GF"] },
  { label:"PET", items:["PET","PET-CF","PET-GF","PET Transparent"] },
  { label:"TPU / TPE", items:["TPU 95A","TPU 95A HF","TPU 90A","TPU 85A","TPU-CF","TPE","TPE-CF"] },
  { label:"Support", items:["PVA","BVOH","Support PLA/PETG","Support PLA","Support ABS","Support PA/PET","HIPS"] },
  { label:"Spezial", items:["ESD","FR / Flammhemmend","Conductive","Antibacterial","Recycled","Bio-based"] }
];
const MATERIALS = MATERIAL_FAMILIES.flatMap(f=>f.items);

// Verschleißklassen A–F: fester Wartungssatz (€/Druckstunde) je Klasse, jedes Material im
// Filamentkatalog wird genau einer Klasse zugeordnet. Ersetzt die frühere Gruppierung nach
// Materialfamilie – Verschleiß hängt stärker von Faserfüllung/Drucktemperatur als von der
// Polymerfamilie allein ab, daher die direkte Klassenzuordnung je Material im Filamentkatalog.
const VERSCHLEISS_KLASSEN = ["A","B","C","D","E","F"];
const VERSCHLEISS_KLASSEN_DEFAULTS = { A:1.00, B:1.05, C:1.10, D:1.20, E:1.40, F:1.60 };

// Grobe Dichte-Richtwerte (g/cm³) je Material, nur für die Sofortschätzung aus STL/3MF (ohne Slicing) genutzt.
// Färb-/Oberflächenvarianten (Matte, Silk, Transparent, …) übernehmen die Dichte des Basispolymers;
// faserverstärkte/gefüllte Sorten sind spürbar dichter als ihr unverstärktes Gegenstück.
const MATERIAL_DENSITY = {
  "PLA Standard":1.24, "PLA Matte":1.24, "PLA Silk":1.24, "PLA HF":1.24, "PLA Tough":1.22,
  "PLA-CF":1.30, "PLA-GF":1.35, "PLA Wood":1.15, "PLA Marble":1.30, "PLA Glow":1.30,
  "PLA Metal / Glitter / Spezial":1.90,

  "PETG Standard":1.27, "PETG HF":1.27, "PETG-CF":1.31, "PETG-GF":1.35,
  "PETG Transparent":1.27, "PETG Recycled":1.27,

  "ABS":1.04, "ABS-GF":1.15, "ABS-ESD":1.08, "ASA":1.07, "ASA-CF":1.15, "ASA-GF":1.18, "ASA-ESD":1.10,

  "PC":1.20, "PC-CF":1.28, "PC-GF":1.35, "PC-ABS":1.13, "PC-FR":1.25,

  "PA / Nylon":1.14, "PA6":1.14, "PA12":1.01, "PA-CF":1.20, "PA6-CF":1.19, "PA12-CF":1.09,
  "PAHT-CF":1.19, "PA6-GF":1.35, "PA12-GF":1.25, "PPA-CF":1.25, "PPA-GF":1.40, "PPS-CF":1.45, "PPS-GF":1.55,

  "PET":1.33, "PET-CF":1.35, "PET-GF":1.40, "PET Transparent":1.33,

  "TPU 95A":1.21, "TPU 95A HF":1.21, "TPU 90A":1.20, "TPU 85A":1.19, "TPU-CF":1.25, "TPE":1.20, "TPE-CF":1.24,

  "PVA":1.23, "BVOH":1.23, "Support PLA/PETG":1.24, "Support PLA":1.24,
  "Support ABS":1.05, "Support PA/PET":1.15, "HIPS":1.04,

  "ESD":1.15, "FR / Flammhemmend":1.30, "Conductive":1.20,
  "Antibacterial":1.24, "Recycled":1.25, "Bio-based":1.24,

  "PA (Nylon)":1.14, "Sonstiges":1.24
};

// Filamentkatalog: technische Eigenschaften je Material (Vorlage/Richtwerte – im Tab "Filamentkatalog"
// frei änderbar). "klasse" bestimmt den Wartungssatz (siehe VERSCHLEISS_KLASSEN_DEFAULTS oben).
// amsGeeignet/p1sGeeignet: "Ja" | "Nein" | "eingeschränkt" (AMS) bzw. "Ja" | "Nein" | "nur nach Prüfung" (P1S).
const FILAMENTKATALOG_DEFAULTS = {
  "PLA Standard": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Einsteigerfreundlich, kaum Anforderungen."},
  "PLA Matte": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Mattes Finish, Drucktemperatur ggf. leicht höher als Standard-PLA."},
  "PLA Silk": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Seidenglanz-Optik, für besten Glanz oft etwas langsamer drucken."},
  "PLA HF": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"High-Flow-Variante für höhere Druckgeschwindigkeiten."},
  "PLA Tough": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Schlagzäher als Standard-PLA, ähnliche Druckparameter."},
  "PLA-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:false, hinweise:"Carbonfaser-verstärkt, mattes Finish, spürbar steifer."},
  "PLA-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:false, hinweise:"Glasfaser-verstärkt, ähnlich abrasiv wie PLA-CF."},
  "PLA Wood": {klasse:"B", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Enthält echten Holzanteil, Düse ≥0,4 mm empfohlen."},
  "PLA Marble": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Mineralische Pigmentierung für Marmor-Optik."},
  "PLA Glow": {klasse:"B", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:false, hinweise:"Leuchtpigmente können Nozzle-Verschleiß leicht erhöhen."},
  "PLA Metal / Glitter / Spezial": {klasse:"B", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:false, hinweise:"Je nach Produkt unterschiedlich abrasiv – Datenblatt prüfen."},

  "PETG Standard": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Zäher als PLA, neigt zu Stringing."},
  "PETG HF": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"High-Flow-Variante für höhere Druckgeschwindigkeiten."},
  "PETG-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärkt, sehr steif."},
  "PETG-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärkt."},
  "PETG Transparent": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Für klare Optik langsamer und mit Vorsicht drucken."},
  "PETG Recycled": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Recyclingmaterial, Eigenschaften je Charge/Hersteller schwankend."},

  "ABS": {klasse:"B", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Warpt ohne beheizten Bauraum, geschlossenes Gehäuse empfohlen."},
  "ABS-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärkt, steifer und formstabiler als Standard-ABS."},
  "ABS-ESD": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Elektrostatisch ableitfähig, für ESD-Schutzanwendungen."},
  "ASA": {klasse:"B", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"UV-beständiger als ABS, für Außeneinsatz geeignet."},
  "ASA-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärkt."},
  "ASA-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärkt."},
  "ASA-ESD": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Elektrostatisch ableitfähig."},

  "PC": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Sehr schlagzäh und hitzebeständig, hohe Drucktemperatur nötig."},
  "PC-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärkt, sehr steif."},
  "PC-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärkt."},
  "PC-ABS": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Blend aus PC und ABS, guter Kompromiss aus Zähigkeit und Druckbarkeit."},
  "PC-FR": {klasse:"D", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"nur nach Prüfung", trocknung:true, hinweise:"Flammhemmend, höhere Drucktemperatur, für sicherheitsrelevante Anwendungen."},

  "PA / Nylon": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Sehr feuchtigkeitsempfindlich, unbedingt trocken lagern/drucken."},
  "PA6": {klasse:"D", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"nur nach Prüfung", trocknung:true, hinweise:"Höhere Drucktemperatur und Schwindung als Standard-Nylon."},
  "PA12": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Geringere Feuchtigkeitsaufnahme als PA6, etwas einfacher zu verarbeiten."},
  "PA-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärkt, sehr steif und leicht."},
  "PA6-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärktes PA6."},
  "PA12-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärktes PA12."},
  "PAHT-CF": {klasse:"F", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"nur nach Prüfung / meist nicht empfohlen", trocknung:true, hinweise:"Hochtemperatur-Nylon mit Carbonfaser – oft außerhalb der P1S-Einsatzgrenzen (Düsentemperatur/Kammer)."},
  "PA6-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärktes PA6."},
  "PA12-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärktes PA12."},
  "PPA-CF": {klasse:"F", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"nur nach Prüfung / meist nicht empfohlen", trocknung:true, hinweise:"Hochleistungs-Polyphthalamid, sehr hohe Drucktemperatur – Datenblatt vor Einsatz prüfen."},
  "PPA-GF": {klasse:"F", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"nur nach Prüfung / meist nicht empfohlen", trocknung:true, hinweise:"Hochleistungs-Polyphthalamid, glasfaserverstärkt."},
  "PPS-CF": {klasse:"F", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"nur nach Prüfung / meist nicht empfohlen", trocknung:true, hinweise:"Sehr hohe Drucktemperatur (>300 °C), i. d. R. außerhalb der P1S-Spezifikation."},
  "PPS-GF": {klasse:"F", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"nur nach Prüfung / meist nicht empfohlen", trocknung:true, hinweise:"Sehr hohe Drucktemperatur, i. d. R. außerhalb der P1S-Spezifikation."},

  "PET": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Ähnliche Eigenschaften wie PETG, weniger verbreitet."},
  "PET-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärkt."},
  "PET-GF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Glasfaser-verstärkt."},
  "PET Transparent": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Für klare/transparente Optik."},

  "TPU 95A": {klasse:"B", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Flexibel, aber noch vergleichsweise gut förderbar."},
  "TPU 95A HF": {klasse:"B", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"High-Flow-Variante für höhere Druckgeschwindigkeiten."},
  "TPU 90A": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Nein", p1sGeeignet:"Ja, Direktantrieb empfohlen", trocknung:true, hinweise:"Weicher als 95A, Direct-Drive-Extruder empfohlen."},
  "TPU 85A": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Nein", p1sGeeignet:"Ja, Direktantrieb empfohlen", trocknung:true, hinweise:"Sehr weich, anspruchsvoll in der Förderung."},
  "TPU-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"Ja, mit gehärteter Düse (Direktantrieb empfohlen)", trocknung:true, hinweise:"Carbonfaser-verstärktes TPU, Flexibilität kombiniert mit Faserverschleiß."},
  "TPE": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Nein", p1sGeeignet:"Ja, Direktantrieb empfohlen", trocknung:true, hinweise:"Sehr flexibel, ähnlich anspruchsvoll wie TPU 85A."},
  "TPE-CF": {klasse:"E", abrasiv:true, gehaerteteDuese:true, amsGeeignet:"Nein", p1sGeeignet:"Ja, mit gehärteter Düse", trocknung:true, hinweise:"Carbonfaser-verstärktes TPE."},

  "PVA": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Wasserlöslich, extrem feuchtigkeitsempfindlich – trocken lagern."},
  "BVOH": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Wasserlöslich wie PVA, schneller löslich und etwas weniger feuchtigkeitsempfindlich."},
  "Support PLA/PETG": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Mechanisch entfernbares Stützmaterial für PLA/PETG."},
  "Support PLA": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Mechanisch entfernbares Stützmaterial für PLA."},
  "Support ABS": {klasse:"B", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Stützmaterial für ABS/ASA, ähnliche Druckbedingungen wie ABS."},
  "Support PA/PET": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Stützmaterial für technische Filamente wie PA/PET."},
  "HIPS": {klasse:"B", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Löslich in Limonen, häufig als Stützmaterial für ABS."},

  "ESD": {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Elektrostatisch ableitfähig, Basispolymer je nach Produkt unterschiedlich – Datenblatt prüfen."},
  "FR / Flammhemmend": {klasse:"D", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"nur nach Prüfung", trocknung:true, hinweise:"Flammhemmende Additive, für sicherheitsrelevante Bauteile – Zertifizierung/Datenblatt prüfen."},
  "Conductive": {klasse:"D", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"Ja", trocknung:true, hinweise:"Elektrisch leitfähig, Basispolymer je nach Produkt unterschiedlich."},
  "Antibacterial": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Meist PLA-basiert mit antibakteriellem Additiv – Basispolymer laut Datenblatt prüfen."},
  "Recycled": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:true, hinweise:"Eigenschaften je nach Ausgangsmaterial/Hersteller unterschiedlich – Datenblatt prüfen."},
  "Bio-based": {klasse:"A", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"Ja", p1sGeeignet:"Ja", trocknung:false, hinweise:"Meist PLA-nahes Basispolymer aus nachwachsenden Rohstoffen."}
};
const FILAMENTKATALOG_FALLBACK = {klasse:"C", abrasiv:false, gehaerteteDuese:false, amsGeeignet:"eingeschränkt", p1sGeeignet:"nur nach Prüfung", trocknung:false, hinweise:""};

function familieOf(material){
  const fam = MATERIAL_FAMILIES.find(f=>f.items.includes(material));
  return fam ? fam.label : '';
}
function klasseOf(material){
  const entry = filamentkatalog[material];
  if(entry && entry.klasse) return entry.klasse;
  const def = FILAMENTKATALOG_DEFAULTS[material];
  return (def && def.klasse) || FILAMENTKATALOG_FALLBACK.klasse;
}
function wartungsSatzFuer(material){
  const klasse = klasseOf(material);
  return verschleissklassen[klasse] ?? VERSCHLEISS_KLASSEN_DEFAULTS[klasse] ?? 0;
}

let filamente = [];              // [{id, material, farbe, preis, farbHex}]
let firma = { anzeigename:'', name:'', ansprechpartner:'', adresse:'', telefon:'', email:'', website:'', steuernummer:'', ustId:'', iban:'', bic:'', logoDataUrl:'', logoW:0, logoH:0, standardEinleitung:'', standardSchluss:'' };
let allgemein = { strompreis:0.32, leistung:150, arbeit:20, amsRuestMin:10, ausschussPct:5, rundung:0.10, kleinunternehmer:true, mwst:19, expressPct:25, stdProTag:16, pufferTage:2, standardVersandartId:'', infillEstimatePct:20, volumenrateMm3S:15 };
let mengenrabatt = [];           // [{id, abStueck, rabatt}]
let verschleissklassen = {};     // {"A": 1.00, "B": 1.05, ...} – vollständiger Wartungssatz €/h je Verschleißklasse
let filamentkatalog = {};        // {"PLA Standard": {klasse, abrasiv, gehaerteteDuese, amsGeeignet, p1sGeeignet, trocknung, hinweise}, ...}
let zubehoer = [];               // [{id, name, preis}] – Zubehör/Hardware, Preis pro Stück
let drucker = [];                // [{id, name, leistung, amsFaehig}]
let versandarten = [];            // [{id, name, preis}] – Versandarten/Paketgrößen, Vorlage: DHL-Paketklassen
let kunden = [];                 // [{id, nummer, name, firma, adresse, email, telefon, ustId, gruppe, rabattPct, zahlungsbedingungen, lieferbedingungen, notizen}]
let kundenCounter = 0;
let vorlagen = [];                // [{id, name, druckzeit, arbeitszeit, slots, zubehoerItems, druckerId}]
let positionen = [];             // [{id, name, stueckzahl, einheit, druckzeit, arbeitszeit, druckerId, zubehoerItems, slots:[{filamentId,gramm}x4]}]
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
    const vk = await storage.get('verschleissklassen', false);
    verschleissklassen = vk ? JSON.parse(vk.value) : {};
  }catch(e){ verschleissklassen = {}; }
  // Fehlende Klassen (erster Start oder neue Version) mit den Standardsätzen auffüllen
  VERSCHLEISS_KLASSEN.forEach(k=>{ if(verschleissklassen[k] === undefined) verschleissklassen[k] = VERSCHLEISS_KLASSEN_DEFAULTS[k]; });
  try{
    const fk = await storage.get('filamentkatalog', false);
    filamentkatalog = fk ? JSON.parse(fk.value) : {};
  }catch(e){ filamentkatalog = {}; }
  // Für jedes bekannte Material einen Katalogeintrag sicherstellen (auch nach künftigen Updates
  // mit neuen Materialien) – bereits vom Nutzer geänderte Einträge bleiben unangetastet.
  MATERIALS.forEach(m=>{
    if(!filamentkatalog[m]) filamentkatalog[m] = Object.assign({}, FILAMENTKATALOG_DEFAULTS[m] || FILAMENTKATALOG_FALLBACK);
  });
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
    const va = await storage.get('versandarten', false);
    versandarten = va ? JSON.parse(va.value) : [];
  }catch(e){ versandarten = []; }
  if(!versandarten.length){
    // Erstbefüllung: DHL-Paketklassen als Vorlage, Preise/Bezeichnungen sind danach frei anpassbar
    versandarten = [
      {id: uid('vs'), name:'DHL Päckchen (bis 2 kg)', preis:4.29},
      {id: uid('vs'), name:'DHL Paket S (bis 2 kg)', preis:5.49},
      {id: uid('vs'), name:'DHL Paket M (bis 5 kg)', preis:7.49},
      {id: uid('vs'), name:'DHL Paket L (bis 10 kg)', preis:10.49},
      {id: uid('vs'), name:'DHL Paket XL (bis 31,5 kg)', preis:17.99}
    ];
    saveVersandarten();
  }
  try{
    const k = await storage.get('kunden', false);
    kunden = k ? JSON.parse(k.value) : [];
  }catch(e){ kunden = []; }
  try{
    const kc = await storage.get('kundenCounter', false);
    kundenCounter = kc ? parseInt(kc.value)||0 : 0;
  }catch(e){ kundenCounter = 0; }
  // Migration: Kunden aus älteren Versionen ohne Kundennummer nachträglich durchnummerieren
  let kundenNummerMigriert = false;
  kunden.forEach(k=>{ if(!k.nummer){ k.nummer = nextKundenNummer(); kundenNummerMigriert = true; } });
  if(kundenNummerMigriert){ saveKunden(); saveKundenCounter(); }
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
  $('#einleitungstext').value = firma.standardEinleitung||'';
  $('#schlusstext').value = firma.standardSchluss||'';

  renderFirmaInputs();
  renderFilamentList();
  renderDruckerList();
  renderZubehoerList();
  renderVersandartenList();
  renderVersandartSelects();
  $('#versandart').value = allgemein.standardVersandartId || '';
  toggleVersandManuell();
  renderKundenVerwaltung();
  renderKundenDatalist();
  renderVorlagenList();
  renderVorlageSelect();
  renderGeneralInputs();
  renderTierList();
  renderVerschleissklassen();
  renderFilamentkatalog();
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
async function saveVerschleissklassen(){
  try{ await storage.set('verschleissklassen', JSON.stringify(verschleissklassen), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveFilamentkatalog(){
  try{ await storage.set('filamentkatalog', JSON.stringify(filamentkatalog), false); }
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
async function saveVersandarten(){
  try{ await storage.set('versandarten', JSON.stringify(versandarten), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveKunden(){
  try{ await storage.set('kunden', JSON.stringify(kunden), false); }
  catch(e){ console.error('Speichern fehlgeschlagen', e); }
}
async function saveKundenCounter(){
  try{ await storage.set('kundenCounter', String(kundenCounter), false); }
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
// Kurze, tab-unabhängige Bestätigung (z. B. "Angebot geladen") – sichtbar egal welcher Tab gerade aktiv ist.
function showToast(message){
  let el = document.getElementById('appToast');
  if(!el){
    el = document.createElement('div');
    el.id = 'appToast';
    el.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--panel-2,#25272e);color:var(--text,#e9e8e4);border:1px solid var(--accent,#f2542d);border-radius:8px;padding:10px 18px;font-size:13px;z-index:99998;box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .2s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>{ el.style.opacity = '0'; }, 2200);
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
  $('#firmaAnzeigename').value = firma.anzeigename||'';
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
  $('#firmaStandardEinleitung').value = firma.standardEinleitung||'';
  $('#firmaStandardSchluss').value = firma.standardSchluss||'';
  if(firma.logoDataUrl){
    $('#firmaLogoPreview').src = firma.logoDataUrl;
    $('#firmaLogoPreviewWrap').style.display = 'block';
  } else {
    $('#firmaLogoPreviewWrap').style.display = 'none';
  }
}
['firmaAnzeigename','firmaName','firmaAnsprechpartner','firmaTelefon','firmaEmail','firmaWebsite','firmaAdresse','firmaUstId','firmaSteuernummer','firmaIban','firmaBic','firmaStandardEinleitung','firmaStandardSchluss'].forEach(id=>{
  $('#'+id).addEventListener('change', ()=>{
    firma.anzeigename = $('#firmaAnzeigename').value.trim();
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
    firma.standardEinleitung = $('#firmaStandardEinleitung').value;
    firma.standardSchluss = $('#firmaStandardSchluss').value;
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
    const klasse = klasseOf(f.material);
    const rate = wartungsSatzFuer(f.material);
    row.innerHTML = `
      <span class="swatch" style="background:${f.farbHex||guessHex(f.farbe)}"></span>
      <div class="field">
        <label>Material</label>
        <select data-id="${f.id}" data-field="material">
          ${MATERIAL_FAMILIES.map(fam=>`<optgroup label="${fam.label}">${fam.items.map(m=>`<option value="${m}" ${m===f.material?'selected':''}>${m}</option>`).join('')}</optgroup>`).join('')}
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
        <label title="Klasse wird im Filamentkatalog festgelegt, der €/h-Satz je Klasse unter „Verschleißklassen“">Wartung/Std.</label>
        <span class="tier-tag" title="Verschleißklasse ${klasse}, bearbeitbar im Filamentkatalog bzw. unter „Verschleißklassen“">Klasse ${klasse} · €${fmt(rate)}</span>
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
    });
    // Die Liste (Swatch-Farbe, Wartungs-Badge je Materialgruppe) erst beim Verlassen des
    // Feldes neu aufbauen, sonst würde jedes Zeichen den Fokus aus dem Eingabefeld werfen.
    el.addEventListener('change', e=>{
      const field = e.target.dataset.field;
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
      renderPositionen();
      refreshLivePreview();
    });
    // Das Abschreibung-€/Std.-Badge erst beim Verlassen des Feldes neu aufbauen, sonst würde
    // jede eingegebene Ziffer den Fokus aus dem Eingabefeld werfen.
    el.addEventListener('change', e=>{
      const field = e.target.dataset.field;
      if(field==='anschaffungspreis' || field==='lebensdauerStd') renderDruckerList();
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

// ---------- Filamentkatalog (eigener Tab): technische Eigenschaften je Material ----------
let filamentkatalogOpen = new Set(); // aufgeklappte Materialien (nur zur Laufzeit)
const AMS_OPTIONEN = ["Ja","eingeschränkt","Nein"];

function renderFilamentkatalog(){
  const box = $('#katalogList');
  box.innerHTML = '';

  MATERIAL_FAMILIES.forEach(fam=>{
    const section = document.createElement('div');
    section.className = 'slot-title';
    section.style.marginTop = '18px';
    section.textContent = fam.label.toUpperCase();
    box.appendChild(section);

    fam.items.forEach(m=>{
      const entry = filamentkatalog[m] || Object.assign({}, FILAMENTKATALOG_DEFAULTS[m] || FILAMENTKATALOG_FALLBACK);
      const rate = wartungsSatzFuer(m);
      const row = document.createElement('div');
      row.className = 'kv-row' + (filamentkatalogOpen.has(m) ? ' open' : '');
      row.innerHTML = `
        <div class="kv-head" data-kattoggle="${m}">
          <div><span class="kv-name">${m}</span></div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="tier-tag">Klasse ${entry.klasse} · €${fmt(rate)}/Std.</span>
            <span class="kv-chevron">▶</span>
          </div>
        </div>
        <div class="kv-body">
          <div class="row g3">
            <div class="field">
              <label>Verschleißklasse</label>
              <select data-kat="${m}" data-katfield="klasse">
                ${VERSCHLEISS_KLASSEN.map(k=>`<option value="${k}" ${k===entry.klasse?'selected':''}>Klasse ${k} (€${fmt(verschleissklassen[k] ?? VERSCHLEISS_KLASSEN_DEFAULTS[k] ?? 0)}/Std.)</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>AMS geeignet</label>
              <select data-kat="${m}" data-katfield="amsGeeignet">
                ${AMS_OPTIONEN.map(v=>`<option value="${v}" ${v===entry.amsGeeignet?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>P1S geeignet</label>
              <input data-kat="${m}" data-katfield="p1sGeeignet" value="${(entry.p1sGeeignet||'').replace(/"/g,'&quot;')}" placeholder="z. B. Ja / Nein / nur nach Prüfung">
            </div>
          </div>
          <div class="row g3" style="margin-top:4px;">
            <label class="chk-field">
              <input type="checkbox" data-kat="${m}" data-katfield="abrasiv" ${entry.abrasiv?'checked':''}>
              Abrasiv
            </label>
            <label class="chk-field">
              <input type="checkbox" data-kat="${m}" data-katfield="gehaerteteDuese" ${entry.gehaerteteDuese?'checked':''}>
              Gehärtete Düse erforderlich
            </label>
            <label class="chk-field">
              <input type="checkbox" data-kat="${m}" data-katfield="trocknung" ${entry.trocknung?'checked':''}>
              Trocknung erforderlich
            </label>
          </div>
          <div class="field" style="margin-top:12px;">
            <label>Besondere Hinweise</label>
            <textarea data-kat="${m}" data-katfield="hinweise" rows="2">${entry.hinweise||''}</textarea>
          </div>
        </div>
      `;
      box.appendChild(row);
    });
  });

  box.querySelectorAll('[data-kattoggle]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const m = el.dataset.kattoggle;
      if(filamentkatalogOpen.has(m)) filamentkatalogOpen.delete(m); else filamentkatalogOpen.add(m);
      renderFilamentkatalog();
    });
  });

  function commit(el){
    const m = el.dataset.kat;
    const field = el.dataset.katfield;
    if(!filamentkatalog[m]) filamentkatalog[m] = Object.assign({}, FILAMENTKATALOG_DEFAULTS[m] || FILAMENTKATALOG_FALLBACK);
    filamentkatalog[m][field] = (field==='abrasiv' || field==='gehaerteteDuese' || field==='trocknung') ? el.checked : el.value;
    saveFilamentkatalog();
  }
  box.querySelectorAll('[data-katfield]').forEach(el=>{
    el.addEventListener('click', e=> e.stopPropagation());
    if(el.tagName==='SELECT' || el.type==='checkbox'){
      // Auswahlfelder/Checkboxen: sofort neu rendern, damit Badge/Klassenliste aktuell bleiben
      // (kein Fokusverlust möglich, da kein Freitext-Tippen betroffen ist)
      el.addEventListener('change', e=>{ commit(e.target); renderFilamentkatalog(); if(e.target.dataset.katfield==='klasse') renderFilamentList(); });
    } else {
      // Freitextfelder: nur speichern, nicht neu rendern – sonst würde jedes Zeichen den Fokus rauswerfen
      el.addEventListener('input', e=> commit(e.target));
    }
  });
}

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

// ---------- Stammdaten: Versandarten (Paketgrößen, Vorlage: DHL) ----------
function renderVersandartenList(){
  const box = $('#versandartenList');
  box.innerHTML = '';
  $('#versandartenEmpty').style.display = versandarten.length ? 'none' : 'block';

  versandarten.forEach(v=>{
    const row = document.createElement('div');
    row.className = 'disc-row';
    row.innerHTML = `
      <div class="field">
        <label>Bezeichnung</label>
        <input data-id="${v.id}" data-field="name" value="${v.name||''}" placeholder="z. B. DHL Paket M (bis 5 kg)">
      </div>
      <div class="field">
        <label>Preis (€)</label>
        <input data-id="${v.id}" data-field="preis" type="number" min="0" step="0.01" value="${v.preis||0}">
      </div>
      <button class="icon-btn" data-del="${v.id}" title="Versandart löschen">✕</button>
    `;
    box.appendChild(row);
  });

  box.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('input', e=>{
      const v = versandarten.find(x=>x.id===e.target.dataset.id);
      const field = e.target.dataset.field;
      v[field] = field==='preis' ? (parseFloat(e.target.value)||0) : e.target.value;
      saveVersandarten();
    });
    // Namen/Preise erst beim Verlassen des Feldes in den Dropdowns aktualisieren, sonst
    // würde jedes eingegebene Zeichen den Fokus aus dem Eingabefeld werfen.
    el.addEventListener('change', ()=> renderVersandartSelects());
  });
  box.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      versandarten = versandarten.filter(x=>x.id!==btn.dataset.del);
      if(allgemein.standardVersandartId === btn.dataset.del){ allgemein.standardVersandartId = ''; saveAllgemein(); }
      saveVersandarten();
      renderVersandartenList();
      renderVersandartSelects();
    });
  });
}

$('#addVersandartBtn').addEventListener('click', ()=>{
  versandarten.push({id:uid('vs'), name:'', preis:0});
  saveVersandarten();
  renderVersandartenList();
  renderVersandartSelects();
});

// Befüllt sowohl das Versand-Dropdown im Auftrag als auch die Standard-Versandart in den Stammdaten
function renderVersandartSelects(){
  const options = ['<option value="">— Kein Versand / Abholung —</option>']
    .concat(versandarten.map(v=>`<option value="${v.id}">${(v.name||'Unbenannt')} – ${fmt(v.preis||0)} €</option>`))
    .concat(['<option value="custom">Sonstiger Betrag (manuell)</option>']);
  const auftragSel = $('#versandart');
  const auftragPrev = auftragSel.value;
  auftragSel.innerHTML = options.join('');
  if([...auftragSel.options].some(o=>o.value===auftragPrev)) auftragSel.value = auftragPrev;

  const stdOptions = ['<option value="">— Kein Versand / Abholung —</option>']
    .concat(versandarten.map(v=>`<option value="${v.id}">${(v.name||'Unbenannt')} – ${fmt(v.preis||0)} €</option>`));
  const stdSel = $('#genVersandart');
  stdSel.innerHTML = stdOptions.join('');
  stdSel.value = versandarten.some(v=>v.id===allgemein.standardVersandartId) ? allgemein.standardVersandartId : '';
}

function toggleVersandManuell(){
  $('#versandManuellWrap').style.display = $('#versandart').value === 'custom' ? 'block' : 'none';
}
$('#versandart').addEventListener('change', ()=>{
  toggleVersandManuell();
  refreshLivePreview();
});
$('#versandManuell').addEventListener('input', refreshLivePreview);

$('#genVersandart').addEventListener('change', ()=>{
  allgemein.standardVersandartId = $('#genVersandart').value;
  saveAllgemein();
});

// ---------- Kundenverwaltung (eigener Tab) ----------
let kundenVerwaltungOpen = new Set(); // IDs der aufgeklappten Kunden (nur zur Laufzeit)
let kundenSucheText = '';

// Kundennummer wird automatisch vergeben (wie die Angebotsnummer) – nie manuell eingetragen
function nextKundenNummer(){
  kundenCounter++;
  return `K-${String(kundenCounter).padStart(4,'0')}`;
}

function findKundeByName(name){
  name = (name||'').trim().toLowerCase();
  return name ? kunden.find(x=> (x.name||'').trim().toLowerCase() === name) : null;
}

function renderKundenDatalist(){
  $('#kundenDatalist').innerHTML = kunden.map(k=>`<option value="${(k.name||'').replace(/"/g,'&quot;')}">`).join('');
}

// Kurzinfo (Kundennummer, Gruppe, Rabatt, Zahlungs-/Lieferbedingungen) unter dem Namensfeld aktuell halten
function refreshKundeInfoHint(){
  const el = $('#kundeInfoHint');
  if(!el) return;
  const k = findKundeByName($('#kundeName').value);
  if(!k){ el.textContent = ''; return; }
  const parts = [`Kundennummer: ${k.nummer||'–'}`];
  if(k.gruppe) parts.push(`Gruppe: ${k.gruppe}`);
  if(k.rabattPct) parts.push(`Standard-Rabatt: ${k.rabattPct}%`);
  if(k.zahlungsbedingungen) parts.push(`Zahlung: ${k.zahlungsbedingungen}`);
  if(k.lieferbedingungen) parts.push(`Lieferung: ${k.lieferbedingungen}`);
  el.textContent = parts.join(' · ');
}

// Übernimmt Kontaktdaten + Standard-Rabatt eines bekannten Kunden ins Auftragsformular (Name wird separat gesetzt)
function applyKundeAutofill(k){
  $('#kundeFirma').value = k.firma||'';
  $('#kundeEmail').value = k.email||'';
  $('#kundeTelefon').value = k.telefon||'';
  $('#kundeAdresse').value = k.adresse||'';
  if(k.rabattPct && !(parseFloat($('#extraDiscount').value)>0)) $('#extraDiscount').value = k.rabattPct;
  refreshKundeInfoHint();
}

$('#kundeName').addEventListener('input', ()=>{
  const k = findKundeByName($('#kundeName').value);
  if(k) applyKundeAutofill(k); else refreshKundeInfoHint();
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
  let k = findKundeByName(name);
  if(k){ Object.assign(k, data); }
  else {
    k = Object.assign({id:uid('k'), nummer: nextKundenNummer(), ustId:'', gruppe:'', rabattPct:0, zahlungsbedingungen:'', lieferbedingungen:'', notizen:''}, data);
    kunden.push(k);
    saveKundenCounter();
  }
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
        <div><span class="kv-name">${k.name || 'Ohne Namen'}</span><span class="kv-meta"> · ${k.nummer||'–'}</span>${k.firma?`<span class="kv-meta"> · ${k.firma}</span>`:''}</div>
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
        <div class="row g3" style="margin-top:12px;">
          <div class="field">
            <label>USt-ID (optional)</label>
            <input data-kv="${k.id}" data-field="ustId" value="${k.ustId||''}">
          </div>
          <div class="field">
            <label>Kundengruppe</label>
            <input data-kv="${k.id}" data-field="gruppe" value="${k.gruppe||''}" placeholder="z. B. Stammkunde, Gewerbe">
          </div>
          <div class="field">
            <label>Standard-Rabatt (%)</label>
            <input data-kv="${k.id}" data-field="rabattPct" type="number" min="0" max="100" step="1" value="${k.rabattPct||0}">
          </div>
        </div>
        <div class="row g2" style="margin-top:12px;">
          <div class="field">
            <label>Zahlungsbedingungen</label>
            <input data-kv="${k.id}" data-field="zahlungsbedingungen" value="${k.zahlungsbedingungen||''}" placeholder="z. B. 14 Tage netto">
          </div>
          <div class="field">
            <label>Lieferbedingungen</label>
            <input data-kv="${k.id}" data-field="lieferbedingungen" value="${k.lieferbedingungen||''}" placeholder="z. B. Abholung, versicherter Versand">
          </div>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Interne Notizen</label>
          <textarea data-kv="${k.id}" data-field="notizen" rows="2">${k.notizen||''}</textarea>
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
            <span>${a.nummer} · ${a.datum} · ${a.ergebnis.sumStueckzahl} ${a.ergebnis.einheitGesamt||'Stk.'} · <span class="status-tag ${info.cls}">${info.label}</span></span>
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
      const field = e.target.dataset.field;
      k[field] = field==='rabattPct' ? (parseFloat(e.target.value)||0) : e.target.value;
      saveKunden();
      renderKundenDatalist();
    });
  });
  box.querySelectorAll('[data-delkv]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      if(!(await showConfirm('Kunde wirklich löschen? Bereits gespeicherte Angebote bleiben im Archiv erhalten.'))) return;
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
      applyKundeAutofill(k);
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
  const neu = {id:uid('k'), nummer: nextKundenNummer(), name:'Neuer Kunde', firma:'', email:'', telefon:'', adresse:'', ustId:'', gruppe:'', rabattPct:0, zahlungsbedingungen:'', lieferbedingungen:'', notizen:''};
  kunden.push(neu);
  kundenVerwaltungOpen.add(neu.id);
  saveKunden();
  saveKundenCounter();
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
  $('#genInfillEstimate').value = allgemein.infillEstimatePct;
  $('#genVolumenrate').value = allgemein.volumenrateMm3S;
  $('#genKleinunternehmer').checked = !!allgemein.kleinunternehmer;
  $('#genMwst').value = allgemein.mwst;
  $('#mwstFieldWrap').style.display = allgemein.kleinunternehmer ? 'none' : 'block';
}
['genStrompreis','genArbeit','genAmsRuest','genAusschuss','genMwst','genExpressPct','genStdProTag','genPufferTage','genInfillEstimate','genVolumenrate'].forEach(id=>{
  $('#'+id).addEventListener('change', ()=>{
    allgemein.strompreis  = parseFloat($('#genStrompreis').value)||0;
    allgemein.arbeit      = parseFloat($('#genArbeit').value)||0;
    allgemein.amsRuestMin = parseFloat($('#genAmsRuest').value)||0;
    allgemein.ausschussPct= parseFloat($('#genAusschuss').value)||0;
    allgemein.mwst         = parseFloat($('#genMwst').value)||0;
    allgemein.expressPct   = parseFloat($('#genExpressPct').value)||0;
    allgemein.stdProTag    = parseFloat($('#genStdProTag').value)||16;
    allgemein.pufferTage   = parseFloat($('#genPufferTage').value)||0;
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
function renderVerschleissklassen(){
  const box = $('#klassenList');
  box.innerHTML = VERSCHLEISS_KLASSEN.map(k => `
    <div class="disc-row">
      <div class="field">
        <label>Verschleißklasse</label>
        <input value="Klasse ${k}" disabled style="opacity:0.7;">
      </div>
      <div class="field">
        <label>Wartung €/Std.</label>
        <input data-klasse="${k}" type="number" min="0" step="0.05" value="${verschleissklassen[k] ?? VERSCHLEISS_KLASSEN_DEFAULTS[k] ?? 0}">
      </div>
      <span></span>
    </div>
  `).join('');

  box.querySelectorAll('[data-klasse]').forEach(el=>{
    el.addEventListener('input', e=>{
      verschleissklassen[e.target.dataset.klasse] = parseFloat(e.target.value)||0;
      saveVerschleissklassen();
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
    einheit: v.einheit || 'Stk.',
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
    einheit: 'Stk.',
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
      <div class="row g4" style="margin-bottom:12px;">
        <div class="field">
          <label>Produktname</label>
          <input data-pos="${pos.id}" data-pfield="name" value="${pos.name||''}" placeholder="z. B. Halterung V2">
        </div>
        <div class="field">
          <label title="${pos._importBasis ? 'Aus Slice importiert: Druckzeit und Filamentmenge werden bei Änderung automatisch mitskaliert (bis Druckzeit/Gramm manuell angepasst werden)' : ''}">Menge${pos._importBasis ? ' 🔁' : ''}</label>
          <input data-pos="${pos.id}" data-pfield="stueckzahl" type="number" min="1" step="1" value="${pos.stueckzahl}" title="${pos._importBasis ? 'Druckzeit/Filamentmenge werden beim Ändern automatisch mitskaliert' : ''}">
        </div>
        <div class="field">
          <label>Einheit</label>
          <input data-pos="${pos.id}" data-pfield="einheit" list="einheitOptions" value="${pos.einheit||'Stk.'}" placeholder="Stk.">
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
      // Druckzeit manuell angepasst -> automatische Mitskalierung bei Mengenänderung beenden,
      // der Nutzer hat hier bewusst einen eigenen Wert eingetragen.
      if(field==='druckzeit' && pos._importBasis) delete pos._importBasis;
      refreshLivePreview();
    });
  });
  // Menge geändert (z. B. eine aus dem 3MF/G-Code importierte Platte soll mehrfach gedruckt werden):
  // Druckzeit + Filamentmenge proportional mitskalieren, solange der Nutzer sie nicht selbst überschrieben hat.
  box.querySelectorAll('[data-pfield="stueckzahl"]').forEach(el=>{
    el.addEventListener('change', e=>{
      const pos = positionen.find(p=>p.id===e.target.dataset.pos);
      const basis = pos && pos._importBasis;
      if(!basis || !basis.stueckzahl) return;
      const neu = parseInt(e.target.value)||1;
      // Immer neu aus der unveränderten Basis berechnen (nicht überspringen, wenn "neu" zufällig
      // der Basis-Stückzahl entspricht – sonst würde z. B. das Zurückstellen von 2 auf die
      // ursprüngliche Basis 1 fälschlich gar nichts mehr skalieren).
      const faktor = neu / basis.stueckzahl;
      pos.druckzeit = Math.round(basis.druckzeit * faktor * 100) / 100;
      pos.slots.forEach((s,i)=>{
        if(!s || !(basis.gramm[i] > 0)) return;
        s.gramm = String(Math.round(basis.gramm[i] * faktor * 10) / 10);
      });
      renderPositionen();
      updateTierHint();
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
        einheit: pos.einheit || 'Stk.',
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
      // Gramm manuell angepasst -> automatische Mitskalierung bei Mengenänderung beenden,
      // der Nutzer hat hier bewusst einen eigenen Wert eingetragen.
      if(field==='gramm' && pos._importBasis) delete pos._importBasis;
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

// Bambu Studio/OrcaSlicer schreiben im Sliced-File nur den kurzen Basistyp (z. B. "PLA", "PETG",
// "ABS-CF") – unabhängig vom Filament-Hersteller. Unsere Materialnamen sind dagegen oft länger
// ("PLA Standard", "PLA Silk", …). Erstes Wort vor Leerzeichen/Slash liefert i. d. R. genau diesen
// Basistyp zurück ("PLA Standard"→"PLA", "PA / Nylon"→"PA", "PLA-CF" bleibt unverändert).
function materialBaseToken(material){
  return (material||'').split(/[\s/]+/)[0].toUpperCase();
}
function findFilamentByTypeColor(type, colorHex){
  const typeNorm = (type||'').toUpperCase();
  let sameType = filamente.filter(f => (f.material||'').toUpperCase() === typeNorm);
  if(!sameType.length){
    sameType = filamente.filter(f => materialBaseToken(f.material) === typeNorm);
  }
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
        // Gramm-Menge auch ohne eindeutige Zuordnung übernehmen (Slicer kennt sie ja) – nur das
        // Filament selbst muss der Nutzer dann manuell aus der Stammdaten-Liste auswählen.
        slots[slotIdx] = {filamentId: match ? match.id : '', gramm: String(Math.round(usedG*10)/10)};
        if(!match) unmatched.add(`${type} ${color}`);
        slotIdx++;
      }

      plateCount++;
      const plateLabel = plateCount > 1 ? `${baseName} – Platte ${idxMatch ? idxMatch[1] : plateCount}` : baseName;
      addPosition({
        name: plateLabel,
        stueckzahl: 1,
        druckzeit: druckzeitH,
        arbeitszeit: 0,
        slots,
        // Merkt sich die aus dem Slice übernommenen Werte für 1 Druckvorgang dieser Platte. Ändert
        // der Nutzer danach die Menge (z. B. weil er die Platte mehrfach drucken will), werden
        // Druckzeit und Filamentmenge automatisch proportional mitskaliert (siehe stueckzahl-Change-Handler).
        _importBasis: {stueckzahl: 1, druckzeit: druckzeitH, gramm: slots.map(s=> s ? (parseFloat(s.gramm)||0) : 0)}
      });
    }

    renderPositionen();
    updateTierHint();
    refreshLivePreview();

    let html = `<div class="import-msg ${unmatched.size?'warn':'ok'}">${plateCount} Position(en) aus „${file.name}“ importiert (Druckzeit + Filamentverbrauch automatisch übernommen). Stückzahl und Arbeitszeit bitte noch prüfen/eintragen.`;
    if(unmatched.size){
      html += `\nGrammzahl wurde übernommen, aber folgende Filamente konnten keinem Eintrag in den Stammdaten zugeordnet werden – bitte in der Position manuell auswählen (ggf. erst in Stammdaten anlegen):\n– ${[...unmatched].join('\n– ')}`;
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
        const typeNorm = type.toUpperCase();
        match = filamente.find(f => (f.material||'').toUpperCase() === typeNorm) || filamente.find(f => materialBaseToken(f.material) === typeNorm);
        if(match) unverified.add(`${type} (Farbe nicht in Datei, bitte prüfen)`);
      }
      // Gramm-Menge auch ohne eindeutige Zuordnung übernehmen – nur das Filament selbst muss
      // der Nutzer dann manuell aus der Stammdaten-Liste auswählen.
      slots[i] = {filamentId: match ? match.id : '', gramm: String(Math.round(g*10)/10)};
      if(!match) unmatched.add(type ? `${type}${colour?' '+colour:''}` : `Filament ${i+1} (${g} g)`);
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
      slots,
      // Siehe 3MF-Import: erlaubt automatisches Mitskalieren von Druckzeit/Filamentmenge, wenn die
      // Menge danach geändert wird (z. B. weil diese Platte mehrfach gedruckt werden soll).
      _importBasis: {stueckzahl: 1, druckzeit: druckzeitH, gramm: slots.map(s=> s ? (parseFloat(s.gramm)||0) : 0)}
    });
    renderPositionen();
    updateTierHint();
    refreshLivePreview();

    let html = `<div class="import-msg ${(unmatched.size||unverified.size)?'warn':'ok'}">Position aus „${file.name}“ importiert (Druckzeit: ${druckzeitH} Std.). Stückzahl und Arbeitszeit bitte noch prüfen/eintragen.`;
    if(unverified.size) html += `\nFarbe nicht in Datei angegeben, bitte in der Position prüfen:\n– ${[...unverified].join('\n– ')}`;
    if(unmatched.size) html += `\nGrammzahl wurde übernommen, aber folgende Filamente konnten keinem Eintrag in den Stammdaten zugeordnet werden – bitte in der Position manuell auswählen (ggf. erst in Stammdaten anlegen):\n– ${[...unmatched].join('\n– ')}`;
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
  const versandartId = $('#versandart').value;
  let versandBetrag = 0, versandartName = '';
  if(versandartId === 'custom'){
    versandBetrag = parseFloat($('#versandManuell').value)||0;
    versandartName = 'Sonstiger Betrag';
  } else if(versandartId){
    const v = versandarten.find(x=>x.id===versandartId);
    if(v){ versandBetrag = v.preis||0; versandartName = v.name||''; }
  }
  const einleitungstext = $('#einleitungstext').value.trim();
  const schlusstext = $('#schlusstext').value.trim();

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
    // Wartungssatz je Druckstunde: höchster Klassenpreis der in dieser Position verwendeten Filamente
    const wartungssatz = usedSlots.reduce((max,s)=>{
      const f = filamente.find(x=>x.id===s.filamentId);
      const z = f ? wartungsSatzFuer(f.material) : 0;
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
      einheit: pos.einheit || 'Stk.',
      subtotal,
      proStueck: subtotal/stueckzahl,
      amsZuschlag: amsZuschlagH > 0,
      amsWarn,
      druckerName: posDrucker ? posDrucker.name : '–'
    });
  });

  // Einheitliche Mengeneinheit über alle Positionen (für Gesamt-/Durchschnittsanzeige) – null, wenn gemischt
  const einheitGesamt = posLines.length && posLines.every(l=>l.einheit===posLines[0].einheit) ? posLines[0].einheit : null;
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

  return {jobName, kunde, liefertermin, posLines, materialTotal, stromTotal, wartungTotal, arbeitTotal, zubehoerTotal, abschreibungTotal, versandBetrag, versandartId, versandartName,
    amsRuestStunden, amsPositionen, kostenSumme, ausschussPct: allgemein.ausschussPct||0, ausschussBetrag,
    zwischensumme, expressOn, expressPct, expressBetrag, marginPct, gewinn, tierPct, extraDiscountPct, totalDiscountPct,
    rabattBetrag, nettoGesamt, kleinunternehmer, mwstSatz, mwstBetrag, bruttoGesamt,
    rundungsDiff, gesamt, sumStueckzahl, einheitGesamt, einleitungstext, schlusstext};
}

function buildResultHtml(q){
  let html = '';
  if(q.jobName) html += `<h2 style="margin-bottom:2px;">${q.jobName}</h2>`;
  if(q.kunde && q.kunde.name) html += `<div style="color:var(--muted); font-size:12.5px; margin-bottom:4px;">Kunde: ${q.kunde.name}${q.kunde.firma?' · '+q.kunde.firma:''}</div>`;
  if(q.liefertermin) html += `<div style="color:var(--muted); font-size:12.5px; margin-bottom:14px;">Voraussichtlicher Liefertermin: ${new Date(q.liefertermin+'T00:00:00').toLocaleDateString('de-DE')}</div>`;

  html += `<h3>Positionen</h3>`;
  html += q.posLines.map(l=>`<div class="pos-line"><span>${l.nr}. ${l.name} (${l.stueckzahl} ${l.einheit})${l.amsZuschlag?' · AMS':''}${l.amsWarn?' · ⚠ kein AMS':''}</span><span>${fmt(l.subtotal)} € · ${fmt(l.proStueck)} €/${l.einheit}</span></div>`).join('');

  html += `<h3>Kosten gesamt</h3>`;
  html += `<div class="line"><span>Materialkosten</span><span>${fmt(q.materialTotal)} €</span></div>`;
  html += `<div class="line"><span>Stromkosten</span><span>${fmt(q.stromTotal)} €</span></div>`;
  html += `<div class="line"><span>Wartung & Verschleiß</span><span>${fmt(q.wartungTotal)} €</span></div>`;
  let arbeitLabel = 'Arbeitskosten';
  if(q.amsPositionen>0) arbeitLabel += ` (inkl. AMS-Rüstzuschlag: ${q.amsPositionen} Pos. à ${allgemein.amsRuestMin} Min.)`;
  html += `<div class="line"><span>${arbeitLabel}</span><span>${fmt(q.arbeitTotal)} €</span></div>`;
  if(q.zubehoerTotal>0) html += `<div class="line"><span>Zubehör/Hardware</span><span>${fmt(q.zubehoerTotal)} €</span></div>`;
  if(q.abschreibungTotal>0) html += `<div class="line"><span>Maschinenabschreibung</span><span>${fmt(q.abschreibungTotal)} €</span></div>`;
  if(q.versandBetrag>0) html += `<div class="line"><span>Versand & Verpackung${q.versandartName?' ('+q.versandartName+')':''}</span><span>${fmt(q.versandBetrag)} €</span></div>`;
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
  html += `<div class="total"><span>Gesamtpreis${q.einheitGesamt?` (${q.sumStueckzahl} ${q.einheitGesamt})`:''}</span><span>${fmt(q.gesamt)} €</span></div>`;
  if(q.sumStueckzahl>0 && q.einheitGesamt) html += `<div class="line"><span>Ø Preis / ${q.einheitGesamt}</span><span>${fmt(q.gesamt/q.sumStueckzahl)} €</span></div>`;
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
  if(q.einleitungstext) rows.push(['Einleitungstext', q.einleitungstext]);
  if(q.kunde && q.kunde.name){
    rows.push([]);
    rows.push(['Kunde', q.kunde.name]);
    if(q.kunde.firma) rows.push(['Firma', q.kunde.firma]);
    if(q.kunde.adresse) rows.push(['Adresse', q.kunde.adresse]);
    if(q.kunde.email) rows.push(['E-Mail', q.kunde.email]);
    if(q.kunde.telefon) rows.push(['Telefon', q.kunde.telefon]);
  }
  rows.push([]);
  rows.push(['Pos.','Produkt','Menge','Einzelpreis (€)','Gesamtpreis (€)']);
  q.posLines.forEach(l=>{
    rows.push([l.nr, l.name, `${l.stueckzahl} ${l.einheit}`, csvNum(l.proStueck), csvNum(l.subtotal)]);
  });
  rows.push([]);
  rows.push(['','','','Kostensumme', csvNum(q.kostenSumme)]);
  if(q.zubehoerTotal>0) rows.push(['','','','davon Zubehör/Hardware', csvNum(q.zubehoerTotal)]);
  if(q.abschreibungTotal>0) rows.push(['','','','davon Maschinenabschreibung', csvNum(q.abschreibungTotal)]);
  if(q.versandBetrag>0) rows.push(['','','',`davon Versand & Verpackung${q.versandartName?' ('+q.versandartName+')':''}`, csvNum(q.versandBetrag)]);
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
  if(q.sumStueckzahl>0 && q.einheitGesamt) rows.push(['','','',`Ø Preis / ${q.einheitGesamt}`, csvNum(q.gesamt/q.sumStueckzahl)]);
  if(q.schlusstext){ rows.push([]); rows.push(['Schlusstext', q.schlusstext]); }
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
  const firmaHeadline = firma.anzeigename || firma.name;
  const firmaRechtlicherZusatz = (firma.name && firma.anzeigename && firma.name !== firma.anzeigename) ? firma.name : '';
  if(firmaHeadline || firma.adresse || firma.email || firma.telefon){
    let fy = y + 4;
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    if(firmaHeadline){ doc.text(firmaHeadline, 196, fy, {align:'right'}); fy += 5; }
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    [
      firmaRechtlicherZusatz,
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

  if(q.einleitungstext){
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(0);
    const introLines = doc.splitTextToSize(q.einleitungstext, 182);
    doc.text(introLines, 14, y);
    y += introLines.length * 5 + 5;
  }

  doc.autoTable({
    startY: y,
    head: [['Pos.','Produkt','Menge','Einzelpreis (€)','Gesamtpreis (€)']],
    body: q.posLines.map(l=>[l.nr, l.name, `${l.stueckzahl} ${l.einheit}`, fmt(l.proStueck), fmt(l.subtotal)]),
    theme: 'grid',
    headStyles: {fillColor:[242,84,45]},
    styles: {fontSize:9}
  });
  y = doc.lastAutoTable.finalY + 8;

  const summaryRows = [];
  summaryRows.push(['Kostensumme', fmt(q.kostenSumme)+' €']);
  if(q.zubehoerTotal>0) summaryRows.push(['davon Zubehör/Hardware', fmt(q.zubehoerTotal)+' €']);
  if(q.abschreibungTotal>0) summaryRows.push(['davon Maschinenabschreibung', fmt(q.abschreibungTotal)+' €']);
  if(q.versandBetrag>0) summaryRows.push([`davon Versand & Verpackung${q.versandartName?' ('+q.versandartName+')':''}`, fmt(q.versandBetrag)+' €']);
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
  if(q.sumStueckzahl>0 && q.einheitGesamt) summaryRows.push([`Ø Preis / ${q.einheitGesamt}`, fmt(q.gesamt/q.sumStueckzahl)+' €']);

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

  y = doc.lastAutoTable.finalY + 8;

  if(q.schlusstext){
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(0);
    const schlussLines = doc.splitTextToSize(q.schlusstext, 182);
    doc.text(schlussLines, 14, y);
    y += schlussLines.length * 5 + 5;
  }

  const footerLines = [];
  if(firma.iban) footerLines.push(`Zahlung per Überweisung: IBAN ${firma.iban}${firma.bic ? ' · BIC '+firma.bic : ''}${firma.name ? ' · '+firma.name : ''}`);
  if(q.kleinunternehmer) footerLines.push('Gemäß §19 UStG wird keine Umsatzsteuer berechnet und ausgewiesen.');
  if(footerLines.length){
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120);
    footerLines.forEach(line=>{ doc.text(line, 14, y); y += 4; });
  }

  return doc;
}

function pdfSafeName(q, prefix){
  const safeName = (q.jobName || 'angebot').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return `preisangebot_${prefix?prefix+'_':''}${safeName || 'angebot'}.pdf`;
}

$('#exportPdfBtn').addEventListener('click', async ()=>{
  if(!window.jspdf){ await showAlert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung beim ersten Laden der Seite erforderlich).'); return; }
  const q = computeQuote();
  const doc = buildPdfDoc(q, {nummer: $('#angebotsNr').value, gueltigBis: $('#gueltigBis').value});
  doc.save(pdfSafeName(q));
});

// ---------- Angebot per E-Mail senden ----------
$('#mailAngebotBtn').addEventListener('click', async ()=>{
  if(!window.jspdf){ await showAlert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung beim ersten Laden der Seite erforderlich).'); return; }
  const q = computeQuote();
  if(!positionen.length || !q.sumStueckzahl){
    await showAlert('Bitte zuerst mindestens eine Position mit Stückzahl anlegen.');
    return;
  }
  const doc = buildPdfDoc(q, {nummer: $('#angebotsNr').value, gueltigBis: $('#gueltigBis').value});
  const filename = pdfSafeName(q);
  doc.save(filename);

  const to = q.kunde.email || '';
  const nummer = $('#angebotsNr').value;
  const subject = `Ihr Angebot${nummer && nummer!=='wird beim Speichern vergeben' ? ' '+nummer : ''}${q.jobName ? ' – '+q.jobName : ''}`;
  const anrede = q.kunde.name ? `Hallo ${q.kunde.name.split(' ')[0]},` : 'Hallo,';
  const mengeSuffix = q.einheitGesamt ? ` (${q.sumStueckzahl} ${q.einheitGesamt})` : '';
  const firmaSignatur = firma.anzeigename || firma.name;
  const body = `${anrede}\n\nanbei unser Angebot über ${fmt(q.gesamt)} €${mengeSuffix}.\n\nBitte die soeben heruntergeladene Datei „${filename}“ dieser E-Mail noch manuell anhängen – aus Sicherheitsgründen können Browser Anhänge nicht automatisch beifügen.\n\nViele Grüße${firmaSignatur ? '\n'+firmaSignatur : ''}`;
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
  if(a.versandartId && (a.versandartId==='custom' || versandarten.some(v=>v.id===a.versandartId))){
    $('#versandart').value = a.versandartId;
  } else if(a.versand>0){
    // Ältere Angebote (vor Einführung der Versandarten) oder eine inzwischen gelöschte Versandart:
    // als manuellen Betrag mit dem archivierten Wert wiederherstellen
    $('#versandart').value = 'custom';
  } else {
    $('#versandart').value = '';
  }
  toggleVersandManuell();
  $('#versandManuell').value = a.versand || 0;
  $('#einleitungstext').value = a.einleitungstext || '';
  $('#schlusstext').value = a.schlusstext || '';
  const k = a.kunde || {};
  $('#kundeName').value = k.name || '';
  $('#kundeFirma').value = k.firma || '';
  $('#kundeEmail').value = k.email || '';
  $('#kundeTelefon').value = k.telefon || '';
  $('#kundeAdresse').value = k.adresse || '';
  refreshKundeInfoHint();
  renderPositionen();
  updateTierHint();
  refreshLivePreview();
  document.querySelector('.tab[data-view="kalk"]').click();
  showToast(`Angebot ${a.nummer} geladen (${a.positionen.length} Position${a.positionen.length===1?'':'en'})`);
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
      <div class="ameta">Erstellt: ${a.datum} · Gültig bis: ${a.gueltigBis || '–'}${a.liefertermin ? ' · Liefertermin: '+new Date(a.liefertermin+'T00:00:00').toLocaleDateString('de-DE') : ''} · ${a.ergebnis.sumStueckzahl} ${a.ergebnis.einheitGesamt||'Stk.'} · ${a.positionen.length} Position(en)${a.express?' · Express':''}</div>
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
    btn.addEventListener('click', async ()=>{
      if(!window.jspdf){ await showAlert('PDF-Bibliothek konnte nicht geladen werden (Internetverbindung beim ersten Laden der Seite erforderlich).'); return; }
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

$('#saveAngebotBtn').addEventListener('click', async ()=>{
  const q = computeQuote();
  if(!positionen.length || !q.sumStueckzahl){
    await showAlert('Bitte zuerst mindestens eine Position mit Stückzahl anlegen.');
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
    versandartId: q.versandartId,
    einleitungstext: q.einleitungstext,
    schlusstext: q.schlusstext,
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
  await showAlert(`Angebot ${nummer} gespeichert (${fmt(q.gesamt)} €). Im Archiv abrufbar.`);
});

// ---------- Stammdaten-Backup ----------
$('#exportBackupBtn').addEventListener('click', ()=>{
  const backup = {
    exportiertAm: new Date().toISOString(),
    firma, filamente, allgemein, mengenrabatt, verschleissklassen, filamentkatalog, zubehoer, drucker, versandarten, kunden, kundenCounter, vorlagen
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
    if(!(await showConfirm('Backup importieren? Das überschreibt deine aktuellen Stammdaten (Firmenprofil, Filamente, Drucker, Zubehör, Versandarten, Kunden, Vorlagen, Filamentkatalog/Verschleißklassen, Mengenrabatt, allgemeine Einstellungen).'))) return;

    if(data.firma) firma = Object.assign({}, firma, data.firma);
    if(Array.isArray(data.filamente)) filamente = data.filamente;
    if(data.allgemein) allgemein = Object.assign({}, allgemein, data.allgemein);
    if(Array.isArray(data.mengenrabatt)) mengenrabatt = data.mengenrabatt;
    if(data.verschleissklassen) verschleissklassen = data.verschleissklassen;
    if(data.filamentkatalog){
      filamentkatalog = data.filamentkatalog;
      MATERIALS.forEach(m=>{ if(!filamentkatalog[m]) filamentkatalog[m] = Object.assign({}, FILAMENTKATALOG_DEFAULTS[m] || FILAMENTKATALOG_FALLBACK); });
    }
    if(Array.isArray(data.zubehoer)) zubehoer = data.zubehoer;
    if(Array.isArray(data.drucker) && data.drucker.length) drucker = data.drucker;
    if(Array.isArray(data.versandarten)) versandarten = data.versandarten;
    if(Array.isArray(data.kunden)) kunden = data.kunden;
    if(typeof data.kundenCounter === 'number') kundenCounter = data.kundenCounter;
    if(Array.isArray(data.vorlagen)) vorlagen = data.vorlagen;
    // Kunden aus älteren Backups ohne Kundennummer nachträglich durchnummerieren
    kunden.forEach(k=>{ if(!k.nummer) k.nummer = nextKundenNummer(); });

    await Promise.all([saveFirma(), saveFilamente(), saveAllgemein(), saveTiers(), saveVerschleissklassen(), saveFilamentkatalog(), saveZubehoer(), saveDrucker(), saveVersandarten(), saveKunden(), saveKundenCounter(), saveVorlagen()]);
    renderFirmaInputs(); renderFilamentList(); renderGeneralInputs(); renderTierList(); renderVerschleissklassen(); renderFilamentkatalog(); renderPositionen();
    renderDruckerList(); renderZubehoerList(); renderVersandartenList(); renderVersandartSelects(); renderKundenVerwaltung(); renderKundenDatalist(); renderVorlagenList(); renderVorlageSelect();
    msg.innerHTML = `<div class="import-msg ok">Backup vom ${new Date(data.exportiertAm||Date.now()).toLocaleString('de-DE')} erfolgreich importiert.</div>`;
  }catch(err){
    msg.innerHTML = `<div class="import-msg warn">Backup konnte nicht gelesen werden: ${err.message}</div>`;
  }
});

loadData();
