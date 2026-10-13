# Billuminatti

Dashboard pentru homelab, fara dependinte (doar Node.js >= 18):

- **Resurse**: CPU (total), memorie, swap, load, temperatura, disc, trafic retea
- **Aplicatii**: containerele Docker, cu stare, imagine, porturi publicate si CPU/RAM per container
- **Porturi**: toate porturile TCP (LISTEN) / UDP deschise, cu procesul si containerul care le foloseste

## Rulare

```bash
docker compose up -d --build     # apoi http://IP-HOMELAB:5095
# sau, direct:
node server.js
```

Compose-ul foloseste `network_mode: host` si `pid: host` ca sa vada porturile si procesele gazdei, si monteaza `docker.sock` (read-only) pentru lista de aplicatii.

Variabile: `PORT` (5095), `HOST` (0.0.0.0), `DOCKER_SOCKET`, `DISK_PATHS` (ex. `/,/mnt/data`).

## Generator de porturi libere

Butonul **Genereaza port liber** (sau `POST /api/free-port?count=3&min=10000&max=20000`, cu sesiune autentificata) returneaza un port aleatoriu care:
nu e deschis pe gazda (TCP/UDP), nu e publicat de niciun container Docker, nu e portul dashboardului si se poate face efectiv `bind` pe el. Un port oferit nu mai e oferit din nou 10 minute. Intervalul implicit e `10000-32000` (`FREE_PORT_RANGE`).

## CI/CD (GitHub Actions, runner self-hosted)

`.github/workflows/deploy.yml`: la PR face doar verificare + build; la push pe `main` (sau manual) face build si `docker compose up -d --build` pe runner, apoi un health check pe portul 5095.

Cerinte pe runner: Docker + plugin-ul `docker compose` si utilizatorul runner-ului in grupul `docker` (Node si curl nu sunt necesare pe runner; verificarile ruleaza in container). In *Settings > Secrets and variables > Actions* seteaza `AUTH_PASSWORD` (sau `AUTH_PASSWORD_HASH`) si optional `AUTH_USER`. Jobul de deploy foloseste environment-ul `homelab` (se creeaza automat; ii poti adauga aprobari manuale).

## Autentificare

Login cu utilizator + parola (sesiune in cookie `HttpOnly`/`SameSite=Strict`, maxim 5 incercari esuate / 15 min per IP).

- `AUTH_USER` (implicit `admin`), `AUTH_PASSWORD` sau, mai bine, `AUTH_PASSWORD_HASH` generat cu `node hash-password.js "parola"`
- Daca nu setezi nicio parola, se genereaza una la pornire si apare in loguri
- `TRUST_PROXY=true` (in spatele Cloudflare Tunnel / reverse proxy: foloseste `CF-Connecting-IP`/`X-Forwarded-For` pentru limitarea incercarilor si marcheaza cookie-ul `Secure` pe HTTPS), `SESSION_HOURS` (168), `COOKIE_SECURE=true` cand e dupa HTTPS, `AUTH_DISABLED=true` pentru a opri login-ul

Traficul nu e criptat de aplicatie: pentru acces din afara retelei locale pune-l in spatele unui reverse proxy cu HTTPS.
