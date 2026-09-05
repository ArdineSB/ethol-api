# Stitch prompt — ethol-manager

Copy everything under PASTE into Google Stitch.

---

## PASTE

Design a **desktop dashboard** web app called **ethol-manager** for PENS students. Widescreen (1440×900), not mobile, not a phone mockup, not a bottom-tab app. It is a cleaner desktop dashboard on top of campus ETHOL data. Indonesian UI. Not a clone of ethol.pens.ac.id. Not a new LMS.

Layout: persistent left sidebar (app name, nav, avatar at bottom). Main canvas with top bar (page title + bell badge). Content in a wide grid, max ~1200px inside the canvas. Desktop mouse/hover, tables and cards — not stacked mobile lists as the primary pattern.

Product: one student, already connected. Dark theme, charcoal/navy surfaces, one accent color (muted teal). Dense but breathable. Large numbers, short labels. No purple SaaS, no Inter-everywhere generic startup look. Distinctive display type for titles (Instrument Serif or Newsreader) and a tight sans for data (IBM Plex Sans).

Do **not** include: mark-as-read on notifications, payment, social feed, onboarding carousel, AI chatbot, bottom navigation, hamburger-only mobile chrome.

Data examples (real shape):
- Unread bell: 6
- 11 courses this semester (Ganjil 2026/2027)
- Sample courses: Workshop Sistem Informasi Geografis (Weny Mistarika Rahmawati), Praktikum Basis Data Lanjut (Selvia Ferdiana Kusuma), Statistika dan Probabilitas (Alfi Fadliana), Metodologi Agile, Konsep Jaringan, Pemrograman Berorientasi Obyek
- 1 assignment not submitted
- Attendance history exists. Presensi on campus is often disabled until lecturer opens it — show status “Tertutup” or “Dosen baru buka”.

Screens (generate all as desktop frames):

1) **Beranda**
Sidebar: Beranda, Kuliah, Tugas, Notifikasi, Profil.
Top bar: “Beranda”, bell badge 6, avatar A.
Welcome row: hari/tanggal + nama mahasiswa.
Four stat cards in a row: 6 Notifikasi, 11 Matakuliah, 1 Tugas belum, kehadiran %.
If attendance open: banner “Presensi dibuka — Workshop SIG”.
Below: two columns — jadwal minggu ini (table: hari, jam, ruang, matakuliah) and tugas terdekat.

2) **Kuliah**
Search + table or card grid of 11 courses: name, lecturer, class code (3 STr IT D). Click row → detail.

3) **Detail kuliah**
Title, lecturer, schedule, room in a header card.
Riwayat presensi as a desktop table (date, status hadir).
Status sesi: badge Tertutup (gray) or Terbuka (teal).
Side panel or tabs: Materi, Tugas.

4) **Tugas**
Filters: Semua / Belum / Selesai.
Desktop table or wide cards: course, title, deadline (“sisa 1 hari”), status.

5) **Notifikasi**
Filter chips: Semua, Tugas, Presensi, Materi, Pengumuman.
Wide list: type (PENGINGAT TUGAS / TUGAS BARU), snippet, time. Unread = left teal bar. Click does not mark read. No “tandai semua dibaca”.

6) **Profil**
Nama, NRP placeholder, semester Ganjil 2026/2027.
Telegram: “Terhubung @etholnotificationbot”.
Logout. Footer: unofficial · read-only.

Tone: calm, sharp, student desktop tool — not playful, not corporate, not a mobile app.

---

End PASTE
