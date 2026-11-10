import * as THREE from 'three';
import * as LocAR from 'locar';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const STORE = 'tur-kampus:visited:v1';
const q = new URLSearchParams(location.search);
// Mode GPS palsu: ?fake=1&at=0&d=30  (30 m di utara POI nomor 0)
const FAKE = q.get('fake') === '1';
const WEAK_ACCURACY = 25; // meter, lebih dari ini dianggap lemah

let pois = [], radiusDefault = 25, visited = loadVisited();
const meshes = new Map();
const mixers = [];
let me = null; // {lat, lon, acc}

function loadVisited() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) || '[]')); } catch { return new Set(); }
}
function saveVisited() {
  try { localStorage.setItem(STORE, JSON.stringify([...visited])); } catch (e) { console.warn('localStorage gagal', e); }
}

function validatePois(d) {
  const errs = [];
  if (!d || !Array.isArray(d.pois) || d.pois.length < 3) errs.push('pois.json minimal berisi 3 titik.');
  const ids = new Set();
  (d?.pois || []).forEach((p, i) => {
    const t = `Titik ke-${i + 1}`;
    if (!p.id || ids.has(p.id)) errs.push(`${t}: id kosong atau dobel.`);
    ids.add(p.id);
    if (!p.nama) errs.push(`${t}: nama kosong.`);
    if (!(p.lat >= -90 && p.lat <= 90) || !(p.lon >= -180 && p.lon <= 180)) errs.push(`${t}: koordinat tidak valid.`);
  });
  return errs;
}

// Jarak haversine (meter)
function distance(aLat, aLon, bLat, bLon) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function showError(msg) { $('err').textContent = msg; }

async function checkCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser ini tidak mendukung kamera. Buka lewat HTTPS di Chrome atau Safari.');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser, lalu muat ulang halaman.');
    throw new Error('Kamera tidak bisa dibuka: ' + e.name);
  }
}

function makeMarker(color) {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(6), new THREE.MeshBasicMaterial({ color }));
  gem.position.y = 4;
  g.add(gem);
  g.userData.spin = gem; // placeholder beranimasi sebelum GLB dipasang
  return g;
}

function attachPoiId(obj, id) { obj.traverse((o) => { o.userData.poiId = id; }); }

