# Callytics live zetten en testen

Go-live en testgids voor deze opstelling: één VPS met publiek IP waarop ook FreePBX draait, Caddy de websites en certificaten regelt en Headscale het private netwerk (tailnet) levert. De SIP-provider gebruikt IP-whitelisting, de softphone is Groundwire (Acrobits) over TLS met SRTP.

Placeholders in dit document: `sip.example.com`, `callytics.example.com`, `<publiek-ip>`, `<tailnet-ip>`, `<provider-ip>`. Vervang ze door je eigen waarden. De voorbeeldbestanden staan in `deploy/examples/`.

## 1. Overzicht van de architectuur

Het Callytics-scherm heeft geen inlog. Daarom is het alleen bereikbaar via het tailnet, achter Caddy met HTTPS en een IP-allowlist. SIP en audio zijn wel publiek bereikbaar, omdat de provider en de softphones van buiten komen.

```
Provider (<provider-ip>) --UDP 5080--> Asterisk (Callytics)
Groundwire  ---------TLS 5081-------> Asterisk (Callytics)
Groundwire/provider --RTP UDP 10100-10120--> Asterisk

Browser (tailnet) --HTTPS 443--> Caddy --> nginx 127.0.0.1:3000 --> backend 127.0.0.1:3001
                                                   |--> /ws --> Asterisk 127.0.0.1:8088 (browser-softphone)
```

