# Druckkalkulator als Desktop-App – Anleitung

Diese Anleitung baut aus den vorhandenen Web-Dateien (`index.html`, `style.css`, `script.js`) eine echte Desktop-Anwendung mit [Electron](https://www.electronjs.org/) – lauffähig unter Windows, macOS und Linux.

## Voraussetzung: Node.js installieren

Electron braucht Node.js (inkl. npm).

1. Auf **https://nodejs.org** die **LTS-Version** herunterladen und installieren (Windows/macOS: Installer ausführen und durchklicken)
2. Installation prüfen – Terminal (macOS/Linux) bzw. Eingabeaufforderung/PowerShell (Windows) öffnen und eingeben:
   ```bash
   node -v
   npm -v
   ```
   Beide Befehle sollten eine Versionsnummer anzeigen (z. B. `v20.11.0`). Falls nicht: Rechner neu starten oder Installation wiederholen.

## Schritt 1: Projektordner vorbereiten

Alle 5 Dateien aus diesem Paket müssen **im selben Ordner** liegen:

```
druckkalkulator-desktop/
├── index.html
├── style.css
├── script.js
├── main.js
└── package.json
```

Diesen Ordner z. B. auf den Desktop legen.

## Schritt 2: Abhängigkeiten installieren

Terminal/Eingabeaufforderung öffnen, in den Ordner wechseln und installieren:

```bash
cd pfad/zu/druckkalkulator-desktop
npm install
```

Das lädt Electron herunter (dauert beim ersten Mal 1–3 Minuten, es entsteht ein neuer Ordner `node_modules`).

## Schritt 3: App testen

```bash
npm start
```

Es öffnet sich ein eigenes Fenster mit dem Druckkalkulator – keine Menüleiste, kein Browser drumherum, wie eine normale Anwendung. Mit `Strg`/`Cmd` + `Q` bzw. dem Fenster-Schließen-Button wieder beenden.

## Schritt 4: Installierbare Anwendung bauen

Um eine `.exe` (Windows), `.dmg` (macOS) oder `.AppImage` (Linux) zu erzeugen:

```bash
npm run build
```

Das fertige Installationsprogramm liegt danach im neu erstellten Ordner `dist/`. Diese Datei kann verteilt und auf anderen Rechnern (gleiches Betriebssystem) installiert werden.

> **Wichtig:** Electron-Builder erzeugt standardmäßig nur Pakete für das Betriebssystem, auf dem `npm run build` ausgeführt wird. Für eine Windows-`.exe` muss der Build-Befehl also unter Windows laufen, für eine `.dmg` unter macOS usw.

## Daten & Speicherung

Die App speichert Stammdaten (Filamente, Preise, Rabattstufen) automatisch lokal im `localStorage` des eingebetteten Browserfensters – bleibt also zwischen den Starts erhalten, ganz ohne Internetverbindung oder Server.

## Eigenes Icon hinzufügen (optional)

1. Ein quadratisches Bild (mind. 512×512 px) als `icon.png` in den Ordner legen
2. In `main.js` bei `new BrowserWindow({...})` die Zeile ergänzen:
   ```javascript
   icon: path.join(__dirname, 'icon.png'),
   ```
   (und `const path = require('path');` steht bereits oben in der Datei)
3. In `package.json` unter `"build"` ergänzen:
   ```json
   "mac": { "target": "dmg", "icon": "icon.png" },
   "win": { "target": "nsis", "icon": "icon.png" },
   "linux": { "target": "AppImage", "icon": "icon.png" }
   ```

## Problembehebung

| Problem | Lösung |
|---|---|
| `npm: command not found` | Node.js ist nicht installiert oder Terminal muss neu gestartet werden |
| `npm install` hängt/schlägt fehl | Internetverbindung prüfen, ggf. `npm cache clean --force` und erneut versuchen |
| Fenster bleibt weiß | Prüfen, ob `index.html`, `style.css`, `script.js` wirklich im selben Ordner wie `main.js` liegen |
| `npm run build` schlägt fehl | Sicherstellen, dass `npm install` vorher erfolgreich durchgelaufen ist |

## Alternative: leichtgewichtiger mit Tauri

Electron-Installer sind recht groß (~80–120 MB), da eine komplette Chromium-Instanz mitgeliefert wird. Wer ein deutlich kleineres Binary (~10 MB) möchte, kann stattdessen [Tauri](https://tauri.app/) verwenden – dieselben HTML/CSS/JS-Dateien funktionieren dort ebenfalls, zusätzlich wird aber eine Rust-Installation benötigt. Bei Bedarf kann eine entsprechende Anleitung nachgereicht werden.
