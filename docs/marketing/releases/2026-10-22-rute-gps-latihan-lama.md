---
title: Rute GPS latihan yang sudah tersinkron diambil ulang
available: code
---

Latihan lari dan jalan yang sudah tersinkron tidak punya rute: layar detail menulis **"Jam tidak menyediakan
file GPS untuk latihan ini"**, padahal jamnya merekam GPS sendiri.

Sebabnya bukan jamnya. Latihan itu disimpan saat app belum mengunduh file GPS, jadi barisnya sudah ditandai
selesai — dan latihan yang sudah "selesai" tidak pernah disinkron ulang. Rutenya tidak hilang dari jam, hanya
tidak pernah diambil.

Sekarang latihan seperti itu diambil sekali lagi **kalau jam sendiri bilang punya rutenya** (perangkat yang
menjawab tidak punya tidak diulang, jadi latihan beban tetap tenang), dan hasil percobaannya dicatat supaya
kegagalan sungguhan tidak jadi unduhan berulang tiap sinkronisasi.

Sinkronkan satu kali untuk latihan lama mengisi rutenya.