| Poort | Protocol | Dienst | Bereikbaar vanaf |
|---|---|---|---|
| 22 | TCP | SSH | Naar keuze (liefst alleen tailnet) |
| 80, 443 | TCP | Caddy (websites, Let's Encrypt) | Publiek. De UI-site laat alleen tailnet-adressen door |
| 5080 | UDP | Callytics SIP voor de provider (`SIP_PORT`) | Alleen `<provider-ip>` (ufw) |
| 5081 | TCP | Callytics SIP TLS voor Groundwire (`SIP_TLS_PORT`) | Publiek |
| 10100-10120 | UDP | Callytics RTP (audio) | Publiek |
| 5060 | UDP | FreePBX SIP | Niet in het ufw-voorbeeld, zelf regelen (stap 6) |
| 5061 | TCP | FreePBX SIP TLS (later) | Gereserveerd voor FreePBX, daarom gebruikt Callytics 5081 |
| 10000-20000 | UDP | FreePBX RTP | Niet in het ufw-voorbeeld, zelf regelen (stap 6) |
| 3478 | UDP | Headscale DERP/STUN (alleen als Headscale op deze server draait) | Publiek |
| 3000 | TCP | Callytics web (nginx) | Alleen `127.0.0.1` |
| 3001 | TCP | Callytics backend API | Alleen `127.0.0.1` |
| 8088 | TCP | Asterisk HTTP (ARI en websocket) | Alleen `127.0.0.1` |
| 5039 | TCP | Asterisk AMI (`AMI_PORT`, FreePBX gebruikt 5038) | Alleen `127.0.0.1` |
| 3002, 5432, 6380 | TCP | Stasis health, PostgreSQL, Redis | Alleen `127.0.0.1` |

Asterisk luistert ook op TCP 5080 (`transport-tcp`). Die poort staat niet open in de firewall.

## 2. Vereisten

- DNS A-records voor `sip.example.com` en `callytics.example.com` naar `<publiek-ip>`. Beide zijn nodig: `sip.*` voor het certificaat en de softphone, `callytics.*` voor het certificaat van de UI.
- Caddy, geïnstalleerd via apt en draaiend onder systemd. Poorten 80 en 443 moeten van buiten bereikbaar zijn voor de Let's Encrypt-validatie.
- De server is client in je Headscale-tailnet (`tailscale up --login-server https://<headscale-url>`). Noteer het tailnet-IP met `tailscale ip -4`. Dat is `<tailnet-ip>`.
- Docker 24 of nieuwer met Docker Compose v2.
- Het IP-adres van de provider (`<provider-ip>`) en de SIP-gegevens van de provider.

## 3. Installatie

Zorg dat Caddy het certificaat voor `sip.example.com` al heeft (stap 4), voordat je Callytics start. Anders staat TLS uit.

```bash
git clone <repository-url> callytics
cd callytics
bash scripts/install.sh
```

Het script maakt `.env` aan uit `.env.example`, genereert de geheimen en stelt de installatievragen. Een bestaande `.env` wordt nooit overschreven, bestaande waarden zijn het voorstel. Met `--yes` worden alle voorstellen geaccepteerd. Het script start daarna de stack met `docker compose up -d`. De eerste start duurt 3 tot 5 minuten, omdat Asterisk in de container gebouwd wordt.

Controleer of `.env` deze waarden heeft (pas aan met een editor en start opnieuw met `docker compose up -d`):

| Waarde | Voorbeeld | Uitleg |
|---|---|---|
| `HOST_IP` | `<publiek-ip>` | Publiek IP van de server, gebruikt in SIP-provisioning. |
| `SIP_PORT` | `5080` | SIP voor de provider. FreePBX zit op 5060, dus Callytics gebruikt 5080. |
| `AMI_PORT` | `5039` | Asterisk Manager Interface. FreePBX gebruikt 5038. Luistert alleen op `127.0.0.1`. |
| `RTP_PORT_START`, `RTP_PORT_END` | `10100`, `10120` | RTP-bereik voor de eerste start. FreePBX gebruikt 10000-20000, het bereik mag niet overlappen. Elk gesprek gebruikt twee poorten (RTP en RTCP), 21 poorten is dus ruim voor ongeveer 10 gelijktijdige gesprekken. Na de eerste start beheer je het bereik in Settings. |
| `SIP_TLS_PORT` | `5081` | TLS-poort voor Groundwire. 5061 is gereserveerd voor FreePBX. |
| `SIP_TLS_HOSTNAME` | `sip.example.com` | Naam waarmee de softphone verbindt. Bepaalt ook de bestandsnamen `sip.example.com.crt` en `sip.example.com.key` en de provisioning-URI. |
| `SIP_TLS_CERT_DIR` | `/etc/callytics/tls` | Map op de host met certificaat en sleutel. Wordt read-only in de asterisk-container gemount. Leeg betekent: TLS uit. De map moet bestaan, anders weigert Docker de container te starten. Kan de container de opslag van Caddy niet lezen, gebruik dan de kopie uit stap 4. |
| `SIP_TLS_CERT_FILE`, `SIP_TLS_KEY_FILE` | leeg | Alleen invullen als de bestandsnamen afwijken van `<hostname>.crt` en `<hostname>.key`. |
| `SIP_TLS_WATCH_INTERVAL` | `3600` | Seconden tussen controles op een vernieuwd certificaat (zie stap 7). |
| `WEB_BIND_ADDR` | `127.0.0.1` | Bind-adres van de web-UI (poort 3000). Laat op `127.0.0.1`, Caddy is de enige toegang. |
| `BACKEND_BIND_ADDR` | `127.0.0.1` | Bind-adres van de backend API (poort 3001). |
| `ARI_BIND_ADDR` | `127.0.0.1` | Bind-adres van Asterisk HTTP (poort 8088, ARI en browser-softphone websocket). |
| `UPLOAD_MAX_MB` | `100` | Maximale uploadgrootte voor audio, geldt voor nginx en de backend. |
| `DIRECT_OUTBOUND_TIMEOUT_MS` | `30000` | Hoe lang een uitgaand gesprek met `#`-prefix op opnemen door de provider wacht (minimaal 1000). |
| `DB_PASS`, `ARI_PASS`, `AMI_PASS`, `RECORDINGS_INTERNAL_TOKEN` | gegenereerd | Geheimen. Laat ze niet leeg: `docker compose` weigert dan te starten. |

`DB_PASS` wordt alleen toegepast bij het aanmaken van het database-volume. Wijzig je `DB_PASS` na de eerste start, pas dan ook het wachtwoord binnen PostgreSQL aan, anders kunnen backend en stasis niet meer inloggen.

Controle na de start:

```bash
docker compose ps
docker compose logs asterisk | grep asterisk-entrypoint
```

In de logregels staat onder meer `SIP TLS enabled on port 5081`. Staat er `SIP TLS disabled`, dan noemt de regel wat ontbreekt.

## 4. Caddy configureren

1. Open `deploy/examples/Caddyfile.example` en kopieer de twee site-blokken naar `/etc/caddy/Caddyfile`. Pas de hostnamen aan.
2. Optioneel: zet `basic_auth` aan. Maak de hash met `caddy hash-password` en plak die in het commentaarblok. Op Caddy ouder dan 2.8 heet de directive `basicauth`.
3. Valideer en laad opnieuw:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

4. Het blok voor `sip.example.com` bestaat alleen om het certificaat te laten uitgeven (`abort`, er wordt niets geserveerd). Controleer na een minuut of het certificaat er is:

```bash
sudo ls /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/sip.example.com/
```

Verwacht: `sip.example.com.crt`, `sip.example.com.key` en `sip.example.com.json`. Dit is het pad dat Caddy via apt gebruikt. Wijkt jouw pad af, zoek het dan met `sudo find /var/lib/caddy -name 'sip.example.com.crt'` en zet de map in `SIP_TLS_CERT_DIR`.

Draait Caddy als root, dan staat het certificaat in `/root/.local/share/caddy/certificates/...`. Zoek het pad met `sudo find / -name 'sip.example.com.crt' -path '*caddy*' 2>/dev/null`.

Rechten: de sleutel is alleen leesbaar voor de gebruiker van Caddy (`caddy` of `root`). Draait Docker als root, dan kan `SIP_TLS_CERT_DIR` direct naar de map van Caddy wijzen. Draait Docker rootless of onder een andere gebruiker (bijvoorbeeld `callytics`), dan kan de container die map niet lezen. Wijzig de rechten van Caddy niet, maar laat een kopie maken:

```bash
cd deploy/examples
sudo install -m 0755 callytics-tls-sync.sh /usr/local/sbin/callytics-tls-sync
sudo install -m 0644 callytics-tls-sync.service callytics-tls-sync.timer /etc/systemd/system/
sudo nano /etc/systemd/system/callytics-tls-sync.service   # hostname, Caddy-map en gebruiker aanpassen
sudo systemctl daemon-reload
sudo systemctl enable --now callytics-tls-sync.timer
sudo systemctl start callytics-tls-sync.service
sudo journalctl -u callytics-tls-sync.service -n 5
sudo ls -l /etc/callytics/tls/
```

Het script draait als root, controleert of sleutel en certificaat bij elkaar horen en kopieert ze naar `/etc/callytics/tls` met eigenaar `callytics` (certificaat 0644, sleutel 0640, map 0750). Het vervangt de bestanden alleen als ze veranderd zijn. De timer draait elk uur. Zet daarna `SIP_TLS_CERT_DIR=/etc/callytics/tls` in `.env`.

WebSocket-verkeer (`/socket.io` en het softphone-pad `/ws`) wordt door `reverse_proxy` in Caddy standaard doorgegeven. Er is geen extra instelling nodig.

## 5. Headscale DNS

De UI-site laat alleen bronadressen uit het tailnet toe (`100.64.0.0/10` en `fd7a:115c:a1e0::/48`). Dat werkt alleen als de browser via het tailnet bij Caddy aankomt. Wijst `callytics.example.com` voor tailnet-clients naar het publieke IP, dan verbinden ze via het internet, ziet Caddy hun publieke adres en weigert de allowlist ze.

Zet daarom in de Headscale-configuratie een extra DNS-record dat de UI-hostnaam naar het tailnet-IP van de server wijst (`deploy/examples/headscale-dns.example.yaml`):

```yaml
dns:
  magic_dns: true
  extra_records:
    - name: "callytics.example.com"
      type: "A"
      value: "<tailnet-ip>"
```

Herstart Headscale daarna (`sudo systemctl restart headscale`). Bij Headscale ouder dan 0.23 heet de sleutel `dns_config.extra_records`. Controle vanaf een tailnet-client:

```bash
dig +short callytics.example.com
```

Verwacht: `<tailnet-ip>`. Buiten het tailnet blijft het publieke record gelden, daar wordt de verbinding door Caddy afgebroken.

## 6. Firewall (ufw)

Gebruik `deploy/examples/ufw.example.sh` als uitgangspunt. Het bestand is niet uitvoerbaar en begint met `exit 1`, zodat je het niet per ongeluk draait.

Waarschuwing: met `default deny incoming` sluit je jezelf buiten als de SSH-regel ontbreekt. Houd een tweede sessie of console-toegang open en zet de SSH-regel vóór `ufw enable`.

Volgorde:

1. SSH toestaan (`ufw allow 22/tcp`, of alleen via `tailscale0`).
2. Standaardbeleid: inkomend weigeren, uitgaand toestaan.
3. Alles op de interface `tailscale0` toestaan.
4. 80/tcp en 443/tcp (Caddy).
5. `SIP_PORT` (5080/udp) alleen vanaf elk `<provider-ip>`.
6. `SIP_TLS_PORT` (5081/tcp) voor iedereen.
7. Callytics RTP-bereik (10100-10120/udp) voor iedereen.
8. Draait Headscale op deze server: 3478/udp voor DERP/STUN.
9. `ufw show added` lezen en daarna `ufw enable`.

Het voorbeeld bevat geen regels voor andere diensten op de server, zoals FreePBX. Gebruikt FreePBX nu poorten van buiten (5060/udp, 10000-20000/udp, later 5061/tcp), voeg die regels dan zelf toe vóór `ufw enable`. Anders is FreePBX daarna niet meer bereikbaar.

Poort 5081 staat open voor iedereen. Dat is nodig, omdat Acrobits-pushnotificaties via hun eigen servers registreren (zie stap 9). De bescherming bestaat uit een sterk extensiewachtwoord en verplichte TLS met SRTP. Er is geen testaccount op de SIP-poort aanwezig (het vaste `test-phone`-endpoint is verwijderd).

## 7. Certificaatvernieuwing

Caddy vernieuwt het certificaat zelf, ongeveer 30 dagen voor het verloopt. Asterisk leest het certificaat maar één keer bij het laden. Zonder actie blijft Asterisk dus het oude certificaat gebruiken.

Wat gemeten is (lokale Asterisk 20.21-container met een zelfgemaakt ECDSA-certificaat, de sleutelsoort die Caddy standaard gebruikt):

- Certificaat en sleutel vervangen zonder reload: `openssl s_client` toont nog het oude serienummer.
- Daarna `module reload res_pjsip.so`: `openssl s_client` toont het nieuwe serienummer. Het certificaat wordt dus zonder herstart overgenomen.
- `pjsip reload` bestaat niet in Asterisk 20 ("No such command").
- Een certificaat met een sleutel die er niet bij hoort, gevolgd door een reload, breekt elke TLS-handshake tot de bestanden weer kloppen.

Gebruik je de kopie uit stap 4, dan zet de timer het vernieuwde certificaat binnen een uur in `/etc/callytics/tls`. Daarna pakt de controle-lus hieronder het op, dus het kan tot twee uur duren voordat Asterisk het nieuwe certificaat gebruikt.

Daarom draait in de asterisk-container een controle-lus (in `docker/asterisk/entrypoint.sh`):

1. Elke `SIP_TLS_WATCH_INTERVAL` seconden (standaard 3600) wordt de hash van certificaat en sleutel vergeleken met de geladen versie.
2. Is er iets veranderd, dan wacht de lus 10 seconden, zodat Caddy beide bestanden kan wegschrijven.
3. De lus controleert of sleutel en certificaat bij elkaar horen. Zo niet, dan blijft het geladen certificaat actief en probeert de lus het een uur later opnieuw.
4. Klopt het, dan voert de lus `module reload res_pjsip.so` uit en logt `SIP TLS certificate changed, reloaded res_pjsip`.

Nuttige commando's:

```bash
docker compose logs asterisk | grep "SIP TLS"
docker compose exec asterisk asterisk -rx "module reload res_pjsip.so"
echo | openssl s_client -connect sip.example.com:5081 -servername sip.example.com 2>/dev/null | openssl x509 -noout -serial -enddate
```

Beperkingen:

- Er bestond nog geen certificaat toen de container startte: herstart eenmalig de asterisk-container (`docker compose restart asterisk`), want `transport-tls` wordt alleen bij het starten aangemaakt.
- Niet getest: een echte Caddy-vernieuwing, en wat de reload doet met reeds geregistreerde TLS-clients tijdens een lopend gesprek. Groundwire registreert opnieuw als de verbinding wegvalt. Controleer de eerste vernieuwing in de praktijk met de commando's hierboven.

## 8. Callytics instellen in de UI

Open `https://callytics.example.com` via het tailnet.

**Trunk met IP-whitelisting (aanbevolen voor deze provider)**

1. Ga naar Configure > Trunks en kies Add trunk.
2. Vul `host` in met het SIP-adres van de provider. `port` is de poort van de provider (meestal 5060).
3. Vul `inbound IP addresses` in met alle `<provider-ip>`-adressen, één per regel (IPv4 of CIDR). Inkomende gesprekken van deze adressen worden aan de trunk gekoppeld via een `identify`-sectie.
4. Vul `from domain` en `from user` in zoals de provider verwacht.
5. Laat `username` leeg. Bij pure IP-whitelisting zijn er geen credentials en wordt er niet geregistreerd.
6. Gebruik credentials alleen als de provider digest-authenticatie vraagt. Let op: met de preset `generic` en ingevulde credentials registreert Callytics zich ook bij de provider. De presets `twilio`, `telnyx`, `vonage` en `signalwire` registreren niet.

**Inkomende route**

Ga naar Configure > Inbound en maak een route met het nummer (DID) in E.164-notatie, bijvoorbeeld `+31201234567`. Spaties en streepjes worden verwijderd. Koppel een gepubliceerde flow.

**Standaard uitgaande trunk**

Kies op de Trunks-pagina onder "direct outbound dial" de standaard uitgaande trunk en sla op. Zonder deze keuze kun je niet uitbellen vanaf een extensie, met of zonder `#`.

**Uitgaand bellen en nummerconversie**

Extensies bellen externe nummers rechtstreeks, zonder `#`. Het nummer gaat via de standaard uitgaande trunk. Interne nummers (extensies) en inkomende nummers (DID's) hebben voorrang, `#<nummer>` blijft werken. Trunks kunnen nooit uitbellen: alleen extensies hebben toegang tot uitgaand verkeer.

Instellingen onder Settings > Outbound dialing:

| Instelling | Standaard | Werking |
|---|---|---|
| Dial external numbers without # | aan | Uit: alleen `#<nummer>` belt uit, andere nummers gaan naar de standaardflow. Opslaan herlaadt het dialplan in Asterisk zonder herstart |
| Convert dialed numbers to E.164 | aan | Uit: het nummer gaat ongewijzigd naar de trunk (alleen de `#` wordt verwijderd) |
| Country code | `31` | Landcode die een nummer met een voorloopnul krijgt |
| International prefix | `00` | Voorvoegsel dat een internationaal nummer aanduidt |
| Waiting audio while dialing out | Ringback tone | Wat de beller hoort tot de andere kant opneemt. Ringback tone: Asterisk stuurt 180 Ringing en de telefoon speelt zijn eigen beltoon. Hold music: Asterisk speelt wachtmuziek (klasse `DIRECT_OUTBOUND_MOH_CLASS`). Stasis leest de keuze bij elk gesprek |

Conversie met de standaardwaarden: spaties, streepjes, punten en haakjes worden verwijderd, `0612345678` wordt `+31612345678`, `0044...` wordt `+44...`, `+44...` blijft gelijk en korte nummers zoals `112` blijven gelijk. Stasis leest deze waarden bij elk gesprek, een wijziging werkt dus direct. De trunk-instelling "dial format" wordt daarna op de cijfers van het genormaliseerde nummer toegepast. Nummers korter dan 9 cijfers worden daarbij geweigerd.

**RTP-bereik**

Controleer onder Settings > Media (RTP) dat het bereik 10100-10120 is. Een wijziging wordt direct in `rtp.conf` geschreven en herlaadt de RTP-module.

**Extensie met TLS**

1. Ga naar Configure > Extensions en kies Add extension.
2. Kies als transport `SIP / TLS + SRTP`. Staat deze optie er niet, dan meldt de pagina dat SIP TLS niet is geconfigureerd. Controleer dan `SIP_TLS_*` in `.env` en de logs van asterisk.
3. Kies een sterk wachtwoord. De extensie gebruikt `transport-tls` met `media_encryption = sdes` en `media_encryption_optimistic = no`: zonder SRTP komt er geen gesprek tot stand.
4. De QR-inhoud en de URI in de lijst zijn `sip:<gebruiker>@sip.example.com:5081;transport=tls`.

**Flows verplaatsen naar een andere installatie**

1. Klik op de bron-installatie bij Configure > Flow Builder op `export json` (of in de flow-editor rechtsboven). Je krijgt een `.json`-bestand met de laatst opgeslagen versie, inclusief submenu's.
2. Open op de nieuwe installatie Configure > Templates, kies `Import JSON` en selecteer het bestand. Er wordt altijd een nieuwe flow aangemaakt.
3. Audiobestanden, trunks en wachtrijen worden met een nummer (id) in de flow bewaard en bestaan op de nieuwe installatie meestal niet onder hetzelfde nummer. Callytics toont daarvoor waarschuwingen. Open de flow, kies de juiste audiobestanden, trunks en wachtrijen en sla op voordat je de flow voor live gesprekken gebruikt.

## 9. Groundwire instellen

Maak in Groundwire een SIP-account met deze waarden:

| Instelling | Waarde |
|---|---|
| Gebruikersnaam | Nummer van de extensie |
| Wachtwoord | Wachtwoord van de extensie |
| Domein | `sip.example.com` |
| Poort | `5081` |
| Transport | TLS |
| SRTP | Verplicht (mandatory) |

Externe nummers bel je in Groundwire rechtstreeks, bijvoorbeeld `0612345678` of `+442071234567`, zonder `#`. Callytics zet het nummer om naar E.164 (zie "Uitgaand bellen en nummerconversie" in stap 8). Staat "Dial external numbers without #" uit, dan bel je `#0612345678`.

Push-notificaties: Acrobits SIPIS registreert namens de app vanaf de eigen servers van Acrobits. Dat zijn wisselende adressen, daarom staat poort 5081 open voor iedereen en is een IP-allowlist op deze poort geen optie.

## 10. Testplan

Voer de tests uit na de installatie en na elke grotere wijziging. Alle `asterisk -rx`-commando's draai je met `docker compose exec asterisk asterisk -rx "<commando>"`.

| # | Test | Commando of stappen | Verwachte uitkomst |
|---|---|---|---|
| 1 | Containers gezond | `docker compose ps` | Alle diensten `healthy` |
| 2 | Provider-identify | `pjsip show identifies` | Een identify per trunk met een `Match:` per `<provider-ip>` |
| 3 | Endpoints | `pjsip show endpoints` | Trunk-endpoint en extensies aanwezig. Een TLS-extensie toont na registratie een contact |
| 4 | Transports | `pjsip show transports` | `transport-udp` en `transport-tcp` op 5080, `transport-tls` op 5081 |
| 5 | RTP-instellingen | `rtp show settings` | Start 10100 en einde 10120 |
| 6 | TLS-handshake | `openssl s_client -connect sip.example.com:5081 -servername sip.example.com` | Geldig Let's Encrypt-certificaat voor `sip.example.com`, `Verify return code: 0 (ok)` |
| 7 | HTTP alleen lokaal | `docker compose exec asterisk asterisk -rx "http show status"` | `Server Enabled and Bound to 127.0.0.1:8088` |
| 8 | UI niet bereikbaar van buiten | Vanaf een extern netwerk (zonder tailnet): `curl -vk https://callytics.example.com` | Verbinding mislukt of wordt zonder antwoord gesloten |
| 9 | UI wel bereikbaar via tailnet | Vanaf een tailnet-client: `curl -I https://callytics.example.com` | `HTTP/2 200` (met `basic_auth`: `401` zonder inlog) |
| 10 | Poorten van buiten dicht | Vanaf een extern netwerk: `nc -zv <publiek-ip> 3000`, idem 3001 en 8088 | Alle drie geweigerd of time-out |
| 11 | Inkomend gesprek | Bel het DID vanaf een mobiele telefoon | Flow start, audio in beide richtingen. In `docker compose logs stasis` staan de node-events |
| 12 | Uitgaand met `#` | Bel vanuit een extensie `#<nummer>` | Gesprek gaat via de standaard uitgaande trunk. Bij een fout staat de reden in de stasis-logs (`DIRECT_OUTBOUND_TIMEOUT_MS` geldt als wachttijd) |
| 12a | Uitgaand zonder `#` | Bel vanuit een extensie een extern nummer zonder `#`, bijvoorbeeld `06...` | Gesprek gaat via de standaard uitgaande trunk. De stasis-logs tonen `normalized dialed number 06... to +316...` |
| 12b | Nummerconversie | Bel `0031...` en `+31...` vanuit een extensie | Beide gaan als `+31...` naar de trunk. Zet "Convert dialed numbers to E.164" uit en bel opnieuw: het nummer gaat ongewijzigd |
| 12c | Trunk kan niet uitbellen | `dialplan show callytics-inbound` | Alleen extensies en DID's, geen `_#.` en geen `Goto`. `dialplan show callytics-extensions` toont ook `_#.` en `_X.` |
| 12d | Wachtgeluid | Bel een extern nummer met "Ringback tone" en daarna met "Hold music" | Eerst hoor je de beltoon van de telefoon, daarna wachtmuziek. Na opnemen is het gesprek in beide gevallen hoorbaar |
| 13 | Ophangen tijdens playback | Bel een flow met een lange audio-node en hang op tijdens het afspelen | Flow stopt. Logregel `FlowStoppedCallerGone` in `docker compose logs stasis` |
| 14 | Twee gelijktijdige gesprekken | Start twee gesprekken tegelijk (bijvoorbeeld twee keer het DID) | Beide hebben audio. `core show channels` toont beide. Met 21 RTP-poorten is dit ruim binnen het bereik |
| 15 | Groundwire registreren | Account aanmaken volgens stap 9 | Status geregistreerd. `pjsip show contacts` toont het contact met `transport=tls` |
| 16 | Gesprek met SRTP | Bel met Groundwire en voer tijdens het gesprek `pjsip show channelstats` en `core show channels` uit | Het gesprek is actief en audio is hoorbaar. Controleer de SRTP-status met `pjsip set logger on`: in de SDP staat `RTP/SAVP` en een `a=crypto`-regel |
| 17 | SRTP niet te omzeilen | Zet SRTP in Groundwire tijdelijk uit en bel | Gesprek wordt geweigerd (verwacht SIP 488, geen audio zonder SRTP). Dit gedrag is niet lokaal getest, controleer het bij de eerste keer |
| 18 | Uploadlimiet audio | Upload een audiobestand groter dan `UPLOAD_MAX_MB` bij een audionode | Upload wordt geweigerd (HTTP 413). Een bestand kleiner dan de limiet lukt |
| 19 | Certificaatpad | `docker compose logs asterisk \| grep "SIP TLS"` | `SIP TLS enabled on port 5081` |

## 11. Probleemoplossing

Logs:

```bash
docker compose logs asterisk
docker compose logs backend
docker compose logs stasis
docker compose logs -f stasis   # live meekijken
```

SIP-verkeer zien: `docker compose exec asterisk asterisk -rx "pjsip set logger on"`, daarna `docker compose logs -f asterisk`. Zet het uit met `pjsip set logger off`. Let op: op poort 5081 is het verkeer versleuteld op de lijn, maar Asterisk toont de ontsleutelde berichten.

Bekende valkuilen:

| Probleem | Oorzaak en oplossing |
|---|---|
| UI niet bereikbaar via het tailnet, Caddy sluit de verbinding | De hostnaam wijst naar het publieke IP. Controleer met `dig +short callytics.example.com` op de client dat `<tailnet-ip>` terugkomt en stel de Headscale `extra_records` in (stap 5). |
| UI geeft een TLS-fout | Caddy heeft het certificaat nog niet. Controleer `sudo journalctl -u caddy` en of 80/443 van buiten bereikbaar zijn en het A-record klopt. |
| Poort 5061 is bezet | FreePBX gebruikt 5061 voor TLS. Gebruik voor Callytics `SIP_TLS_PORT=5081`. |
| Poort 5038 of 5060 is bezet | FreePBX gebruikt deze. Gebruik `AMI_PORT=5039` en `SIP_PORT=5080`. |
| `SIP TLS disabled` in de logs | Certificaat of sleutel niet gevonden of niet leesbaar. Controleer `SIP_TLS_CERT_DIR`, `SIP_TLS_HOSTNAME` en of `<hostname>.crt` en `<hostname>.key` in die map staan. Draait Docker niet als root, gebruik dan de kopie uit stap 4. Herstart daarna de asterisk-container. |
| `docker compose up` meldt `bind source path does not exist` | `SIP_TLS_CERT_DIR` wijst naar een map die niet bestaat. Laat Caddy eerst het certificaat uitgeven of maak de variabele leeg. |
| TLS-optie ontbreekt bij extensies | SIP TLS is niet actief, zie hierboven. De backend leest dit uit het gegenereerde `pjsip_tls.conf`. |
| TLS-handshake mislukt na een vernieuwing | Sleutel en certificaat horen niet bij elkaar. Controleer de bestanden en voer `docker compose exec asterisk asterisk -rx "module reload res_pjsip.so"` uit. |
| `docker compose` weigert te starten met `... is not set in .env` | Een geheim is leeg. Draai `bash scripts/install.sh` opnieuw, het vult lege geheimen aan en laat bestaande ongemoeid. |
| Backend en stasis kunnen niet inloggen op PostgreSQL | `DB_PASS` is gewijzigd na de eerste start. Zet het oude wachtwoord terug in `.env` of pas het wachtwoord in PostgreSQL aan. |
| Inkomend gesprek komt niet binnen | Controleer `pjsip show identifies` (staat `<provider-ip>` erin?), de ufw-regel voor 5080/udp vanaf de provider, en `pjsip set logger on` om te zien of het INVITE binnenkomt en met welk adres. |
| Haperende of digitale audio, twee kanalen per gesprek | De provider stuurt het eerste INVITE opnieuw (zelfde Call-ID) ook na 200 OK en ACK, waardoor Asterisk een tweede kanaal aanmaakt en twee RTP-stromen door elkaar lopen. Stasis herkent dit aan de SIP Call-ID, hangt het dubbele kanaal op vóór het antwoordt en logt `Dropping duplicate inbound call`. Controleer met `pjsip set logger on` of het INVITE herhaald wordt. |
| Eenrichtingsaudio | RTP-bereik niet open in de firewall of overlap met FreePBX. Controleer `rtp show settings` en de ufw-regel voor 10100:10120/udp. |
| Browser-softphone verbindt niet | De websocket loopt via `/ws` op dezelfde site. Controleer of nginx draait en `docker compose exec asterisk asterisk -rx "http show status"` de websocket (`/ws`) toont. |
