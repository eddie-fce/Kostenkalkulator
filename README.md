# Druckkalkulator

Ein kleines, clientseitiges Tool zur Kalkulation von 3D-Druckaufträgen mit mehreren Produkten (Positionen), Filament-Stammdaten, mehreren Druckerprofilen, automatischem Mengenrabatt und Export als CSV/PDF-Preisangebot.

Keine Installation, kein Backend, kein Build-Schritt – reines HTML/CSS/JavaScript. Läuft direkt im Browser oder per GitHub Pages.

## Funktionen

- **Stammdaten**
  - Beliebig viele Filamente (Material + Farbe + Preis pro kg)
  - Beliebig viele Drucker-Profile (Name, Leistung in Watt, AMS-fähig) – jede Position wird einem Drucker zugeordnet; nur AMS-fähige Drucker erlauben Multicolor ohne manuellen Filamentwechsel
  - Zubehör/Hardware (z. B. Gewindeeinsätze, Schrauben, Muttern) mit Preis pro Stück – wird als Kostenzeile innerhalb einer Position erfasst, nicht als eigene Position
  - Kundenliste (Name, Firma, Adresse, E-Mail, Telefon) – wird beim Speichern eines Angebots automatisch befüllt
  - Positionsvorlagen (Filamente, Zubehör, Zeiten, Drucker) zum Wiederverwenden häufiger Produkte
  - Allgemeine Kosten: Strompreis (€/kWh), Wartung/Verschleiß (€/Druckstunde), Arbeitskosten (€/Stunde), Standard-Express-Zuschlag (%), Druckstunden/Tag/Drucker und Puffertage (Basis der Lieferterminschätzung)
  - Mengenrabatt-Stufen ("ab X Stück Y % Rabatt")
- **Kalkulation**
  - Beliebig viele Positionen (Produkte) pro Auftrag, je mit bis zu 4 Filamenten, Zubehör, Druckzeit, Arbeitszeit, Stückzahl und zugeordnetem Drucker
  - Position **duplizieren** (⧉) oder **als Vorlage speichern** (💾); Vorlagen lassen sich über „Vorlage wählen…“ als neue Position laden
  - **Kundendaten** je Auftrag (Name mit Autovervollständigung aus der Kundenliste, Firma, Adresse, E-Mail, Telefon)
  - **Express-Zuschlag** (%, an-/abschaltbar) und **Lieferterminschätzung** (Button „Termin schätzen“, basierend auf Gesamt-Druckzeit, Anzahl Drucker, Druckstunden/Tag und Puffertagen; bei Express halbieren sich die Puffertage)
  - Automatischer Mengenrabatt anhand der Gesamt-Stückzahl aller Positionen + optionaler manueller Zusatzrabatt
  - Gewinnaufschlag in %
  - Detaillierte Kostenaufschlüsselung je Position und gesamt
  - **CSV-Export als Preisangebot** (Semikolon-getrennt, deutsches Zahlenformat, direkt in Excel/LibreOffice nutzbar)
  - **PDF-Export als Preisangebot** (formatiertes Dokument mit Kundendaten, Positionstabelle und Kostenaufstellung)
  - **Angebot per E-Mail senden**: lädt das PDF herunter und öffnet den Standard-Mail-Client mit vorausgefülltem Betreff/Text an die Kunden-E-Mail – das PDF muss aus Sicherheitsgründen (Browser können keine Anhänge automatisch setzen) manuell angehängt werden
  - **3MF-Import**: gesliste `.gcode.3mf`-Dateien (Bambu Studio / OrcaSlicer) importieren – Druckzeit und Filamentverbrauch je Farbe werden automatisch als neue Position übernommen

## Nutzung

Einfach `index.html` im Browser öffnen – funktioniert lokal per Doppelklick.

### Deployment mit GitHub Pages

1. Repo auf GitHub anlegen und diesen Ordnerinhalt pushen
2. Unter **Settings → Pages** die Quelle auf den `main`-Branch (Root) stellen
3. Die Seite ist danach unter `https://<username>.github.io/<repo>/` erreichbar

## Datenspeicherung