function placePoi(locar, p) {
  const holder = makeMarker(p.warna || '#e4572e');
  attachPoiId(holder, p.id);
  locar.add(holder, p.lon, p.lat, p.elevasi ?? 0);
  meshes.set(p.id, holder);
  if (!p.model) return;
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/${p.model}`, (gltf) => {
    const m = gltf.scene;
    m.scale.setScalar(p.skala ?? 10);
    attachPoiId(m, p.id);
    holder.clear(); holder.userData.spin = null;
    holder.add(m);
    if (gltf.animations.length) {
      const mx = new THREE.AnimationMixer(m);
      mx.clipAction(gltf.animations[0]).play();
      mixers.push(mx);
    }
  }, undefined, (e) => console.warn('GLB gagal dimuat, pakai marker.', p.model, e));
}

function updateHud() {
  $('progress').innerHTML = `<b>${visited.size} dari ${pois.length}</b> titik dikunjungi`;
  if (!me) return;
  let best = null;
  for (const p of pois) {
    const d = distance(me.lat, me.lon, p.lat, p.lon);
    if (!best || d < best.d) best = { p, d };
  }
  $('nearest').textContent = `Terdekat: ${best.p.nama}, ${Math.round(best.d)} m`;
  const weak = me.acc > WEAK_ACCURACY;
  $('gps').textContent = weak
    ? `Sinyal GPS lemah (akurasi ±${Math.round(me.acc)} m). Pindah ke area terbuka.`
    : `GPS baik (akurasi ±${Math.round(me.acc)} m)`;
  $('gps').classList.toggle('warn', weak);
}

function onPosition(lat, lon, acc) {
  me = { lat, lon, acc };
  for (const p of pois) {
    if (distance(lat, lon, p.lat, p.lon) <= (p.radius ?? radiusDefault) && !visited.has(p.id)) {
      visited.add(p.id); saveVisited();
    }
  }
  updateHud();
}

function openSheet(id) {
  const p = pois.find((x) => x.id === id); if (!p) return;
  $('sName').textContent = p.nama;
  $('sDesc').textContent = p.deskripsi;
  const d = me ? Math.round(distance(me.lat, me.lon, p.lat, p.lon)) : null;
  $('sDist').textContent = (d == null ? 'Jarak belum diketahui.' : `Jarak kamu: ${d} m`) + (visited.has(id) ? ' (sudah dikunjungi)' : '');
  $('sheet').classList.add('open');
}

async function boot() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/pois.json`);
  if (!res.ok) throw new Error('pois.json gagal dimuat.');
  const data = await res.json();
  const errs = validatePois(data);
  if (errs.length) throw new Error(errs.join(' '));
  pois = data.pois; radiusDefault = data.radiusDefault ?? 25;

  await checkCamera();

  // locar 0.2.x: kelas App mengurus kamera, renderer, scene, webcam, dan sensor arah
  const app = new LocAR.App({
    canvas: $('c'),
    gpsOptions: { gpsMinAccuracy: 100, gpsMinDistance: 2 },
  });
  let locar;
  try {
    locar = await app.start();
  } catch (e) {
    const msg = {
      LOCAR_DEVICE_ORIENTATION_NO_HTTPS: 'Sensor arah butuh HTTPS. Buka lewat tautan GitHub Pages, bukan alamat http biasa.',
      LOCAR_DEVICE_ORIENTATION_NOT_SUPPORTED: 'Perangkat ini tidak mendukung sensor arah.',
    }[e?.code] || `Gagal memulai AR: ${e?.message || e?.code || e}`;
    throw new Error(msg);
  }
  const { scene, camera } = app;

  // locar.add() akan error kalau dipanggil sebelum ada posisi GPS pertama,
  // jadi objek baru dipasang saat gpsupdate yang pertama.
  let placed = false;
  const ensurePlaced = () => {
    if (placed) return;
    placed = true;
    pois.forEach((p) => placePoi(locar, p));
  };

  locar.on('gpsupdate', (ev) => {
    const c = ev?.position?.coords ?? ev?.coords;
    if (!c) return;
    ensurePlaced();
    onPosition(c.latitude, c.longitude, c.accuracy ?? 99);
  });
  locar.on('gpserror', (err) => {
    const code = typeof err === 'object' ? err?.code : err;
    const msg = { 1: 'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini lalu muat ulang.',
      2: 'Posisi tidak tersedia. Coba pindah ke area terbuka.', 3: 'GPS terlalu lama merespons. Coba lagi.' }[code] || `Error GPS (${code})`;
    $('gps').textContent = msg; $('gps').classList.add('warn');
  });

  if (FAKE) {
    const t = pois[Number(q.get('at') ?? 0)] ?? pois[0];
    const lat = t.lat + Number(q.get('d') ?? 30) / 111320;
    locar.fakeGps(t.lon, lat, null, 5);
  } else {
    locar.startGps();
  }

  // Ketuk objek untuk membuka info
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  $('c').addEventListener('pointerdown', (e) => {
    ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.userData.poiId);
    if (hit) openSheet(hit.object.userData.poiId);
  });
  $('sClose').onclick = () => $('sheet').classList.remove('open');

  // Animasi marker dan klip GLB (render utama sudah dijalankan App)
  const clock = new THREE.Clock();
  (function tick() {
    const dt = clock.getDelta();
    meshes.forEach((g) => { if (g.userData.spin) g.userData.spin.rotation.y += dt * 1.5; });
    mixers.forEach((m) => m.update(dt));
    requestAnimationFrame(tick);
  })();

  $('start').hidden = true; $('hud').hidden = false; updateHud();
}

$('go').onclick = async () => {
  showError('');
  try { await boot(); } catch (e) { console.error(e); showError(e?.message || String(e)); }
};
