# Server-Sync einrichten (Netcup)

Der Druckkalkulator läuft weiter als Desktop-App (oder im Browser). Nur **Kunden und Angebote** (inkl. der Zähler für Kunden-/Angebotsnummer) werden zusätzlich auf eurem Server gespeichert, damit sie auf jedem Gerät gleich sind. Stammdaten (Filamente, Drucker, Kosten, Firmenprofil) bleiben lokal.

Auf dem Server läuft nichts Zusätzliches: `api.php` wird nur aufgerufen, wenn die App speichert oder abgleicht.

Voraussetzung: der Webserver führt PHP (≥ 8.0) aus und die Domain hat HTTPS.

## Variante VPS, nur privat erreichbar (Docker + Tailscale) – empfohlen

Die API ist **nicht aus dem Internet erreichbar**. Der Container lauscht nur auf `127.0.0.1` des Servers; Zugriff haben ausschließlich eigene Geräte über ein privates VPN ([Tailscale](https://tailscale.com), für Privatnutzung kostenlos). Es braucht keine Domain, keinen DNS-Eintrag und keinen Proxy. Ressourcenbedarf: ca. 15–20 MB RAM plus der Tailscale-Dienst.

**Auf dem Server (SSH):**

1. Ordner `server/` auf den Server kopieren, z. B. `scp -r server root@SERVER:/root/kalkulator-api`
2. Container bauen und starten (Port 8787, weil Coolify 8080/8000 belegt):
   ```bash
   cd /root/kalkulator-api
   docker build -t kalkulator-api .
   docker run -d --name kalkulator-api --restart unless-stopped \
     -p 127.0.0.1:8787:8080 \
     -e KALKULATOR_TOKEN="$(openssl rand -hex 24)" \
     -v kalkulator-data:/data kalkulator-api
   docker inspect kalkulator-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep KALKULATOR_TOKEN
   ```
   Die letzte Zeile zeigt das Token – notieren. Die Daten liegen im Docker-Volume `kalkulator-data`.
3. Prüfen, dass nur lokal gelauscht wird: `ss -tlnp | grep 8787` muss `127.0.0.1:8787` zeigen (nicht `0.0.0.0`).
4. Tailscale installieren und anmelden:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   tailscale up
   ```
   Den ausgegebenen Link im Browser öffnen und mit dem Tailscale-Konto anmelden (Konto per Google/Microsoft/GitHub-Login anlegen).
5. Im [Tailscale-Admin](https://login.tailscale.com/admin/dns) unter *DNS* **MagicDNS** und **HTTPS Certificates** aktivieren (einmalig).
6. API im privaten Netz freigeben:
   ```bash
   tailscale serve --bg 8787
   ```
   Der Befehl zeigt die Adresse, z. B. `https://be-3d-druck.tail1234.ts.net`. Sie ist nur aus dem eigenen Tailscale-Netz erreichbar.

**Auf jedem Gerät** (PC/Laptop/Handy): Tailscale-App installieren und mit demselben Konto anmelden. In der Druckkalkulator-App unter *Stammdaten → Server-Sync* die Tailscale-Adresse als URL und das Token eintragen. Ist Tailscale auf dem Gerät aus, arbeitet die App lokal weiter und gleicht später ab.

Alternative ohne Drittanbieter: WireGuard selbst auf dem Server betreiben; dann den Container an die WireGuard-IP statt an `127.0.0.1` binden.

## Variante Coolify (öffentlich erreichbar, nur per Token geschützt)

Nur wählen, wenn die API bewusst aus dem Internet erreichbar sein soll:

1. **DNS:** A-Record für eine Subdomain, z. B. `kalkulator.eure-domain.de` → IP des Servers.
2. **Coolify:** *Add Resource* → *Public Repository* → `eddie-fce/Kostenkalkulator`, Branch `main`.
3. **Build Pack:** *Dockerfile*, **Base Directory** `/server`, **Port** `8080`.
4. **Domain:** `https://kalkulator.eure-domain.de` (Zertifikat automatisch).
5. **Environment Variables:** `KALKULATOR_TOKEN` = langes Zufalls-Token (mind. 24 Zeichen).
6. **Persistent Storage:** Volume mit *Destination Path* `/data` – ohne Volume gehen die Daten beim Neustart verloren!
7. **Deploy**, Test im Browser: `https://kalkulator.eure-domain.de/` zeigt `{"error":"unauthorized"}`.

## Variante klassisches Webhosting / Webserver mit PHP

Die folgenden Schritte gelten nur dafür.

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
