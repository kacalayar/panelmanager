#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# PanelManager — 1-Line VPS Installer (Docker + Docker Swarm + PanelManager)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kacalayar/panelmanager/main/install.sh | sudo bash
#   # Atau dari folder repo:
#   sudo bash install.sh
#
# Optional Environment Variables:
#   PANEL_DIR=/opt/panelmanager
#   PANEL_REPO_URL=https://github.com/kacalayar/panelmanager.git
#   PANEL_BRANCH=main
#   PANEL_PUBLIC_URL=http://<server-ip>:3000
#   ADVERTISE_ADDR=<server-ip>
# ==============================================================================

PANEL_DIR="${PANEL_DIR:-/opt/panelmanager}"
PANEL_REPO_URL="${PANEL_REPO_URL:-https://github.com/kacalayar/panelmanager.git}"
PANEL_BRANCH="${PANEL_BRANCH:-main}"
PANEL_PORT="${PANEL_PORT:-3000}"
AUTO_SWAP="${AUTO_SWAP:-true}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

if [[ "$(uname -s)" != "Linux" ]]; then
  log_err "Installer ini ditujukan untuk server Linux (Ubuntu/Debian/RHEL/CentOS)."
  exit 1
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  log_err "Jalankan script ini sebagai root atau gunakan: sudo bash install.sh"
  exit 1
fi

detect_server_ip() {
  local ip=""
  if command -v curl >/dev/null 2>&1; then
    ip="$(curl -4 -fsSL --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git openssl >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q ca-certificates curl git openssl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q ca-certificates curl git openssl
  fi
}

setup_swap() {
  if [[ "$AUTO_SWAP" != "true" ]]; then
    log_info "AUTO_SWAP=false — melewati pembuatan swap."
    return
  fi

  local active_swap
  active_swap="$(swapon --show --noheadings 2>/dev/null || true)"
  if [[ -n "$active_swap" ]]; then
    log_ok "Swap sudah aktif di server — melewati pembuatan swapfile."
    return
  fi

  local ram_mb
  ram_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  if [[ "$ram_mb" -le 0 ]]; then
    log_warn "Gagal membaca total RAM dari /proc/meminfo — melewati pembuatan swap."
    return
  fi

  # Hitung ukuran swap ideal berdasarkan RAM VPS:
  # - RAM <= 2 GB  -> 2x RAM (min 1024 MB)
  # - RAM 2-8 GB   -> 1x RAM
  # - RAM > 8 GB   -> 4096 MB
  local swap_mb
  if [[ "$ram_mb" -le 2048 ]]; then
    swap_mb=$(( ram_mb * 2 ))
    if [[ "$swap_mb" -lt 1024 ]]; then
      swap_mb=1024
    fi
  elif [[ "$ram_mb" -le 8192 ]]; then
    swap_mb="$ram_mb"
  else
    swap_mb=4096
  fi

  # Pastikan ruang disk mencukupi (sisakan minimal 2 GB ruang bebas)
  local free_disk_mb
  free_disk_mb="$(df -Pm / | awk 'NR==2 {print $4}' 2>/dev/null || echo 0)"
  local max_safe_swap=$(( free_disk_mb - 2048 ))
  if [[ "$max_safe_swap" -lt 512 ]]; then
    log_warn "Ruang disk tersisa (${free_disk_mb} MB) terlalu kecil untuk membuat swapfile. Melewati swap."
    return
  fi
  if [[ "$swap_mb" -gt "$max_safe_swap" ]]; then
    swap_mb="$max_safe_swap"
  fi

  local swap_file="/swapfile"
  if [[ -f "$swap_file" ]]; then
    swapoff "$swap_file" >/dev/null 2>&1 || true
    rm -f "$swap_file"
  fi

  log_info "RAM terdeteksi ${ram_mb} MB — membuat swap ${swap_mb} MB di ${swap_file}..."
  if ! fallocate -l "${swap_mb}M" "$swap_file" 2>/dev/null; then
    dd if=/dev/zero of="$swap_file" bs=1M count="$swap_mb" status=none
  fi
  chmod 600 "$swap_file"
  mkswap "$swap_file" >/dev/null

  if ! swapon "$swap_file" 2>/dev/null; then
    # Fallback ke dd jika filesystem menolak fallocate swapfile (mis. XFS tertentu)
    rm -f "$swap_file"
    dd if=/dev/zero of="$swap_file" bs=1M count="$swap_mb" status=none
    chmod 600 "$swap_file"
    mkswap "$swap_file" >/dev/null
    if ! swapon "$swap_file" 2>/dev/null; then
      log_warn "Kernel/container VPS tidak mengizinkan swapon (umum pada OpenVZ/LXC). Melewati swap."
      rm -f "$swap_file"
      return
    fi
  fi

  if ! grep -qE "^${swap_file}[[:space:]]" /etc/fstab 2>/dev/null; then
    echo "${swap_file} none swap sw 0 0" >> /etc/fstab
  fi

  mkdir -p /etc/sysctl.d
  echo "vm.swappiness=10" > /etc/sysctl.d/99-panelmanager-swap.conf
  sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true

  log_ok "Swap ${swap_mb} MB aktif dan permanen (vm.swappiness=10)."
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_ok "Docker sudah terpasang: $(docker --version)"
  else
    log_info "Memasang Docker Engine..."
    curl -fsSL https://get.docker.com | sh
    log_ok "Docker berhasil dipasang."
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log_err "Docker Compose v2 plugin tidak ditemukan. Pastikan Docker Engine terbaru terpasang."
    exit 1
  fi
}

