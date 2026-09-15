# ethol bot (Telegram)

Satu bot, satu proses `ethol.ts serve`. Bukan bot per orang.

Perintah: `/menu` `/tugas` `/materi` `/jadwal` `/presensi` `/login` `/logout`

Keyboard: **Tugas** · **Materi** · **Jadwal** · **Presensi**

## Akun

- Owner (`TELEGRAM_CHAT_ID`) → `.cookie`
- Temen → `sessions/<chat_id>.cookie` lewat `/login` sendiri
- Satu VNC dalam satu waktu. Chat lain: “sedang dipakai orang lain”
- Jangan kirim password / share cookie

## /login (semua)

Kalau session hidup: `Terhubung: <nama>` + **Login ulang**.

Kalau belum / mati:

1. Browser ETHOL di VPS + noVNC
2. Link `https://login.ardeen.fun/v/<kunci>/…` + **Done**
3. Login CAS **akun sendiri**
4. Done → cookie ke file chat itu
5. Done tanpa login CAS → sesi dimatikan (error), antrian bebas
6. Timeout 12 menit

`/logout` hapus cookie chat itu (bukan punya orang lain). Kalau VNC login miliknya masih nyala, ikut dimatikan. Presensi config tidak dihapus.

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
