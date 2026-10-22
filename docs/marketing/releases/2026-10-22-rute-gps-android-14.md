---
title: Rute GPS latihan yang diunduh dari jam tidak lagi hilang di Android 14+
available: code
---

Latihan lari dan jalan yang rutenya ada di jam tetap muncul tanpa rute: layar detail menulis **"Jam tidak
menyediakan file GPS untuk latihan ini"**. Sebelumnya ini diperbaiki lewat sisi *kapan* file diminta; ternyata
ada tembok kedua di sisi *bagaimana* file itu datang.

Bluetooth LE di Android 14 ke atas membuang setiap paket yang lebih panjang dari satu nilai atribut (512 byte):
sistem memaksa MTU 517 apa pun yang diminta aplikasi, jam menjawab dengan paket 514 byte, dan tumpukan
Bluetooth membuangnya sebelum aplikasi melihatnya. Jam menawarkan blok 2200 byte, jadi jawabannya selalu
dibuang dan unduhan mati tanpa satu byte pun.

Dua perubahan:

1. **Unduhan dibatasi** ke blok yang pasti muat dalam satu paket — ukuran file dan hasilnya utuh, cuma
   diminta per potongan kecil. Ini memperbaiki unduhan lewat Bluetooth LE tanpa mengubah apa pun yang lain.
2. **Saklar "Pakai Bluetooth Classic"** di Setelan → Lanjutan buat jam yang tetap tidak mau: Bluetooth Classic
   (RFCOMM) tidak punya batas 512 byte, dan jam yang sama menjawab lewat jalur itu. Berlaku mulai koneksi
   berikutnya.

Sinkronkan satu kali setelah memasang build ini untuk mengisi rute latihan lama.
