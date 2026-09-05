# ethol-api

Read-only ETHOL (notifikasi + kuliah) + Telegram. Tidak mark-read, tidak auto-presensi.

Butuh Node 22. Session = file `.cookie` (jangan di-git). Telegram = `.env`.

## Laptop

```
cp .env.example .env   # isi token + chat id
# .cookie sudah ada dari login
node --experimental-strip-types ethol.ts serve
```

http://127.0.0.1:8787/  ·  /v1/notifications  ·  /v1/courses

## VPS (plug)

1. `git clone git@github.com:ArdineSB/ethol-api.git && cd ethol-api`
2. Copy `.env` dan `.cookie` dari laptop (scp). Jangan commit.
3. Node 22: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
4. systemd:

```
sudo cp ethol-api.service /etc/systemd/system/
sudo nano /etc/systemd/system/ethol-api.service   # path User=
sudo systemctl daemon-reload && sudo systemctl enable --now ethol-api
```

Laptop boleh mati. Cookie expire → refresh otomatis; kalau refresh gagal, login ETHOL lagi, copy `.cookie` baru.
