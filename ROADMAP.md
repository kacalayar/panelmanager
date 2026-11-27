# Roadmap PanelManager

Rencana pengembangan fitur dan penyempurnaan **PanelManager** untuk rilis mendatang.

## v0.3.0 — Scheduled Backups UI, Panel HTTPS & Multi-User Dasar
- **UI Jadwal Backup Cron:** Antarmuka di tab *Backups* service untuk membuat, mengaktifkan/menonaktifkan, dan menghapus jadwal backup otomatis (menghubungkan endpoint `/api/backups/schedules` yang sudah ada).
- **Routing Domain Panel (HTTPS):** Mengaktifkan Traefik routing & Auto-SSL langsung untuk dashboard PanelManager itu sendiri (menggantikan akses port `:3000/:3001` terbuka).
- **WebSocket Proxy Satu Origin:** Mem-proxy `/ws/*` melalui server web/reverse-proxy agar koneksi Web Terminal dan live build log tidak bergantung pada port `3001` terbuka di firewall.
- **Pembersihan Sesi Kedaluwarsa:** Jadwal cleanup otomatis untuk baris `sessions` yang sudah lewat masa berlaku di SQLite.

## v0.4.0 — Terminal Lengkap, Multi-Node Swarm & Observabilitas
- **Sinkronisasi Ukuran Web Terminal:** Mengirim event resize dari `xterm.js` ke `exec.resize({ h, w })` pada container PTY.
- **Dukungan Multi-Node Swarm:** Penanganan task/container yang berjalan di worker node jarak jauh (stats, logs, exec, dan backup) serta manajemen node Swarm dari UI.
- **Manajemen Registry & Git Token Terenkripsi:** Penyimpanan kredensial Docker Registry privat dan enkripsi khusus untuk `gitToken` terpisah dari `sourceConfigJson`.
- **RBAC & Audit Log:** Penambahan akun `admin`/`member` oleh `owner` beserta log aktivitas deploy, scale, dan restore.

## v0.5.0 — Ekosistem Build & Otomasi
- **Preview Deployments & Rollback 1-Klik:** Rollback langsung ke `imageTag` deployment sebelumnya dari tab *Deploy & Logs*.
- **Healthcheck & Zero-Downtime Rollout:** Konfigurasi `HEALTHCHECK` per service dari UI dan verifikasi kesiapan container sebelum Traefik mengalihkan trafik.
- **Upgrade Major Framework:** Evaluasi migrasi ke Next.js 16, Zod 4, TypeScript 7, dan Vitest 5 setelah ekosistem stabil.
