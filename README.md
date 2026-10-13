# Billuminatti

Dashboard pentru homelab, fara dependinte (doar Node.js >= 18):

- **Resurse**: CPU (total), memorie, swap, load, temperatura, disc, trafic retea
- **Aplicatii**: containerele Docker, cu stare, imagine, porturi publicate si CPU/RAM per container
- **Porturi**: toate porturile TCP (LISTEN) / UDP deschise, cu procesul si containerul care le foloseste

## Rulare

```bash
docker compose up -d --build     # apoi http://IP-HOMELAB:8080
# sau, direct:
node server.js
```

Compose-ul foloseste `network_mode: host` si `pid: host` ca sa vada porturile si procesele gazdei, si monteaza `docker.sock` (read-only) pentru lista de aplicatii.

Variabile: `PORT` (8080), `HOST` (0.0.0.0), `DOCKER_SOCKET`, `DISK_PATHS` (ex. `/,/mnt/data`).

## Autentificare

Login cu utilizator + parola (sesiune in cookie `HttpOnly`/`SameSite=Strict`, maxim 5 incercari esuate / 15 min per IP).

- `AUTH_USER` (implicit `admin`), `AUTH_PASSWORD` sau, mai bine, `AUTH_PASSWORD_HASH` generat cu `node hash-password.js "parola"`
- Daca nu setezi nicio parola, se genereaza una la pornire si apare in loguri
- `SESSION_HOURS` (168), `COOKIE_SECURE=true` cand e dupa HTTPS, `AUTH_DISABLED=true` pentru a opri login-ul

Traficul nu e criptat de aplicatie: pentru acces din afara retelei locale pune-l in spatele unui reverse proxy cu HTTPS.
