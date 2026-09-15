# PRD: ethol-api

Status: v1 draft from owner decisions 2026-09-05. Stack: TypeScript. Host: VPS 24h.

Bukan LMS baru. Unofficial read-layer di atas ETHOL PENS.

## Problem

Data kuliah (lonceng, tugas, jadwal, materi) hanya enak dilihat kalau buka `ethol.pens.ac.id`. Mau satu API di VPS supaya ethol-manager dan Telegram bisa baca **per akun**, tanpa mark-read di kampus.

## Users

- Owner (mahasiswa) — akun sendiri.
- Teman — akun ETHOL sendiri, terutama track tugas.

Bukan ganti password kampus. Bukan share satu session.

## Goals v1

1. Satu proses TypeScript di VPS.
2. Banyak akun: `account → session ETHOL` terpisah.
3. HTTP API on-demand untuk ethol-manager.
4. Poller background untuk Telegram (satu bot, banyak user).
5. Tidak pernah mark-read.

## Non-goals

- Scrape DOM kalau REST cukup.
- n8n.
- Bot Telegram per orang.
- Push realtime dari kampus (tidak ada).

Boleh: alert “presensi dosen baru dibuka” dan auto-klik Presensi (`POST /presensi/mahasiswa`) saat `open === 1`.

## Diagnosis

| | |
|---|---|
| Data | ETHOL sudah REST (`https://ethol.pens.ac.id/api`). |
| Perilaku | Orang tidak buka web → lonceng/tugas terlewat. |
| Absen lupa | Alert saat presensi buka + auto-klik `POST /presensi/mahasiswa` saat `open === 1`. |

Recon 2026-09-05: SPA React, cookie `withCredentials`, CAS SSO. Lonceng: GET list + unread count. Klik item = PUT baca. Tidak ada websocket/FCM.

## Architecture

```
[SSO ETHOL] → session per akun di VPS
                    │
              ethol-api (TS)
                 /        \
        HTTP on-demand    poller interval
         ethol-manager     Telegram (1 bot)
```

Satu satpam, banyak kartu (cookie). Bukan Chrome per user.

Berat yang salah: headless browser 24 jam × N.  
Yang benar: GET JSON × N akun.

## Data v1 (kita expose)

Bentuk JSON **kita**, bukan mirror mentah ETHOL. Field ETHOL di-map.

| Resource | Baca | Tulis ke ETHOL |
|---|---|---|
| `/v1/me` | profil, role | tidak |
| `/v1/notifications` | list + badge, filter tipe | tidak (no mark-read) |
| `/v1/courses` | matakuliah semester | tidak |
| `/v1/schedule` | jadwal online | tidak |
| `/v1/assignments` | tugas | tidak |
| `/v1/materials` | materi | tidak |
| `/v1/attendance/history` | riwayat | tidak |
| `/v1/attendance/open` | apakah presensi kuliah sedang buka | — |
| `/v1/attendance/checkin` | klik Presensi mahasiswa | `POST /presensi/mahasiswa` saat `open === 1` |

Upstream (kampus), mahasiswa — mapped 2026-09-05 from SPA bundle (see `recon-ethol.md`):

| Kita | ETHOL (read) |
|---|---|
| `/v1/me` | session + `GET /auth/config` (`tahun_aktif`, `semester_aktif`) |
| `/v1/notifications` | `GET /notifikasi/mahasiswa`, `GET /notifikasi/mahasiswa-belum-baca` |
| `/v1/courses` | `GET /kuliah?tahun&semester` |
| `/v1/schedule` | `GET /jadwal/jadwal-online?tahun&semester` |
| `/v1/assignments` | `GET /tugas?kuliah&jenisSchema` (+ optional `POST /tugas/tugas-terakhir-mahasiswa` for beranda) |
| `/v1/materials` | `GET /materi?matakuliah&jenis_schema` |
| `/v1/attendance/history` | `GET /presensi/riwayat?kuliah&jenis_schema&nomor` |
| `/v1/attendance/open` | `GET /presensi/aktif-kuliah` — treat `open === 1` as buka |
| `/v1/attendance/checkin` | `POST /presensi/mahasiswa` saat `open === 1` |

Jangan panggil: `PUT /notifikasi/mahasiswa-baca-notif`, `POST|PUT /tugas/submit`, dosen `POST /presensi/buka` / `PUT /presensi/tutup` / `PUT /presensi/batalkan`. Auto-presensi mahasiswa: `POST /presensi/mahasiswa` saat `open === 1`.

## Auth

1. **Manager account** — login ke app kita (teman ≠ cookie ETHOL).
2. **Connect ETHOL** — session kampus harus mendarat di VPS. CAS tidak OAuth ke domain kita. Flow konkret **masih open**.
3. **Telegram** — satu bot; `/start` + tautkan ke manager account.

Jangan simpan password kampus di chat/log. Cookie/session = secret.

## Consumers (bukan v1 wajib selesai bareng)

- **ethol-manager** — satu web, on-demand.
- **Telegram** — background poll, notif delta (tugas baru, reminder, presensi buka).

## Open

- Interval poll Telegram.
- Flow hubungkan ETHOL → session VPS.
- Store (SQLite vs Postgres).
- Payload JSON live (butuh session cookie; belum di-hit dari sini).

## Risks

- Unofficial; ETHOL bisa ganti API/CAS.
- Rate-limit kampus.
- Cookie expire → user connect ulang.
- Session di VPS = akses penuh akun kampus itu: treat as secret.

## Success

Owner + 1 teman: connect ETHOL, `GET` tugas/jadwal/notif tanpa badge kampus berubah, Telegram dapat delta tanpa mark-read.
