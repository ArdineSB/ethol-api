---
created: 2026-09-05
updated: 2026-09-05
status: recon
---

# ETHOL unofficial API recon (mahasiswa)

Source: logged-in UI `https://ethol.pens.ac.id/` + public SPA bundle
`https://ethol.pens.ac.id/assets/index-Bcg_2nim.js` (2026-09-05).

SPA React. Axios `baseURL` `https://ethol.pens.ac.id/api`, `withCredentials: true`.
No websocket / FCM. Poll REST.

Do **not** store passwords. Mark-read / tugas submit / dosen buka-tutup-batal: jangan. Auto-presensi mahasiswa: `POST /presensi/mahasiswa` saat `open === 1`.

## Auth

| Action | Method | Path |
|---|---|---|
| Mahasiswa/staff SSO | GET (browser) | `/auth/cas-redirect` (full: `https://ethol.pens.ac.id/api/auth/cas-redirect`) |
| Refresh | POST | `/auth/refresh` |
| Logout | POST | `/auth/logout` |
| Semester aktif (admin config; frontend also hydrates `tahun_aktif` / `semester_aktif`) | GET | `/auth/config` |

401 → refresh; failure clears `localStorage.user` and sends `/`.

Frontend routes (mahasiswa): `/mahasiswa/beranda`, `/mahasiswa/matakuliah`, `/mahasiswa/jadwal`, `/mahasiswa/tugasonline`, `/mahasiswa/semua-materi`.

Semester codes in UI: `1` Ganjil, `2` Genap, `3` Antara Ganjil, `4` Antara Genap.

## Config / identity (client stores)

Zustand persist:

- `config-store`: `tahun_aktif`, `semester_aktif`, `tahun_ajaran_aktif`, `menit_per_jam`
- `kuliah-store`: `kuliahMahasiswa`

## Matakuliah / kuliah

Same list endpoint for dosen/mahasiswa/PLP — server scopes by session.

| Action | Method | Path | Params |
|---|---|---|---|
| Daftar kuliah semester | GET | `/kuliah` | `tahun`, `semester` |
| Detail kuliah | GET | `/kuliah/by-kuliah-js` | `kuliah`, `jenisSchema` |
| Peserta | GET | `/kuliah/peserta-kuliah` | `kuliah`, `jenis_schema` |
| Hari kuliah (batch) | POST | `/kuliah/hari-kuliah-in` | body `{ kuliahs, tahun, semester }` (read helper used by jadwal UI) |

List item fields used by UI: `nomor` (id kuliah), `jenisSchema`, `matakuliah.nama`, `kelas`, `pararel`, `isKuliahGabungan`.

## Jadwal online

| Action | Method | Path | Params |
|---|---|---|---|
| Jadwal online | GET | `/jadwal/jadwal-online` | `tahun`, `semester` |

UI dedupes on `matakuliah|nomor_hari|kode_kelas|pararel`.

## Tugas

| Action | Method | Path | Params / body |
|---|---|---|---|
| List tugas kuliah | GET | `/tugas` | `kuliah`, `jenisSchema` |
| Tugas terakhir (beranda) | POST | `/tugas/tugas-terakhir-mahasiswa` | `{ kuliahs }` |
| Pekerjaan (dosen melihat pengumpulan) | GET | `/tugas/pekerjaan-mahasiswa` | `id_tugas` |
| Submit jawaban | POST | `/tugas/submit` | FormData — **write, not ethol-api** |
| Update jawaban | PUT | `/tugas/submit` | **write, not ethol-api** |

`getMahasiswa` = same GET `/tugas` as dosen.

## Materi / video / pengumuman (per kuliah)

| Action | Method | Path | Params |
|---|---|---|---|
| Materi | GET | `/materi` | `matakuliah`, `jenis_schema` |
| Video | GET | `/video` | `kuliah`, `jenis_schema` |
| Pengumuman kuliah | GET | `/pengumuman` | `kuliah`, `jenis_schema` |
| Katalog materi lintas (semua-materi) | GET | `/materi/daftar` | `program`, `jurusan` |

Materi item fields in UI: `id`, `title`, `created_indonesia`, `path`, `tipe` (`2` = link), `grup_materi`.

Dashboard banner **Pengumuman N aktif** is this pengumuman surface, **not** the bell.

## Presensi (read vs write)

Read (ethol-api **may**):

| Action | Method | Path | Params |
|---|---|---|---|
| Riwayat saya | GET | `/presensi/riwayat` | `kuliah`, `jenis_schema`, `nomor` (mahasiswa) |
| Sesi aktif kuliah | GET | `/presensi/aktif-kuliah` | `kuliah`, `jenis_schema` |
| Presensi terakhir kuliah | GET | `/presensi/terakhir-kuliah` | `kuliah`, `jenis_schema` |

UI: `aktifKuliah` rows with `open === 1` enable the Presensi button; otherwise it stays disabled. `key` on an open session is used by other official calls.

Write (bundle `index-Bcg_2nim.js`, 2026-09-05 — **not live-POSTed**):

`mahasiswaPresensi: e => POST /presensi/mahasiswa` body:

```
{ kuliah, jenis_schema, mahasiswa, key, kuliah_asal }
```

- `kuliah` + `jenis_schema`: id matakuliah halaman itu
- `mahasiswa`: `user.nomor` di session
- `key`: row `aktifKuliah` yang `open === 1`
- `kuliah_asal`: dari detail kuliah, atau `null`
- sudah hadir: riwayat punya `key` yang sama → tombol resmi tidak nge-POST lagi
- sukses: `{ sukses, pesan }`

Kuliah page: `key: sesi.key`. Ujian page: `key` langsung (beda shape). Auto-presensi kuliah pakai yang pertama.

| Action | Method | Path | ethol-api |
|---|---|---|---|
| Mahasiswa klik Presensi | POST | `/presensi/mahasiswa` | boleh saat `open === 1` + body di atas |
| Dosen buka/tutup/batal | POST / PUT | `/presensi/buka`, `/presensi/tutup`, `/presensi/batalkan` | jangan |

## Notifikasi (lonceng)

| Action | Method | Path |
|---|---|---|
| Unread badge | GET | `/notifikasi/mahasiswa-belum-baca` → `{ jumlah }` |
| List | GET | `/notifikasi/mahasiswa?filterNotif=` |
| Mark read | PUT | `/notifikasi/mahasiswa-baca-notif` `{ idNotifikasi }` — **do not call** |

`filterNotif`: `SEMUA | MATERI | PRESENSI | TUGAS | VIDEO | KUIS | PENGUMUMAN | FORUM`

Item fields: `idNotifikasi`, `status` (`"1"` unread, `"2"` read), `kodeNotifikasi`, `keterangan`, `waktuNotifikasi`, `urlWeb`.

Clicking a row in the official UI marks it read. Capture must not.

## Live UI 2026-09-05

- Mahasiswa: Ardine Syuhada Bimasakti. Bell badge **6**.
- Overlay: PENGINGAT TUGAS, TUGAS BARU (AX tree lied “Tidak ada notifikasi”).
- Workshop SIG (`/mahasiswa/matakuliah/220815`): Presensi + Conference ETHOL disabled. History Presensi Saya: 2 rows. Dosen last presence 3 Sep 2026.

## Not for ethol-api

Kuis/ujian submit, forum write, video/materi upload, dosen presensi buka/tutup/batal, tugas submit, mark-read.
