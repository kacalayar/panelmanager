# Panduan Kontribusi — PanelManager

Terima kasih sudah tertarik berkontribusi pada **PanelManager** (`https://github.com/kacalayar/panelmanager`).

## Setup Pengembangan Lokal

1. Fork repository ini dan clone secara lokal:
   ```bash
   git clone https://github.com/kacalayar/panelmanager.git
   cd panelmanager
   ```
2. Pastikan menggunakan **Node.js >= 22** dan **pnpm**:
   ```bash
   pnpm install
   ```
3. Jalankan typecheck, unit test, dan build sebelum mengirim Pull Request:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```
4. Untuk pengembangan lokal:
   ```bash
   pnpm dev
   ```

## Menambah 1-Click App Template Baru

1. Tambahkan definisi template baru di `packages/templates/src/catalog.ts`.
2. Gunakan placeholder `{{randomPassword:<key>}}`, `{{randomHex:32}}`, atau `{{domain}}` agar password dan domain terisi aman otomatis.
3. Tambahkan/jalankan unit test di `packages/templates/src/templates.test.ts`.

## Aturan Pull Request

- Jaga kode tetap terketik rapi (`strict` TypeScript) tanpa error pada `pnpm typecheck`.
- Sertakan test baru bila menambah fitur atau memperbaiki bug.
- Gunakan pesan commit yang jelas (mis. `feat: add ...`, `fix: ...`, `docs: ...`).