Alle Stammdaten (Filamente, Drucker, Zubehör, Kunden, Positionsvorlagen, allgemeine Kosten, Mengenrabatt-Stufen) werden automatisch im `localStorage` des Browsers gespeichert – lokal auf dem jeweiligen Gerät, ohne Server. Positionen einer Kalkulation werden bewusst **nicht** dauerhaft gespeichert, da sie sich pro Auftrag unterscheiden; gespeicherte Angebote landen dagegen im Archiv (inkl. Kundendaten, Liefertermin und Express-Zuschlag zum Zeitpunkt der Speicherung).

> Hinweis: Dieselbe `script.js` erkennt automatisch, ob eine `window.storage`-API zur Verfügung steht (z. B. innerhalb von Claude-Artefakten) und nutzt sie bevorzugt; andernfalls greift der `localStorage`-Fallback. Für den Einsatz auf GitHub Pages / lokal ist immer der `localStorage`-Fallback aktiv.

## 3MF-Import

Über „Gesliste .gcode.3mf importieren“ lässt sich eine bereits **fertig geslicte** Projektdatei aus Bambu Studio oder OrcaSlicer einlesen:

- In Bambu Studio/OrcaSlicer nach dem Slicen: **Datei → Exportieren → Sliced File exportieren** (`.gcode.3mf`), nicht die normale Projektdatei
- Das Tool liest daraus automatisch Druckzeit und Filamentverbrauch (in Gramm) je Farbe/Slot aus und legt eine neue Position an
- Filamente werden anhand von Material + Farbton mit den Stammdaten abgeglichen; nicht zuordenbare Filamente werden nach dem Import als Warnung aufgelistet und müssen manuell in der Position ausgewählt werden
- **Reine (noch nicht geslicte) Projekt-3MF funktionieren nicht** – diese enthalten keine Zeit-/Verbrauchsdaten, das Tool zeigt dann einen entsprechenden Hinweis
- Stückzahl und Arbeitszeit werden nicht aus der 3MF übernommen (nicht enthalten) und müssen nach dem Import manuell ergänzt werden
- Benötigt eine Internetverbindung beim ersten Laden der Seite (lädt die JSZip-Bibliothek von cdnjs.cloudflare.com nach)

## PDF-Export & Angebot per E-Mail

Der Button „PDF“ erzeugt ein formatiertes Angebotsdokument (Kopf mit Angebots-Nr./Datum/Liefertermin, Kundendaten, Positionstabelle, Kostenaufstellung). Benötigt ebenfalls eine Internetverbindung beim ersten Laden der Seite (lädt jsPDF + jsPDF-AutoTable von cdnjs.cloudflare.com nach).

„Per E-Mail senden“ lädt zuerst dasselbe PDF herunter und öffnet danach den Standard-Mail-Client (`mailto:`) mit der Kunden-E-Mail, einem passenden Betreff und Anschreiben. Der Browser kann aus Sicherheitsgründen keine Dateien automatisch an eine `mailto:`-Mail anhängen – das heruntergeladene PDF muss vor dem Versenden manuell angehängt werden.

## CSV-Export (Preisangebot)

Der Button „Als CSV-Angebot exportieren“ erzeugt aus dem aktuellen Auftrag eine CSV-Datei:

```
Preisangebot
Auftrag;Angebot Kunde Müller
Datum;28.08.2026

Pos.;Produkt;Stückzahl;Einzelpreis (€);Gesamtpreis (€)
1;Halterung V2;10;4,50;45,00

;;;Zwischensumme;45,00
;;;Gewinnaufschlag (20%);9,00
;;;Mengenrabatt (5%);-2,70
;;;Gesamtpreis;51,30
;;;Ø Preis / Stück;5,13
```

- Semikolon als Trennzeichen und Komma als Dezimaltrennzeichen (öffnet in deutschem Excel/LibreOffice korrekt formatiert)
- Wird direkt aus den aktuellen Formularwerten berechnet, unabhängig davon, ob vorher „Kosten berechnen“ geklickt wurde

## Projektstruktur

```
druckkalkulator/
├── index.html   Struktur/Markup
├── style.css    Styling
├── script.js    Anwendungslogik (Stammdaten, Kalkulation, CSV-/PDF-Export, Speicher-Adapter)
├── README.md
└── LICENSE
```

## Lizenz

MIT, siehe [LICENSE](LICENSE).
