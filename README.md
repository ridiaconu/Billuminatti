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

> Nu are autentificare — expune-l doar in reteaua locala sau in spatele unui reverse proxy cu auth.
