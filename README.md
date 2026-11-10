# AR Tur Kampus (Outdoor, GPS) v0.5

Aplikasi AR berbasis web: objek 3D muncul di koordinat gedung kampus, jarak ke titik tampil di HUD.
Teknologi: Three.js, LocAR.js, Vite, GitHub Pages.

## Menjalankan
    npm install
    npm install three@^0.181.0 locar@0.2.12
    npm run dev

Uji dalam ruangan: buka `?fake=1&at=0&d=30` (posisi palsu 30 m di utara titik nomor 0, pakai `d=10` untuk masuk radius).
Kamera, GPS, dan sensor hanya jalan lewat HTTPS, jadi uji di HP lewat GitHub Pages.

## Fitur
- 3 titik di `public/data/pois.json` (divalidasi saat dimuat)
- Objek 3D per titik, ketuk objek untuk info
- HUD jarak titik terdekat, status akurasi GPS, progres kunjungan (localStorage)
- Penanganan izin kamera dan lokasi ditolak, sinyal GPS lemah
- Mode GPS palsu

## Batasan yang diketahui
Isi setelah uji lapangan (jitter GPS, arah kompas, perilaku iPhone).
