export default {
  title: "Mulai dari template",
  description: "Semuanya face biasa yang bisa kamu ubah. Memuat template mengganti face yang sedang dibuka, dan Urungkan mengembalikan face kamu.",
  empty: "Kosong",
  blank: { name: "Face kosong", blurb: "Layar hitam dengan jam. Tambah sesukamu." },
  loaded: "{{name}} dimuat",
  loadedHint: "Tekan Ctrl+Z untuk kembali ke face sebelumnya.",
  layers: { time: "Waktu", date: "Tanggal" },
  items: {
    quiet: { name: "Tenang", blurb: "Waktu dan tanggal di latar hitam. Itu saja." },
    "stack-ring": { name: "Tumpuk", blurb: "Angka besar bertumpuk di dalam ring langkah." },
    classic: { name: "Klasik", blurb: "Dial analog dengan tiga jarum dan tanggal." },
    photo: { name: "Foto", blurb: "Fotomu di belakang jam yang tebal. Ganti latar contohnya." },
    sport: { name: "Olahraga", blurb: "Waktu di atas, langkah, detak jantung, dan baterai terlihat." },
    orbit: { name: "Orbit", blurb: "Jarum analog di dalam ring langkah dan baterai." },
  },
} as const;
