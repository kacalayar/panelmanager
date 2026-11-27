# Security Policy

## Melaporkan Kerentanan Keamanan

Karena **PanelManager** berinteraksi langsung dengan Docker socket, enkripsi secret, dan reverse proxy server, keamanan adalah prioritas utama.

Jika Anda menemukan celah keamanan (misalnya bypass autentikasi, kebocoran secret/env, command injection pada builder/backup/terminal, atau kerentanan privilege escalation):

- **Mohon JANGAN membuka GitHub Issue secara publik.**
- Laporkan secara privat melalui **GitHub Security Advisories** di `https://github.com/kacalayar/panelmanager/security/advisories/new`.

Sertakan detail berikut bila memungkinkan:
1. Deskripsi kerentanan dan potensi dampaknya.
2. Langkah reproduksi atau Proof-of-Concept (PoC).
3. Saran mitigasi atau patch (jika ada).
