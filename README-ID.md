# Rise of Champions — Panduan Main di PC (Windows)

Game manajer sepak bola. Server berjalan lokal di PC kamu, main lewat browser.

## Persiapan

- **Windows 10 / 11** (64-bit).
- **Node.js LTS** — download gratis di https://nodejs.org/ (pilih "LTS").
  Tanpa Node.js, game tidak bisa jalan.
- **Internet**: hanya dibutuhkan sekali untuk download Node.js.
  Setelah Node.js terinstall, game bisa dimainkan **offline**.
- Tidak perlu install apa-apa lagi. Tidak ada `npm install` —
  game ini tanpa dependency eksternal.

## Cara menjalankan game

1. **Ekstrak** file `rise-of-champions-windows-local.zip`
   ke folder bebas, misalnya `D:\Games\rise-of-champions`.
2. Buka folder hasil ekstrak.
3. **Double-click `RUN_GAME.bat`**.
4. Tunggu tulisan `[OK] Server siap!` — browser otomatis terbuka
   ke alamat `http://localhost:3000/`.
5. Daftar akun manajer, buat klub, langsung main.

Kalau browser tidak terbuka otomatis, buka manual:
`http://localhost:3000/`

## Cara menghentikan game

- Tutup jendela hitam berjudul **"Rise of Champions Server"**,
  atau tekan `Ctrl+C` di jendela itu lalu jawab `Y`.
- Jendela launcher boleh ditutup kapan saja.
- **Data aman**: progres tersimpan otomatis setiap ada perubahan.

## Save data

- Data tersimpan di folder **`server\data`** (di dalam folder game).
- Progres **tidak hilang** saat server dimatikan — lanjutkan main
  dengan menjalankan `RUN_GAME.bat` lagi.
- **Backup**: copy seluruh folder `server\data` ke tempat aman.
- **Restore**: tutup server dulu, lalu timpa folder `server\data`
  dengan hasil backup, baru jalankan lagi.
- **Jangan hapus** file di `server\data` kecuali kamu memang mau
  mengulang dari nol.

## Troubleshooting

**"Node.js tidak ditemukan"**
→ Install Node.js LTS dari https://nodejs.org/, restart PC jika perlu,
lalu jalankan lagi `RUN_GAME.bat`.

**Server tidak merespons / browser tidak bisa connect**
→ Tunggu 30 detik. Kalau tetap gagal, lihat jendela "Rise of Champions Server"
untuk pesan error.

**Port 3000 sudah dipakai**
→ Tutup aplikasi yang memakai port 3000, atau jalankan dengan port lain:
buka `cmd`, lalu ketik:
```
set PORT=3001 && RUN_GAME.bat
```
Lalu buka `http://localhost:3001/` di browser.

**Server jalan tapi UI tidak muncul / blank**
→ Coba refresh browser (F5). Coba browser lain (Chrome/Edge/Firefox).
Pastikan tidak ada ekstensi pemblokir script yang agresif.

**Windows Defender / antivirus memberi peringatan**
→ Ini normal untuk aplikasi lokal tanpa sertifikat. Pilih "Run anyway" /
"Jalankan tetap" jika kamu yakin file berasal dari sumber terpercaya.
Tidak perlu menonaktifkan antivirus.

**Game terasa lambat**
→ Tutup tab/aplikasi berat lain. Game ini ringan — simulasi
berjalan di server lokal.

---
*Dibangun dari Rise of Champions Phase 77 (811/811 tests).*
*Butuh bantuan? Lihat `MANIFEST.txt` untuk info versi.*
