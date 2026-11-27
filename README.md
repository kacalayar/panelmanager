# PanelManager

[![CI](https://github.com/kacalayar/panelmanager/actions/workflows/ci.yml/badge.svg)](https://github.com/kacalayar/panelmanager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![Docker Swarm](https://img.shields.io/badge/Orchestrator-Docker%20Swarm-2496ED.svg)](https://docs.docker.com/engine/swarm/)

Panel kontrol server & PaaS *self-hosted* berbasis **Docker Swarm + Traefik + Nixpacks/Dockerfile**, terinspirasi oleh Easypanel tanpa batasan jumlah proyek, domain, backup, ataupun fitur monitoring.

---

## Fitur Utama

- **Docker Swarm & Traefik Auto-SSL:** Inisialisasi Swarm otomatis, overlay network terisolasi per project (`proj-<slug>`), custom domain routing, dan sertifikat HTTPS Let's Encrypt otomatis.
- **App Deployment:** Deploy dari Docker Image, Git + `Dockerfile`, atau Git + **Nixpacks** (auto-detect Node.js, Python, Go, PHP, dll.), lengkap dengan Git Webhook auto-deploy & live build logs via WebSocket.
- **Managed Databases:** Provisioning 1-klik **PostgreSQL 16**, **MySQL 8.4**, **MariaDB 11**, **MongoDB 7**, dan **Redis 7** dengan password acak, volume persisten, dan env terenkripsi `AES-256-GCM`.
- **1-Click App Templates:** Katalog awal siap pakai untuk **n8n**, **WordPress**, **PocketBase**, **Uptime Kuma**, **MinIO S3**, **Ghost Blog**, **Umami Analytics**, dan **Adminer**.
- **Automated Backups & Restore:** Jadwal backup cron (`croner`) untuk database & volume ke **Cloudflare R2**, **Amazon S3**, **MinIO**, atau penyimpanan lokal, lengkap dengan retensi otomatis dan 1-klik restore.
- **Web Terminal & Monitoring:** Terminal interaktif di browser (`xterm.js` via `docker exec`) serta statistik CPU, RAM, dan jaringan host maupun container.
- **Notifikasi & Ekspor IaC:** Alert deploy/backup ke Discord, Telegram, atau Webhook, serta ekspor konfigurasi project menjadi `docker-compose.yml` standar.

---

## Requirements (Persyaratan Sistem)

### 1. Server Produksi (VPS Linux)
- **OS:** Linux 64-bit (`Ubuntu 22.04 / 24.04`, `Debian 12`, atau distro berbasis `RHEL / Rocky / Alma / CentOS`).
- **Hak Akses:** `root` atau user dengan akses `sudo`.
- **Spesifikasi Minimum:**
  - **CPU:** 1 vCPU (disarankan 2+ vCPU untuk build aplikasi).
  - **RAM:** 1 GB minimum (disarankan 2+ GB RAM jika menjalankan build Nixpacks/Docker dan beberapa database).
  - **Disk:** 15 GB ruang kosong (untuk Docker images, build cache, dan volumes).
- **Dependency di VPS:** `install.sh` otomatis memasang `curl`, `git`, `openssl`, `ca-certificates`, dan **Docker Engine + Docker Compose v2** jika belum tersedia. Di dalam container PanelManager sudah terpaket `Node.js 22`, `docker.io` CLI, `git`, dan `nixpacks`.
- **Port Firewall yang Dibutuhkan:**
  | Port | Protokol | Fungsi |
  | :--- | :--- | :--- |
  | `80` | TCP | HTTP traffic & validasi HTTP-01 Let's Encrypt (Traefik) |
  | `443` | TCP | HTTPS traffic aplikasi (Traefik) |
  | `3000` | TCP | Dashboard Web UI PanelManager |
  | `3001` | TCP | Control Plane API & WebSocket (Live Logs & Web Terminal) |
  | `2377`, `7946`, `4789` | TCP/UDP | *Opsional* — hanya diperlukan jika menambah worker node Docker Swarm multi-server |

### 2. Pengembangan Lokal (Development)
- **Node.js:** `>= 22.0.0` (menggunakan modul bawaan `node:sqlite`, tanpa compiler C++ native).
- **Package Manager:** `pnpm` (teruji dengan `pnpm 12.21.0`).
- **Git CLI** untuk manajemen source dan clone repository.
- **Docker Engine / Docker Desktop** (atau akses SSH ke Docker VPS melalui `DOCKER_HOST=ssh://root@ip-vps-anda`).

---

## Instalasi Cepat di VPS Linux

Script [`install.sh`](install.sh) akan otomatis:
1. Memasang dependensi dasar dan membuat **Swapfile otomatis sesuai RAM VPS** (jika belum ada swap aktif).
2. Memasang **Docker Engine + Compose v2** (jika belum terpasang).
3. Menginisialisasi **Docker Swarm** (`docker swarm init`) dan membuat overlay network `panel-net`.
4. Membuat file `.env` dengan `PANEL_SECRET` acak (`openssl rand -hex 32`).
5. Membangun dan menjalankan container `panelmanager` lalu memverifikasi `/health`.

> **Aturan Ukuran Auto-Swap (`setup_swap`):**
> - RAM ≤ 2 GB → Swap `2× RAM` (minimal 1 GB)
> - RAM 2–8 GB → Swap `1× RAM`
> - RAM > 8 GB → Swap `4 GB` (disesuaikan otomatis agar selalu menyisakan minimal 2 GB ruang disk bebas, dengan `vm.swappiness=10`).

### Opsi A — Satu baris via `curl` (Direkomendasikan)

```bash
curl -fsSL https://raw.githubusercontent.com/kacalayar/panelmanager/main/install.sh | sudo bash
```

### Opsi B — Clone lalu jalankan installer

```bash
git clone https://github.com/kacalayar/panelmanager.git
cd panelmanager
sudo bash install.sh
```

### Variabel Opsional `install.sh`

| Variabel | Default | Keterangan |
| :--- | :--- | :--- |
| `PANEL_DIR` | `/opt/panelmanager` | Direktori instalasi saat dijalankan via `curl` |
| `PANEL_REPO_URL` | `https://github.com/kacalayar/panelmanager.git` | URL Git repository PanelManager |
| `PANEL_BRANCH` | `main` | Branch Git yang di-clone / di-pull |
| `PANEL_PORT` | `3000` | Port Dashboard Web UI |
| `PANEL_PUBLIC_URL` | `http://<server-ip>:3000` | URL publik panel untuk webhook auto-deploy |
| `ADVERTISE_ADDR` | *(deteksi IP otomatis)* | Alamat IP VPS untuk `docker swarm init --advertise-addr` |
| `AUTO_SWAP` | `true` | Set `false` untuk melewati pembuatan swapfile otomatis |

### Deploy Manual via Docker Compose

Jika Docker dan Docker Swarm sudah siap di server:

```bash
cp .env.example .env
# Edit .env dan isi PANEL_SECRET minimal 32 karakter acak
docker compose -f docker/docker-compose.yml up -d --build
```

---

## Langkah Setup Pertama Setelah Instalasi

1. Buka browser ke `http://<IP-VPS>:3000` dan buat akun **Owner** pertama.
2. Pastikan **Docker Swarm** berstatus `Active` di Dashboard (atau klik **Init Swarm** jika belum aktif).
3. Buka menu **Cluster, Backup & Alerts** (`/settings`):
   - Isi email **Let's Encrypt** lalu klik **Sync Traefik Swarm** untuk menjalankan reverse proxy `panel-traefik` pada port `80` dan `443`.
   - *(Opsional)* Tambahkan tujuan backup (**Cloudflare R2 / Amazon S3 / MinIO / Local**) dan channel notifikasi (**Discord / Telegram / Webhook**).
4. Arahkan DNS **A Record** domain aplikasi Anda ke IP publik VPS, lalu tambahkan domain tersebut pada tab **Domains** di service terkait.

---

## Konfigurasi Environment (`.env`)

Lihat contoh lengkap pada [`.env.example`](.env.example):

| Variabel | Default | Deskripsi |
| :--- | :--- | :--- |
| `PORT` | `3001` | Port Control Plane API & WebSocket server |
| `WEB_PORT` | `3000` | Port Next.js Dashboard UI |
| `DATA_DIR` | `./data` (`/data` di Docker) | Direktori penyimpanan `panel.db`, build cache, dan backup lokal |
| `PANEL_SECRET` | *(auto-generate di `/data/.panel_secret`)* | Kunci untuk enkripsi AES-256-GCM env vars & kredensial (min. 16 karakter) |
| `PANEL_PUBLIC_URL` | `http://localhost:3000` | Base URL publik untuk generate Webhook URL auto-deploy |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Endpoint API/WebSocket yang diakses browser |
| `INTERNAL_API_URL` | `http://127.0.0.1:3001` | Endpoint internal untuk rewrite `/api/*` di Next.js |
| `DOCKER_HOST` | *(socket lokal)* | Opsional, misal `ssh://root@ip-vps` untuk mengelola Docker remote |

---

## Struktur Proyek

```text
panelmanager/
├── install.sh                 # Script installer otomatis VPS Linux
├── docker/
│   ├── Dockerfile             # Image produksi (Node 22 + Docker CLI + Git + Nixpacks)
│   ├── docker-compose.yml     # Konfigurasi compose untuk VPS
│   └── start.sh               # Entrypoint menjalankan server API + web UI
├── packages/
│   ├── db/                    # Skema SQLite (Drizzle ORM) + enkripsi AES-256-GCM
│   ├── docker/                # Wrapper Docker Swarm, Traefik v3 labels, stats, exec, export compose
│   └── templates/             # Engine & katalog 1-Click App Templates
└── apps/
    ├── server/                # Hono Control Plane API, WebSocket, Builder, Backup Scheduler
    └── web/                   # Next.js App Router Dashboard + xterm.js Web Terminal
```

---

## Pengembangan Lokal & Pengujian

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

- Dashboard Web UI: `http://localhost:3000`
- Control Plane API: `http://localhost:3001`

> **Catatan Windows:** Jika WSL2/Docker Desktop tidak aktif di Windows, Anda tetap bisa menjalankan dashboard & API secara lokal dan mengarahkan `DOCKER_HOST=ssh://root@ip-vps-anda` ke VPS Linux untuk menguji orkestrasi Docker Swarm nyata.

---

## Operasional & Troubleshooting

- **Melihat log container:** `docker logs -f panelmanager`
- **Restart panel:** `docker compose --env-file .env -f docker/docker-compose.yml restart`
- **Update ke versi terbaru:** `git pull && sudo bash install.sh`
- **Lokasi data persisten:** Volume Docker `panel-data` (dipetakan ke `/data` berisi `panel.db` dan `.panel_secret`) serta `panel-traefik-acme` (sertifikat Let's Encrypt).

---

## Kontribusi, Keamanan & Lisensi

- **Kontribusi:** Baca panduan kontribusi di [CONTRIBUTING.md](CONTRIBUTING.md).
- **Laporan Celah Keamanan:** Baca kebijakan pelaporan kerentanan di [SECURITY.md](SECURITY.md) (mohon jangan membuka issue publik untuk celah keamanan).
- **Lisensi:** Dirilis di bawah lisensi [MIT](LICENSE) — © 2026 [kacalayar](https://github.com/kacalayar).
