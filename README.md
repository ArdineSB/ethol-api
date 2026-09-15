# ethol-api

Unofficial read-layer + Telegram bot di atas ETHOL PENS. Bukan LMS baru. Satu proses TypeScript (`ethol.ts`).

- Tidak mark-read notifikasi kampus
- Tidak submit tugas
- Tidak buka/tutup presensi dosen
- Auto-presensi mahasiswa: `POST /presensi/mahasiswa` saat sesi `open === 1` (opt-in)
- Session = cookie ETHOL (bukan password CAS di git/chat)

Repo: [ArdineSB/ethol-api](https://github.com/ArdineSB/ethol-api)

Dokumentasi:

- **API** — bagian di bawah
- **Bot Telegram** — [docs/telegram-bot.md](docs/telegram-bot.md)

## Jangan di-git

`.cookie` · `.env` · `.seen.json` · `.presensi.json` · `.login.json` · `.ethol.log` · `sessions/` · `node_modules/`

## HTTP API

`ethol.ts serve` listen `127.0.0.1:8787`.

| Path | Isi |
|---|---|
| `GET /` | HTML ringkas (badge + daftar kuliah) |
| `GET /v1/notifications` | `{ badge, notifications }` — tidak mark-read |
| `GET /v1/courses` | `{ courses }` |

Upstream kampus: `https://ethol.pens.ac.id/api` (cookie `token` + `refresh_token`). 401 → `POST /auth/refresh`. Lihat `recon-ethol.md`.

CLI GET mentah:

```
node --experimental-strip-types ethol.ts /kuliah tahun=2026 semester=1
node --experimental-strip-types ethol.ts /auth/validasi-token
```

## Presensi (CLI)

```
node --experimental-strip-types ethol.ts presensi
node --experimental-strip-types ethol.ts presensi on|off
node --experimental-strip-types ethol.ts presensi timer DD-MM-YYYY jam menit
node --experimental-strip-types ethol.ts presensi go
```

`go` hanya POST jika Auto ON, sesi `open === 1`, belum hadir, dan timer belum habis (kalau Timer ON).

Body POST (sama seperti tombol resmi ETHOL):

```
{ kuliah, jenis_schema, mahasiswa, key, kuliah_asal }
```

## Laptop (dev)

Node 22+. Jangan dual-run `serve` di laptop kalau bot VPS sudah jalan (Telegram 409).

```
cp .env.example .env
# .cookie dari session ETHOL yang sudah login
node --experimental-strip-types ethol.ts serve
node --experimental-strip-types ethol.ts --self-check
```

## VPS

Satu service systemd, nginx + HTTPS di depan. Playwright + Xvfb + noVNC untuk `/login` (browser ETHOL on-demand).

```
git clone git@github.com:ArdineSB/ethol-api.git && cd ethol-api
# copy .env dan .cookie (jangan commit)
npm install
npx playwright install --with-deps chromium
sudo cp ethol-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ethol-api
```

Cookie expire: `/login` di bot (browser web) atau capture ulang session. Jangan simpan password CAS di repo.
