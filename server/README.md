# Server-Sync einrichten (Netcup)

Der Druckkalkulator läuft weiter als Desktop-App (oder im Browser). Nur **Kunden und Angebote** (inkl. der Zähler für Kunden-/Angebotsnummer) werden zusätzlich auf eurem Server gespeichert, damit sie auf jedem Gerät gleich sind. Stammdaten (Filamente, Drucker, Kosten, Firmenprofil) bleiben lokal.

Auf dem Server läuft nichts Zusätzliches: `api.php` wird nur aufgerufen, wenn die App speichert oder abgleicht.

Voraussetzung: der Webserver führt PHP (≥ 8.0) aus und die Domain hat HTTPS.

## 1. Dateien hochladen

Den Ordner `server/` aus diesem Repo in ein Unterverzeichnis der Website kopieren, z. B. nach `…/kalkulator-api/`. Danach erreichbar unter `https://eure-domain.de/kalkulator-api/api.php`.

## 2. Token und Datenordner festlegen

```bash
cd kalkulator-api
cp config.sample.php config.php
openssl rand -hex 24      # erzeugt ein Token, in config.php bei 'token' eintragen
```

Empfohlen: in `config.php` `data_dir` auf einen Ordner **außerhalb** des Web-Verzeichnisses setzen (z. B. `/var/lib/druckkalkulator`), der für den PHP-Benutzer beschreibbar ist. Ohne Angabe wird `server/data/` verwendet.

- **Apache:** die mitgelieferte `.htaccess` sperrt `config.php` und reicht den Authorization-Header an PHP durch.
- **nginx:** `config.php` und den Datenordner per `location ~ /(config\.php|data/) { deny all; }` sperren. Falls das Token nicht ankommt (401), in der PHP-Location `fastcgi_param HTTP_AUTHORIZATION $http_authorization;` ergänzen.

## 3. In der App eintragen

Reiter **Stammdaten → Server-Sync**: URL und Token eintragen, „Verbindung testen“, dann „Speichern & neu laden“. Das auf jedem Gerät wiederholen. Beim ersten Verbinden werden bereits lokal vorhandene Kunden/Angebote automatisch zum Server übernommen und mit dem Stand anderer Geräte zusammengeführt.

## So verhält sich der Abgleich

- Änderungen werden nach ca. 1 s zum Server geschickt, beim Verlassen des Fensters sofort.
- Beim Zurückkehren ins Fenster sowie vor dem Speichern eines Angebots bzw. neuen Kunden wird der Server-Stand geholt – so bleiben Nummern eindeutig.
- Ist der Server nicht erreichbar, arbeitet die App mit dem lokalen Stand weiter und überträgt später.
- Der Server lehnt veraltete Schreibzugriffe ab (Revisionszähler); die App führt dann beide Stände zusammen (gleiche ID: lokaler Eintrag gewinnt). Die Zähler können nie sinken.
- Wurde etwas auf einem Gerät gelöscht und gleichzeitig auf einem anderen geändert, kann der Eintrag wieder auftauchen.

## Backup

Pro Schlüssel liegt neben `kunden.json` / `angebote.json` jeweils die vorherige Version als `.bak`. Zusätzlich ein nächtlicher Kopierjob, z. B. per Cron:

```bash
0 3 * * * cp -r /var/lib/druckkalkulator /var/backups/druckkalkulator-$(date +\%F)
```

Es handelt sich um Kundendaten (DSGVO): nur über HTTPS, Token geheim halten, und den Auftragsverarbeitungsvertrag mit Netcup abschließen, falls noch nicht geschehen.