init_swarm_and_network() {
  local swarm_state
  swarm_state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")"

  if [[ "$swarm_state" != "active" ]]; then
    local adv_addr="${ADVERTISE_ADDR:-$(detect_server_ip)}"
    log_info "Menginisialisasi Docker Swarm (advertise-addr: ${adv_addr})..."
    docker swarm init --advertise-addr "$adv_addr" >/dev/null
    log_ok "Docker Swarm aktif."
  else
    log_ok "Docker Swarm sudah aktif."
  fi

  if ! docker network inspect panel-net >/dev/null 2>&1; then
    log_info "Membuat overlay network 'panel-net'..."
    docker network create --driver overlay --attachable panel-net >/dev/null
    log_ok "Network 'panel-net' siap."
  else
    log_ok "Network 'panel-net' sudah ada."
  fi
}

prepare_source() {
  local script_dir=""
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  if [[ -n "$script_dir" && -f "$script_dir/docker/docker-compose.yml" ]]; then
    PANEL_DIR="$script_dir"
    log_ok "Menggunakan source direktori lokal: $PANEL_DIR"
    return
  fi

  if [[ -d "$PANEL_DIR/.git" ]]; then
    log_info "Memperbarui repository di $PANEL_DIR..."
    git -C "$PANEL_DIR" fetch --all --prune
    git -C "$PANEL_DIR" checkout "$PANEL_BRANCH"
    git -C "$PANEL_DIR" pull --ff-only origin "$PANEL_BRANCH"
  else
    if [[ -z "$PANEL_REPO_URL" ]]; then
      log_err "PANEL_REPO_URL belum diisi dan script tidak dijalankan dari folder repo PanelManager."
      log_err "Clone repo terlebih dahulu lalu jalankan: sudo bash install.sh"
      exit 1
    fi
    log_info "Cloning $PANEL_REPO_URL ke $PANEL_DIR..."
    git clone --branch "$PANEL_BRANCH" "$PANEL_REPO_URL" "$PANEL_DIR"
  fi
}

configure_env() {
  local env_file="$PANEL_DIR/.env"
  local server_ip
  server_ip="$(detect_server_ip)"

  if [[ ! -f "$env_file" ]]; then
    local secret
    secret="$(openssl rand -hex 32)"
    local public_url="${PANEL_PUBLIC_URL:-http://${server_ip}:${PANEL_PORT}}"

    cat > "$env_file" <<EOF
PORT=3001
WEB_PORT=${PANEL_PORT}
DATA_DIR=/data
PANEL_SECRET=${secret}
PANEL_PUBLIC_URL=${public_url}
NEXT_PUBLIC_API_URL=http://${server_ip}:3001
INTERNAL_API_URL=http://127.0.0.1:3001
EOF
    chmod 600 "$env_file"
    log_ok "File konfigurasi $env_file dibuat dengan PANEL_SECRET acak."
  else
    log_ok "Menggunakan $env_file yang sudah ada."
  fi
}

deploy_panel() {
  log_info "Membangun dan menjalankan PanelManager container..."
  cd "$PANEL_DIR"
  docker compose --env-file "$PANEL_DIR/.env" -f "$PANEL_DIR/docker/docker-compose.yml" up -d --build

  # Hubungkan container ke overlay network panel-net agar siap berkomunikasi dengan Traefik
  docker network connect panel-net panelmanager >/dev/null 2>&1 || true

  log_info "Menunggu Control Plane API siap..."
  local retries=30
  while (( retries > 0 )); do
    if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
      log_ok "PanelManager Control Plane sehat dan berjalan."
      return
    fi
    sleep 2
    retries=$((retries - 1))
  done

  log_warn "Container berjalan namun /health belum merespons dalam 60 detik. Cek log dengan: docker logs -f panelmanager"
}

main() {
  echo ""
  echo "=========================================="
  echo "   PanelManager — VPS Installer"
  echo "=========================================="
  echo ""

  install_base_packages
  setup_swap
  install_docker
  init_swarm_and_network
  prepare_source
  configure_env
  deploy_panel

  local server_ip
  server_ip="$(detect_server_ip)"

  echo ""
  echo -e "${GREEN}Instalasi PanelManager selesai!${NC}"
  echo "------------------------------------------"
  echo "  Dashboard UI : http://${server_ip}:${PANEL_PORT}"
  echo "  API Health   : http://${server_ip}:3001/health"
  echo "  Install Dir  : ${PANEL_DIR}"
  echo "  Logs         : docker logs -f panelmanager"
  echo "------------------------------------------"
  echo "Langkah berikutnya:"
  echo "  1. Buka Dashboard UI di browser dan buat akun Owner."
  echo "  2. Masuk ke menu Settings -> isi email Let's Encrypt -> klik 'Sync Traefik Swarm'."
  echo ""
}

main "$@"
