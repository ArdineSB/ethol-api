# ethol bot (Telegram)

Satu bot, satu proses `ethol.ts serve`. Bukan bot per orang.

Perintah: `/menu` `/tugas` `/materi` `/jadwal` `/presensi` `/login`

Keyboard: **Tugas** · **Materi** · **Jadwal** · **Presensi**

## Akun

- Owner chat (`TELEGRAM_CHAT_ID` di `.env`) memakai `.cookie`
- Teman: `sessions/<chat_id>.cookie` (jangan kirim password ke bot)
- `/login` cek `GET /auth/validasi-token`. File cookie ada ≠ session hidup

## /login (owner)

Kalau session hidup: `Terhubung: <nama>` + tombol **Login ulang**.

Kalau mati (atau Login ulang):

1. VPS nyalain Xvfb + Chromium (ETHOL sudah kebuka) + noVNC
2. Bot kirim link `https://login.ardeen.fun/v/<kunci>/…` + tombol **Done**
3. Buka di HP/PC, login CAS di halaman ETHOL asli
4. Pencet **Done** → cookie HttpOnly diambil, browser dimatikan
5. Timeout 12 menit

Jangan pakai link lama setelah bot restart. Password CAS tidak disimpan.

## Tugas / Materi / Jadwal

- **Tugas:** daftar belum dikumpul + link halaman ETHOL
- **Materi:** pilih matkul (tombol) → judul + link
- **Jadwal:** seminggu, WIB kampus

Tidak mark-read lonceng kampus. Notif baru di-poll ~5 menit → dikirim ke chat.

## Presensi

Tombol **Presensi** / `/presensi` (owner):

- **Auto ON/OFF** — kalau ON, tiap ~5 menit cek sesi `open === 1`
- **Timer ON** — batas berhenti (WIB), bukan jeda 24 jam:
  1. Tanggal `16-09-2026`
  2. Jam `0–23`
  3. Menit `0–59`
- Tampilan: `Timer: ON sampai Rabu, 16 September 2026 pukul 22.00 WIB`
- Timer OFF = tanpa batas (absen tiap kali dosen buka, selama Auto ON)
- Timer habis = tidak auto absen

Chat otomatis:

- Dosen buka + akan absen → `Presensi buka: …`
- POST sukses → `Presensi otomatis tercatat` + nama MK + jam WIB
- POST gagal → `Presensi otomatis gagal`

Tidak dobel: kalau riwayat sudah punya `key` sesi itu, skip.

## Error

Gagal ETHOL/Telegram dikirim ke chat (401 session mati tidak di-spam tiap 5 menit) + log `.ethol.log` di VPS.

## Env

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Token jangan di git, chat, atau screenshot.
