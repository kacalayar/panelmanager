# Changelog

Semua perubahan penting pada **PanelManager** dicatat di file ini.
Format mengacu pada [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-27

### Added
- **Docker Swarm Network Alias:** `SwarmClient.upsertService` kini mendaftarkan `Aliases: [serviceSlug]` pada overlay network project agar template database (`n8n-db`, `wp-db`, `ghost-db`, `umami-db`) dan `connectionUrl` ter-resolve otomatis.
- **CI End-to-End Docker & Swarm:** Workflow GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) kini menjalankan job `docker-e2e` pada `ubuntu-latest` untuk menguji `docker swarm init`, build image produksi, `/health`, rewrite `/api/auth/status`, dan aset statis Next.js.
- **Streaming Backup & Restore:** `SwarmClient.execToStream` dan `execFromStream` mengalirkan dump langsung via file temporer/stream tanpa menumpuk seluruh payload di RAM.
- **Cakupan Pengujian Baru:** Pengujian tambahan untuk CORS subdomain, invalid JSON, proteksi setup ganda, delete domain lintas service, validasi cron, redaksi token Git, `scaleService`, streaming backup command, `stripDockerStreamHeaders`, dan origin WebSocket.
- **Dokumentasi:** Penambahan `CHANGELOG.md` dan `ROADMAP.md`.

### Changed
- **Scale Tanpa Rebuild:** `POST /api/services/:id/scale` kini memperbarui jumlah replika di Swarm langsung memakai `imageTag` terakhir tanpa meng-clone ulang repo Git atau build ulang image.
- **Backup & Restore via Env:** Kredensial database pada `getBackupCommand` dan `getRestoreCommand` diteruskan lewat `Env` container (bukan interpolasi string `sh -c`).
- **Build & Log Deployment:** Build berjalan berurutan per service pada folder terpisah `builds/<serviceId>/<deployId>`, penulisan log ke SQLite di-buffer per 1 detik (`O(n)`), dan `export-compose` menggunakan `imageTag` deployment terbaru.
- **Upgrade Dependensi & GitHub Actions:** Memperbarui `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` (menghilangkan peringatan Node.js 20 & `DEP0040` pada runner), serta memperbarui `dockerode@^5.0.1` (menghilangkan subdependensi deprecated `uuid@10.0.0`), `@hono/node-server@^2.1.11`, `croner@^11.0.1`, `@xterm/addon-fit@^0.11.0`, dan `lucide-react@^1.81.0`.

### Fixed
- **Produksi Docker Next.js Standalone:** Menyalin `.next/static` ke `.next/standalone/apps/web/.next/static` di `docker/Dockerfile` dan meneruskan `NEXT_PUBLIC_API_URL` sebagai `ARG`/`build.args`.
- **Autentikasi Redis:** Managed Redis kini dijalankan dengan `--requirepass "$REDIS_PASSWORD"`.
- **Keamanan CORS & WebSocket:** Membatasi CORS dan WebSocket `Origin` hanya ke `PANEL_PUBLIC_URL`, `localhost:3000`, atau hostname yang sama persis.
- **Keamanan & Stabilitas Lainnya:** Validasi ekspresi cron sebelum simpan jadwal backup, `try/catch` di `BackupScheduler.reload()`, pengecekan `ExitCode` saat restore, pembacaan JSON sebelum cek `/setup`, koreksi stats memori cgroup v2 (`inactive_file`), perbaikan `stripDockerStreamHeaders` untuk log pendek, sensor token Git di log build, serta perbaikan state & error handling pada UI Next.js.

## [0.1.0] - 2026-11-27

### Added
- Rilis awal PanelManager: Control Plane Hono API, SQLite + Drizzle ORM dengan enkripsi `AES-256-GCM`, orkestrasi Docker Swarm + Traefik v3 Auto-SSL, builder Git/Dockerfile/Nixpacks, 5 managed database presets, 8 template 1-klik, backup S3/R2/MinIO/Local + restore, notifikasi Discord/Telegram/Webhook, Web Terminal `xterm.js`, serta installer VPS `install.sh`.
