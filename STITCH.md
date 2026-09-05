# Stitch prompt — ethol-manager

Copy everything under PASTE into Google Stitch.

---

## PASTE

Design a mobile-first web app called **ethol-manager** for PENS students. It is a cleaner dashboard on top of campus ETHOL data. Indonesian UI. Not a clone of ethol.pens.ac.id. Not a new LMS.

Product: one student, already connected. Show live-looking academic data. Dark theme, charcoal/navy surfaces, one accent color (muted teal, like a night campus dashboard). Dense but breathable. Large numbers, short labels. No purple SaaS, no Inter-everywhere generic startup look. Use a distinctive display type for titles (something like Instrument Serif or Newsreader) and a tight sans for data (IBM Plex Sans or similar).

Do **not** include: mark-as-read on notifications, payment, social feed, onboarding carousel, AI chatbot.

Data examples (real shape):
- Unread bell: 6
- 11 courses this semester (Ganjil 2026/2027)
- Sample courses: Workshop Sistem Informasi Geografis (Weny Mistarika Rahmawati), Praktikum Basis Data Lanjut (Selvia Ferdiana Kusuma), Statistika dan Probabilitas (Alfi Fadliana), Metodologi Agile, Konsep Jaringan, Pemrograman Berorientasi Obyek
- 1 assignment not submitted
- Attendance history exists. Presensi on campus is often disabled until lecturer opens it — show status “Tertutup” or “Dosen baru buka”.

Screens (generate all):

1) **Beranda**
Top bar: app name ethol-manager, small avatar A, bell with red badge 6.
Welcome: “Sabtu, 5 September” / nama mahasiswa.
Three stat cards: 6 Notifikasi, 11 Matakuliah, 1 Tugas belum.
If any class has open attendance: a slim alert “Presensi dibuka — Workshop SIG”.
List “Hari ini / minggu ini” as course chips with day + time (e.g. Kamis 13:50–16:20 · C.106).
Bottom nav: Beranda, Kuliah, Tugas, Notifikasi, Profil.

2) **Kuliah**
Search field. List of 11 courses: name, lecturer, class code (3 STr IT D). Tap → detail.

3) **Detail kuliah**
Course title, lecturer, schedule, room.
Section Riwayat presensi (table: date, status hadir) — read only.
Section status presensi sesi ini: badge Tertutup (gray) or Terbuka (teal).
Links: Materi, Tugas (placeholders OK).

4) **Tugas**
Filters: Semua / Belum / Selesai.
Cards: course name, title, deadline relative (“sisa 1 hari”), status pill. Empty state if none.

5) **Notifikasi**
Filters chips: Semua, Tugas, Presensi, Materi, Pengumuman.
Rows: type label (PENGINGAT TUGAS / TUGAS BARU), snippet, relative time. Unread = left teal bar. Tapping does **not** mark read; it only expands or links out. No “tandai semua dibaca”.

6) **Profil**
Nama, NRP placeholder, semester Ganjil 2026/2027.
Telegram: “Terhubung @etholnotificationbot”.
Logout. Tiny footer: unofficial · read-only.

Desktop: same IA, max width ~1080, sidebar nav instead of bottom nav. Mobile first.

Tone: calm, sharp, student tool — not playful, not corporate.

---

End PASTE
