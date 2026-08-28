# Installer automatisch über GitHub bauen (GitHub Actions)

Damit entfällt das lokale Node.js/`npm run build` komplett – GitHub baut die Installer für Windows, macOS **und** Linux automatisch in der Cloud, auch wenn du selbst nur einen Rechner hast.

## Einmalige Einrichtung

1. Neues Repository auf **https://github.com/new** anlegen (öffentlich oder privat, beides funktioniert)
2. Diesen kompletten Ordnerinhalt hochladen – entweder:
   - **Ohne Git-Kenntnisse:** Auf der GitHub-Repo-Seite auf „Add file → Upload files“ klicken und alle Dateien/Ordner (inkl. des versteckten Ordners `.github/`) per Drag & Drop hochladen
   - **Mit Git:**
     ```bash
     cd druckkalkulator-desktop
     git init
     git add .
     git commit -m "Initial commit"
     git branch -M main
     git remote add origin https://github.com/<dein-nutzername>/<repo-name>.git
     git push -u origin main
     ```
3. Fertig – der Workflow in `.github/workflows/build.yml` startet automatisch bei jedem Push auf `main`

> **Wichtig beim Hochladen über die Weboberfläche:** Ordner, die mit einem Punkt beginnen (`.github`), werden beim Drag & Drop von manchen Browsern übersprungen. Im Zweifel lieber den Git-Weg nutzen oder den Ordner `.github/workflows/build.yml` einzeln über „Add file → Create new file“ mit genau diesem Pfad anlegen und den Inhalt hineinkopieren.

## Installer herunterladen

### Variante A: Über den „Actions“-Tab (bei jedem Push)
1. Im Repo oben auf **Actions** klicken
2. Den neuesten Lauf „Build Desktop-App“ öffnen
3. Ganz unten bei **Artifacts** liegen drei ZIPs (Windows/macOS/Linux) zum Download – enthalten jeweils `.exe`, `.dmg` bzw. `.AppImage`

### Variante B: Über ein Release (empfohlen für Weitergabe an andere)
Ein Release mit fertigen Installern zum direkten Download entsteht automatisch, sobald ein **Tag** im Format `vX.Y.Z` gepusht wird:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Nach ein paar Minuten liegt unter **Releases** (rechte Seitenleiste im Repo) eine Version mit allen drei Installern zum Download bereit – auch für Personen ohne GitHub-Account oder Programmierkenntnisse.

## Was der Workflow macht

- Läuft parallel auf `windows-latest`, `macos-latest` und `ubuntu-latest`
- Installiert Node.js, führt `npm install` und `npm run build` aus (identisch zu den lokalen Befehlen)
- Lädt die fertigen Installer als Artefakte hoch
- Bei einem Versions-Tag (`v1.0.0` usw.) werden alle drei zusätzlich an ein GitHub Release angehängt

## Änderungen später ausrollen

Einfach `index.html`, `style.css` oder `script.js` anpassen, committen und pushen – der Workflow baut automatisch neue Installer. Für eine neue Release-Version zusätzlich einen neuen Tag setzen (z. B. `v1.0.1`).
