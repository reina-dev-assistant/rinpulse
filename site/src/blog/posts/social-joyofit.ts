import type { Post } from "../types.ts";

export const social: Post = {
  slug: "social-joyofit",
  title: "Tab Social di JoyoFit: feed, grup, dan profil dari JoyoRogo",
  description:
    "JoyoFit sekarang punya tab Social. Lihat latihan dan makanan teman di feed JoyoRogo, gabung grup dengan kode undangan, buka profil, beri kudos, dan balas komentar.",
  date: "2026-10-18",
  tag: "Social",
  body: [
    {
      kind: "p",
      text: "Tab Social menampilkan feed JoyoRogo di dalam JoyoFit. Latihan dari jam-mu, makanan yang dicatat teman, dan postingan grup ada di satu layar, tanpa pindah aplikasi.",
    },
    { kind: "h2", text: "Yang ada di tab Social" },
    {
      kind: "ul",
      items: [
        "Feed dengan dua tab: Following (kamu, orang yang kamu ikuti, dan grupmu) dan Explore (postingan publik di JoyoRogo).",
        "Grup: gabung dengan kode undangan dari teman. Membuat grup baru masih lewat JoyoRogo.",
        "Profil: profilmu sendiri dengan postinganmu, dan profil orang lain dari feed atau dari anggota grup.",
        "Komentar dan kudos di setiap postingan. Kudos bisa kamu tarik lagi.",
      ],
    },
    { kind: "h2", text: "Mulai" },
    {
      kind: "ol",
      items: [
        "Masuk dengan akun JoyoRogo di JoyoFit. Tab Social minta masuk dulu, karena feed-nya milik JoyoRogo.",
        "Buka tab Social, ketuk Groups, isi Invite code, lalu ketuk Join.",
        "Mau membagikan latihan sendiri? Buka layar latihannya dan ketuk Share to JoyoRogo. Caranya ada di [bagikan latihan dari jam ke JoyoRogo](/blog/bagikan-latihan-ke-joyorogo).",
      ],
    },
    { kind: "h2", text: "Skor harian di grup" },
    {
      kind: "p",
      text: "Grup JoyoRogo bisa membagikan skor harian JoyoFit: Recovery, Strain, skor tidur, dan Readiness. Yang dibagikan hanya skornya. Detak jantung per menit, langkah, dan data jam lainnya tidak ikut. Pengaturannya ada di grup di JoyoRogo.",
    },
    {
      kind: "note",
      text: "Aplikasi JoyoFit berbahasa Inggris, jadi nama tombol di tulisan ini ditulis persis seperti di layar.",
    },
  ],
  more: [
    { href: "/panduan#social", label: "Panduan: Social dan berbagi" },
    { href: "/blog/bagikan-latihan-ke-joyorogo", label: "Bagikan latihan dari jam ke JoyoRogo" },
  ],
};
