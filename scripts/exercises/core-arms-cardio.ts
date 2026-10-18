import type { Curation } from './curation-types';

export const CORE_ARMS_CARDIO: Curation = {
  core: [
    {
      id: 'plank', src: 'Plank', en: 'Plank', idn: 'Plank', eq: 'bodyweight', lvl: 'beginner', timed: true, img: [347],
      se: [
        'Lie face down and prop yourself up on your forearms with your elbows under your shoulders.',
        'Lift your hips so your body forms a straight line from your head to your heels.',
        'Squeeze your abs and glutes and look at the floor just ahead of your hands.',
        'Hold the position for the time shown while you breathe steadily.',
      ],
      si: [
        'Berbaring tengkurap, lalu tumpu badan pada lengan bawah dengan siku tepat di bawah bahu.',
        'Angkat pinggul sampai tubuh membentuk garis lurus dari kepala sampai tumit.',
        'Kencangkan perut dan bokong, lalu pandang lantai sedikit di depan tanganmu.',
        'Tahan posisi selama waktu yang ditentukan sambil bernapas teratur.',
      ],
      me: [
        'Hips sagging toward the floor: squeeze your glutes and abs, or drop to your knees.',
        'Hips piking up: lower them until your body is one straight line.',
        'Holding your breath: breathe slowly, and stop the set if your form falls apart.',
      ],
      mi: [
        'Pinggul turun ke lantai: kencangkan bokong dan perut, atau turun ke lutut.',
        'Pinggul naik: turunkan sampai tubuh satu garis lurus.',
        'Menahan napas: bernapas pelan, dan hentikan set jika bentuk mulai rusak.',
      ],
    },
    {
      id: 'dead_bug', src: 'Dead_Bug', en: 'Dead bug', idn: 'Dead bug', eq: 'bodyweight', lvl: 'beginner',
      se: [
        'Lie on your back with your arms pointing to the ceiling and your knees bent at 90 degrees above your hips.',
        'Press your lower back lightly into the floor.',
        'Lower one arm overhead and the opposite leg toward the floor at the same time.',
        'Return to the start and repeat on the other side.',
      ],
      si: [
        'Berbaring telentang dengan lengan menunjuk ke langit-langit dan lutut ditekuk 90 derajat di atas pinggul.',
        'Tekan punggung bawah dengan ringan ke lantai.',
        'Turunkan satu lengan ke atas kepala dan kaki yang berlawanan ke arah lantai secara bersamaan.',
        'Kembali ke posisi awal lalu ulangi di sisi lain.',
      ],
      me: [
        'Your lower back arches off the floor: move less far until it stays pressed down.',
        'Moving fast: slow down and breathe out as you extend.',
        'Moving the same-side arm and leg: always move opposite arm and leg.',
      ],
      mi: [
        'Punggung bawah melengkung dari lantai: gerak lebih pendek sampai tetap menempel.',
        'Bergerak cepat: pelankan dan buang napas saat meluruskan.',
        'Menggerakkan lengan dan kaki di sisi yang sama: selalu gerakkan lengan dan kaki yang berlawanan.',
      ],
    },
    {
      id: 'bird_dog', src: 'own', en: 'Bird dog', idn: 'Bird dog', eq: 'bodyweight', lvl: 'beginner',
      p: ['abs', 'lower_back'], s: ['glutes', 'shoulders'],
      se: [
        'Start on your hands and knees with your hands under your shoulders and your knees under your hips.',
        'Tighten your core and keep your back flat.',
        'Reach one arm forward and the opposite leg back until both are in line with your body.',
        'Hold for a second without letting your hips rotate, then return and switch sides.',
      ],
      si: [
        'Mulai dengan posisi merangkak, tangan di bawah bahu dan lutut di bawah pinggul.',
        'Kencangkan perut dan jaga punggung tetap rata.',
        'Julurkan satu lengan ke depan dan kaki yang berlawanan ke belakang sampai keduanya sejajar badan.',
        'Tahan satu detik tanpa memutar pinggul, lalu kembali dan ganti sisi.',
      ],
      me: [
        'Hips rotate open as you lift the leg: keep both hip bones facing the floor.',
        'Lifting the leg so high that your back arches: raise it only to hip height.',
        'Rushing: move slowly and keep your balance.',
      ],
      mi: [
        'Pinggul terbuka saat mengangkat kaki: jaga kedua tulang pinggul menghadap lantai.',
        'Mengangkat kaki terlalu tinggi sampai punggung melengkung: angkat hanya setinggi pinggul.',
        'Terburu-buru: bergerak pelan dan jaga keseimbangan.',
      ],
    },
    {
      id: 'crunch', src: 'Crunches', en: 'Crunch', idn: 'Crunch', eq: 'bodyweight', lvl: 'beginner',
      se: [
        'Lie on your back with your knees bent and your feet flat on the floor.',
        'Place your hands lightly behind your head or cross them over your chest.',
        'Curl your shoulders off the floor by squeezing your abs.',
        'Lower back down slowly without letting your head drop.',
      ],
      si: [
        'Berbaring telentang dengan lutut ditekuk dan telapak kaki rata di lantai.',
        'Letakkan tangan dengan ringan di belakang kepala atau silangkan di dada.',
        'Gulung bahu naik dari lantai dengan mengencangkan perut.',
        'Turun pelan tanpa membiarkan kepala jatuh.',
      ],
      me: [
        'Pulling on your neck: keep your elbows wide and let your abs lift you.',
        'Sitting all the way up: lift only your shoulder blades off the floor.',
        'Rushing with momentum: go slowly and pause at the top.',
      ],
      mi: [
        'Menarik leher: buka siku lebar dan biarkan perut yang mengangkat.',
        'Bangun sampai duduk: angkat hanya tulang belikat dari lantai.',
        'Terburu-buru memakai momentum: bergerak pelan dan tahan sebentar di atas.',
      ],
    },
    {
      id: 'side_plank', src: 'Side_Bridge', en: 'Side plank', idn: 'Side plank', eq: 'bodyweight', lvl: 'beginner', timed: true,
      se: [
        'Lie on your side with your elbow under your shoulder and your legs stacked.',
        'Lift your hips so your body forms a straight line from head to feet.',
        'Keep your hips high and your core tight.',
        'Hold for the time shown, then switch sides.',
      ],
      si: [
        'Berbaring miring dengan siku di bawah bahu dan kaki bertumpuk.',
        'Angkat pinggul sampai tubuh membentuk garis lurus dari kepala sampai kaki.',
        'Jaga pinggul tetap tinggi dan perut kencang.',
        'Tahan selama waktu yang ditentukan, lalu ganti sisi.',
      ],
      me: [
        'Hips sagging toward the floor: push your forearm into the floor and lift higher.',
        'Rolling forward or backward: stack your shoulders and hips.',
        'Too hard: bend your knees and rest them on the floor.',
      ],
      mi: [
        'Pinggul turun ke lantai: tekan lengan bawah ke lantai dan angkat lebih tinggi.',
        'Badan berguling ke depan atau belakang: susun bahu dan pinggul dalam satu garis.',
        'Terlalu berat: tekuk lutut dan tumpukan di lantai.',
      ],
    },
    {
      id: 'reverse_crunch', src: 'Reverse_Crunch', en: 'Reverse crunch', idn: 'Reverse crunch', eq: 'bodyweight', lvl: 'beginner',
      se: [
        'Lie on your back with your hands by your sides and your knees bent over your hips.',
        'Press your lower back into the floor.',
        'Curl your hips off the floor by pulling your knees toward your chest.',
        'Lower your hips slowly back to the floor.',
      ],
      si: [
        'Berbaring telentang dengan tangan di samping dan lutut ditekuk di atas pinggul.',
        'Tekan punggung bawah ke lantai.',
        'Gulung pinggul naik dari lantai dengan menarik lutut ke dada.',
        'Turunkan pinggul pelan-pelan kembali ke lantai.',
      ],
      me: [
        'Swinging your legs for momentum: go slowly and curl with your abs.',
        'Lifting with your hands pushing the floor: keep them relaxed.',
        'Letting your hips drop fast: take two seconds to lower.',
      ],
      mi: [
        'Mengayun kaki untuk momentum: bergerak pelan dan menggulung dengan perut.',
        'Mengangkat sambil menekan lantai dengan tangan: biarkan tangan rileks.',
        'Pinggul jatuh cepat: butuh dua detik untuk turun.',
      ],
    },
    {
      id: 'mountain_climber', src: 'Mountain_Climbers', en: 'Mountain climber', idn: 'Mountain climber', eq: 'bodyweight', lvl: 'beginner',
      p: ['abs'], s: ['shoulders', 'quadriceps', 'chest'],
      se: [
        'Start in a push-up position with your hands under your shoulders and your body in a straight line.',
        'Pull one knee toward your chest.',
        'Switch legs, pushing one foot back as the other comes forward.',
        'Keep switching at a steady pace without bouncing your hips.',
      ],
      si: [
        'Mulai dengan posisi push-up, tangan di bawah bahu dan tubuh dalam garis lurus.',
        'Tarik satu lutut ke arah dada.',
        'Ganti kaki, dorong satu kaki ke belakang saat kaki lainnya maju.',
        'Terus ganti dengan irama stabil tanpa memantulkan pinggul.',
      ],
      me: [
        'Hips piking up high: keep them level with your shoulders.',
        'Hands creeping forward: keep your wrists under your shoulders.',
        'Going so fast your form breaks: slow down and keep the knees coming in under control.',
      ],
      mi: [
        'Pinggul naik tinggi: jaga sejajar dengan bahu.',
        'Tangan bergeser ke depan: jaga pergelangan tangan di bawah bahu.',
        'Terlalu cepat sampai bentuk rusak: pelankan dan tarik lutut dengan terkontrol.',
      ],
    },
    {
      id: 'russian_twist', src: 'Russian_Twist', en: 'Russian twist', idn: 'Russian twist', eq: 'bodyweight', lvl: 'intermediate', img: [426],
      se: [
        'Sit on the floor with your knees bent and lean back until you feel your abs working.',
        'Lift your feet slightly or keep them on the floor.',
        'Clasp your hands together in front of your chest.',
        'Rotate your torso to one side, then to the other, in a steady rhythm.',
      ],
      si: [
        'Duduk di lantai dengan lutut ditekuk dan condong ke belakang sampai perut terasa bekerja.',
        'Angkat kaki sedikit atau biarkan tetap di lantai.',
        'Genggam kedua tangan di depan dada.',
        'Putar badan ke satu sisi, lalu ke sisi lain, dengan irama stabil.',
      ],
      me: [
        'Only swinging your arms: rotate your ribs and chest.',
        'Rounding your back: sit tall and lean back less.',
        'Twisting fast with momentum: slow down and control each side.',
      ],
      mi: [
        'Hanya mengayun lengan: putar tulang rusuk dan dada.',
        'Punggung membulat: duduk tegak dan condong lebih sedikit.',
        'Memutar cepat dengan momentum: pelankan dan kontrol tiap sisi.',
      ],
    },
    {
      id: 'lying_leg_raise', src: 'Flat_Bench_Lying_Leg_Raise', en: 'Lying leg raise', idn: 'Leg raise berbaring', eq: 'bodyweight', lvl: 'intermediate', img: [140, 139],
      se: [
        'Lie on your back with your legs straight and your hands under your hips or by your sides.',
        'Press your lower back lightly into the floor.',
        'Raise your legs until they point to the ceiling.',
        'Lower them slowly, stopping before your lower back arches.',
      ],
      si: [
        'Berbaring telentang dengan kaki lurus dan tangan di bawah pinggul atau di samping badan.',
        'Tekan punggung bawah dengan ringan ke lantai.',
        'Angkat kaki sampai menunjuk ke langit-langit.',
        'Turunkan pelan-pelan, berhenti sebelum punggung bawah melengkung.',
      ],
      me: [
        'Your lower back arches as you lower: lower less far, or bend your knees.',
        'Swinging your legs: go slowly and control both directions.',
        'Lifting with your hip flexors only: curl your pelvis slightly at the top.',
      ],
      mi: [
        'Punggung bawah melengkung saat turun: turun lebih pendek, atau tekuk lutut.',
        'Mengayun kaki: bergerak pelan dan kontrol di kedua arah.',
        'Mengangkat hanya dengan otot pangkal paha: gulung panggul sedikit di atas.',
      ],
    },
    {
      id: 'pallof_press', src: 'Pallof_Press', en: 'Pallof press', idn: 'Pallof press', eq: 'cable', lvl: 'beginner', home: false, img: [427],
      se: [
        'Set a cable at chest height and stand sideways to it with your feet shoulder-width apart.',
        'Hold the handle with both hands at your chest and step away until the cable is tight.',
        'Press the handle straight out in front of you without letting your torso rotate.',
        'Hold for a second, then bring it back to your chest, and switch sides after your reps.',
      ],
      si: [
        'Pasang kabel setinggi dada dan berdiri menyamping ke arahnya dengan kaki selebar bahu.',
        'Pegang gagang dengan dua tangan di dada dan menjauh sampai kabel kencang.',
        'Dorong gagang lurus ke depan tanpa membiarkan badan berputar.',
        'Tahan satu detik, lalu bawa kembali ke dada, dan ganti sisi setelah repetisi selesai.',
      ],
      me: [
        'Your torso rotates toward the cable: use a lighter weight and brace harder.',
        'Leaning away from the cable: stand tall.',
        'Shrugging your shoulders: keep them relaxed and down.',
      ],
      mi: [
        'Badan berputar ke arah kabel: pakai beban lebih ringan dan kencangkan perut lebih kuat.',
        'Bersandar menjauh dari kabel: berdiri tegak.',
        'Bahu terangkat: jaga tetap rileks dan turun.',
      ],
    },
    {
      id: 'cable_crunch', src: 'Cable_Crunch', en: 'Cable crunch', idn: 'Cable crunch', eq: 'cable', lvl: 'intermediate',
      se: [
        'Attach a rope to a high pulley and kneel facing the machine, holding the rope by your head.',
        'Sit your hips back slightly and keep them still.',
        'Curl your torso down by squeezing your abs until your elbows reach your thighs.',
        'Return slowly to the start.',
      ],
      si: [
        'Pasang tali di katrol atas dan berlutut menghadap mesin sambil memegang tali di dekat kepala.',
        'Dorong pinggul sedikit ke belakang dan jaga tetap diam.',
        'Gulung badan ke bawah dengan mengencangkan perut sampai siku mencapai paha.',
        'Kembali pelan ke posisi awal.',
      ],
      me: [
        'Pulling down with your arms and hips: keep your hips still and curl with your abs.',
        'Using too much weight so your form breaks: lighten the weight.',
        'Pulling the rope behind your head: keep your hands next to your face.',
      ],
      mi: [
        'Menarik ke bawah dengan lengan dan pinggul: jaga pinggul diam dan gulung dengan perut.',
        'Beban terlalu berat sehingga bentuk rusak: ringankan beban.',
        'Menarik tali ke belakang kepala: jaga tangan di samping wajah.',
      ],
    },
    {
      id: 'hanging_leg_raise', src: 'Hanging_Leg_Raise', en: 'Hanging leg raise', idn: 'Hanging leg raise', eq: 'bar', lvl: 'advanced', home: false,
      se: [
        'Hang from a pull-up bar with an overhand grip and your legs straight.',
        'Pull your shoulders down and tighten your core.',
        'Raise your legs until they are at hip height or higher without swinging.',
        'Lower them slowly back down.',
      ],
      si: [
        'Bergantung di bar pull-up dengan genggaman dari atas dan kaki lurus.',
        'Tarik bahu ke bawah dan kencangkan perut.',
        'Angkat kaki setinggi pinggul atau lebih tanpa mengayun.',
        'Turunkan pelan-pelan kembali.',
      ],
      me: [
        'Swinging your body: tighten your core and slow down.',
        'Too hard: bend your knees as you raise them.',
        'Letting your shoulders shrug up: keep them pulled down.',
      ],
      mi: [
        'Mengayun badan: kencangkan perut dan pelankan.',
        'Terlalu berat: tekuk lutut saat mengangkat.',
        'Bahu naik: jaga tetap ditarik ke bawah.',
      ],
    },
  ],

  arms: [
    {
      id: 'db_biceps_curl', src: 'Dumbbell_Bicep_Curl', en: 'Dumbbell biceps curl', idn: 'Biceps curl dumbbell', eq: 'dumbbell', lvl: 'beginner', img: [24, 23],
      se: [
        'Stand tall holding a dumbbell in each hand with your palms facing forward.',
        'Keep your elbows next to your ribs.',
        'Curl the dumbbells up toward your shoulders.',
        'Squeeze your biceps for a second, then lower slowly.',
      ],
      si: [
        'Berdiri tegak sambil memegang dumbbell di tiap tangan dengan telapak menghadap depan.',
        'Jaga siku tetap dekat dengan tulang rusuk.',
        'Angkat dumbbell ke arah bahu.',
        'Kencangkan bisep selama satu detik, lalu turun pelan.',
      ],
      me: [
        'Swinging your body to lift: use lighter dumbbells and stand still.',
        'Elbows drifting forward: pin them to your sides.',
        'Dropping the weights fast: take two seconds to lower.',
      ],
      mi: [
        'Mengayun badan untuk mengangkat: pakai dumbbell lebih ringan dan berdiri diam.',
        'Siku bergeser ke depan: tempelkan ke sisi badan.',
        'Menjatuhkan beban dengan cepat: butuh dua detik untuk turun.',
      ],
    },
    {
      id: 'hammer_curl', src: 'Hammer_Curls', en: 'Hammer curl', idn: 'Hammer curl', eq: 'dumbbell', lvl: 'beginner', img: [48, 47],
      se: [
        'Stand tall holding a dumbbell in each hand with your palms facing each other.',
        'Keep your elbows next to your ribs.',
        'Curl the dumbbells up toward your shoulders without turning your wrists.',
        'Lower them slowly.',
      ],
      si: [
        'Berdiri tegak sambil memegang dumbbell di tiap tangan dengan telapak saling berhadapan.',
        'Jaga siku tetap dekat dengan tulang rusuk.',
        'Angkat dumbbell ke arah bahu tanpa memutar pergelangan tangan.',
        'Turunkan pelan-pelan.',
      ],
      me: [
        'Swinging your back: keep your torso still.',
        'Bending your wrists: keep them straight and strong.',
        'Elbows drifting forward: keep them at your sides.',
      ],
      mi: [
        'Punggung mengayun: jaga badan diam.',
        'Pergelangan tangan menekuk: jaga tetap lurus dan kuat.',
        'Siku bergeser ke depan: jaga di sisi badan.',
      ],
    },
    {
      id: 'bench_dip', src: 'Bench_Dips', en: 'Bench dip', idn: 'Bench dip', eq: 'bodyweight', lvl: 'beginner', img: [36, 35],
      se: [
        'Sit on the edge of a sturdy bench or chair and place your hands next to your hips.',
        'Slide your hips off the edge with your legs bent or straight out in front of you.',
        'Bend your elbows straight back to lower your hips toward the floor.',
        'Press through your palms to straighten your arms.',
      ],
      si: [
        'Duduk di tepi bangku atau kursi yang kokoh dan letakkan tangan di samping pinggul.',
        'Geser pinggul keluar dari tepi dengan kaki ditekuk atau lurus di depan.',
        'Tekuk siku lurus ke belakang untuk menurunkan pinggul ke arah lantai.',
        'Dorong lewat telapak tangan untuk meluruskan lengan.',
      ],
      me: [
        'Going too deep so your shoulders hurt: lower only until your elbows are at about 90 degrees.',
        'Elbows flaring out: keep them pointing straight back.',
        'Hips drifting far from the bench: keep your back close to it.',
      ],
      mi: [
        'Turun terlalu dalam sampai bahu nyeri: turun hanya sampai siku sekitar 90 derajat.',
        'Siku melebar: jaga mengarah lurus ke belakang.',
        'Pinggul menjauh dari bangku: jaga punggung tetap dekat dengannya.',
      ],
    },
    {
      id: 'db_overhead_triceps_extension', src: 'Standing_Dumbbell_Triceps_Extension', en: 'Dumbbell overhead triceps extension', idn: 'Overhead triceps extension dumbbell', eq: 'dumbbell', lvl: 'beginner',
      se: [
        'Stand or sit tall and hold one dumbbell with both hands above your head with your arms straight.',
        'Keep your elbows pointing forward and close to your head.',
        'Bend your elbows to lower the dumbbell behind your head.',
        'Straighten your arms to lift the dumbbell back up.',
      ],
      si: [
        'Berdiri atau duduk tegak dan pegang satu dumbbell dengan dua tangan di atas kepala dengan lengan lurus.',
        'Arahkan siku ke depan dan jaga dekat dengan kepala.',
        'Tekuk siku untuk menurunkan dumbbell ke belakang kepala.',
        'Luruskan lengan untuk mengangkat dumbbell kembali.',
      ],
      me: [
        'Elbows flaring out: keep them close to your ears.',
        'Arching your lower back: tighten your abs and ribs.',
        'Using too heavy a dumbbell: lighten it so your elbows stay still.',
      ],
      mi: [
        'Siku melebar: jaga dekat dengan telinga.',
        'Punggung bawah melengkung: kencangkan perut dan tulang rusuk.',
        'Dumbbell terlalu berat: ringankan supaya siku tetap diam.',
      ],
    },
    {
      id: 'band_biceps_curl', src: 'own', en: 'Banded biceps curl', idn: 'Biceps curl pakai band', eq: 'band', lvl: 'beginner',
      p: ['biceps'], s: ['forearms'],
      se: [
        'Stand on the middle of a resistance band and hold the ends with your palms facing forward.',
        'Keep your elbows next to your ribs.',
        'Curl your hands up toward your shoulders against the band.',
        'Lower slowly while keeping tension on the band.',
      ],
      si: [
        'Berdiri di tengah resistance band dan pegang kedua ujungnya dengan telapak menghadap depan.',
        'Jaga siku tetap dekat dengan tulang rusuk.',
        'Angkat tangan ke arah bahu melawan tarikan band.',
        'Turun pelan sambil menjaga band tetap tegang.',
      ],
      me: [
        'Swinging your torso: stand tall and keep still.',
        'Letting the band snap down: control the lowering.',
        'Elbows drifting forward: keep them at your sides.',
      ],
      mi: [
        'Badan mengayun: berdiri tegak dan diam.',
        'Membiarkan band menyentak turun: kontrol saat menurunkan.',
        'Siku bergeser ke depan: jaga di sisi badan.',
      ],
    },
    {
      id: 'db_triceps_kickback', src: 'Tricep_Dumbbell_Kickback', en: 'Dumbbell triceps kickback', idn: 'Triceps kickback dumbbell', eq: 'dumbbell', lvl: 'beginner',
      se: [
        'Hold a light dumbbell and hinge forward at your hips with a flat back.',
        'Tuck your upper arm against your side with your elbow bent at 90 degrees.',
        'Straighten your arm backward without moving your upper arm.',
        'Squeeze your triceps for a second, then bend your elbow slowly.',
        'Finish your reps on one arm, then switch.',
      ],
      si: [
        'Pegang dumbbell ringan dan condongkan badan ke depan dari pinggul dengan punggung lurus.',
        'Rapatkan lengan atas ke sisi badan dengan siku ditekuk 90 derajat.',
        'Luruskan lengan ke belakang tanpa menggerakkan lengan atas.',
        'Kencangkan trisep selama satu detik, lalu tekuk siku pelan-pelan.',
        'Selesaikan repetisi satu lengan, lalu ganti.',
      ],
      me: [
        'Swinging your upper arm: keep it still and use a lighter weight.',
        'Rounding your back: keep your chest up and your back flat.',
        'Using momentum: pause at the top.',
      ],
      mi: [
        'Lengan atas mengayun: jaga diam dan pakai beban lebih ringan.',
        'Punggung membulat: jaga dada tegak dan punggung lurus.',
        'Memakai momentum: tahan sebentar di atas.',
      ],
    },
    {
      id: 'band_triceps_pushdown', src: 'own', en: 'Banded triceps pushdown', idn: 'Triceps pushdown pakai band', eq: 'band', lvl: 'beginner',
      p: ['triceps'], s: ['forearms'],
      se: [
        'Anchor a resistance band above head height, such as over a sturdy door, and hold the ends with your elbows bent at your sides.',
        'Keep your elbows pinned to your ribs and lean forward slightly.',
        'Push your hands down until your arms are straight.',
        'Return slowly until your forearms are about parallel to the floor.',
      ],
      si: [
        'Pasang resistance band di atas kepala, misalnya di atas pintu yang kokoh, dan pegang ujungnya dengan siku ditekuk di sisi badan.',
        'Tempelkan siku ke tulang rusuk dan condongkan badan sedikit ke depan.',
        'Dorong tangan ke bawah sampai lengan lurus.',
        'Kembali pelan sampai lengan bawah hampir sejajar lantai.',
      ],
      me: [
        'Elbows drifting forward: keep them pinned at your sides.',
        'Leaning your body over the band: stay mostly upright.',
        'Anchor not secure: check the band cannot slip or pull the door open.',
      ],
      mi: [
        'Siku bergeser ke depan: tempelkan di sisi badan.',
        'Badan membungkuk di atas band: tetap hampir tegak.',
        'Titik pasang tidak aman: pastikan band tidak bisa tergelincir atau menarik pintu terbuka.',
      ],
    },
    {
      id: 'concentration_curl', src: 'Concentration_Curls', en: 'Concentration curl', idn: 'Concentration curl', eq: 'dumbbell', lvl: 'beginner',
      se: [
        'Sit on a bench or chair with your legs apart and hold a dumbbell in one hand.',
        'Rest the back of your upper arm against your inner thigh with your arm straight.',
        'Curl the dumbbell toward your shoulder.',
        'Squeeze your biceps, then lower slowly, and switch arms after your reps.',
      ],
      si: [
        'Duduk di bangku atau kursi dengan kaki terbuka dan pegang dumbbell di satu tangan.',
        'Sandarkan bagian belakang lengan atas di paha dalam dengan lengan lurus.',
        'Angkat dumbbell ke arah bahu.',
        'Kencangkan bisep, lalu turun pelan, dan ganti lengan setelah repetisi selesai.',
      ],
      me: [
        'Leaning back to lift: stay hunched forward over your arm.',
        'Lifting your elbow off your thigh: keep it pressed there.',
        'Swinging up: use a lighter weight and lift smoothly.',
      ],
      mi: [
        'Bersandar ke belakang untuk mengangkat: tetap membungkuk di atas lenganmu.',
        'Siku terangkat dari paha: jaga tetap menempel.',
        'Mengayun ke atas: pakai beban lebih ringan dan angkat dengan halus.',
      ],
    },
    {
      id: 'triceps_pushdown', src: 'Triceps_Pushdown', en: 'Cable triceps pushdown', idn: 'Triceps pushdown', eq: 'cable', lvl: 'beginner',
      se: [
        'Stand facing a high pulley and hold the bar or rope with your elbows bent at your sides.',
        'Keep your elbows pinned to your ribs and lean forward slightly.',
        'Push the handle down until your arms are straight.',
        'Squeeze your triceps for a second, then return slowly until your forearms are about parallel to the floor.',
      ],
      si: [
        'Berdiri menghadap katrol atas dan pegang bar atau tali dengan siku ditekuk di sisi badan.',
        'Tempelkan siku ke tulang rusuk dan condongkan badan sedikit ke depan.',
        'Dorong gagang ke bawah sampai lengan lurus.',
        'Kencangkan trisep selama satu detik, lalu kembali pelan sampai lengan bawah hampir sejajar lantai.',
      ],
      me: [
        'Elbows flaring or drifting forward: keep them pinned at your sides.',
        'Leaning over the bar and using your body weight: stand tall and lighten the load.',
        'Letting the weight pull your hands up fast: control the return.',
      ],
      mi: [
        'Siku melebar atau bergeser ke depan: tempelkan di sisi badan.',
        'Membungkuk di atas bar dan memakai berat badan: berdiri tegak dan ringankan beban.',
        'Membiarkan beban menarik tangan naik dengan cepat: kontrol saat kembali.',
      ],
    },
    {
      id: 'cable_biceps_curl', src: 'Standing_Biceps_Cable_Curl', en: 'Cable biceps curl', idn: 'Cable curl', eq: 'cable', lvl: 'beginner', img: [20, 19],
      se: [
        'Attach a straight or curved bar to a low pulley and stand facing the machine with your feet shoulder-width apart.',
        'Hold the bar with an underhand grip and your elbows next to your ribs.',
        'Curl the bar up toward your shoulders.',
        'Squeeze your biceps for a second, then lower slowly.',
      ],
      si: [
        'Pasang bar lurus atau melengkung di katrol bawah dan berdiri menghadap mesin dengan kaki selebar bahu.',
        'Pegang bar dengan genggaman dari bawah dan siku di samping tulang rusuk.',
        'Angkat bar ke arah bahu.',
        'Kencangkan bisep selama satu detik, lalu turun pelan.',
      ],
      me: [
        'Swinging your torso: use a lighter weight and stand still.',
        'Elbows drifting forward: keep them pinned at your sides.',
        'Letting the stack slam back: control the return.',
      ],
      mi: [
        'Badan mengayun: pakai beban lebih ringan dan berdiri diam.',
        'Siku bergeser ke depan: tempelkan di sisi badan.',
        'Membiarkan beban menghantam balik: kontrol saat kembali.',
      ],
    },
    {
      id: 'barbell_curl', src: 'Barbell_Curl', en: 'Barbell curl', idn: 'Barbell curl', eq: 'barbell', lvl: 'beginner', img: [28, 27],
      se: [
        'Stand tall holding a barbell with an underhand grip about shoulder-width apart.',
        'Keep your elbows next to your ribs and your wrists straight.',
        'Curl the bar up toward your shoulders.',
        'Squeeze your biceps for a second, then lower slowly.',
      ],
      si: [
        'Berdiri tegak sambil memegang barbell dengan genggaman dari bawah selebar bahu.',
        'Jaga siku di samping tulang rusuk dan pergelangan tangan lurus.',
        'Angkat bar ke arah bahu.',
        'Kencangkan bisep selama satu detik, lalu turun pelan.',
      ],
      me: [
        'Swinging your hips and back: lighten the bar and tighten your core.',
        'Elbows drifting forward: keep them pinned at your sides.',
        'Stopping short at the bottom: lower until your arms are straight.',
      ],
      mi: [
        'Pinggul dan punggung mengayun: ringankan bar dan kencangkan perut.',
        'Siku bergeser ke depan: tempelkan di sisi badan.',
        'Berhenti sebelum turun penuh: turun sampai lengan lurus.',
      ],
    },
    {
      id: 'skull_crusher', src: 'EZ-Bar_Skullcrusher', en: 'Skull crusher', idn: 'Skull crusher', eq: 'barbell', lvl: 'intermediate', home: false, img: [61, 60],
      se: [
        'Lie on a flat bench holding an EZ-bar with an overhand grip and your arms straight above your chest.',
        'Keep your upper arms still and bend your elbows to lower the bar toward your forehead.',
        'Stop just above your forehead.',
        'Straighten your elbows to press the bar back up.',
      ],
      si: [
        'Berbaring di bangku datar sambil memegang EZ-bar dengan genggaman dari atas dan lengan lurus di atas dada.',
        'Jaga lengan atas diam dan tekuk siku untuk menurunkan bar ke arah dahi.',
        'Berhenti tepat di atas dahi.',
        'Luruskan siku untuk mendorong bar naik lagi.',
      ],
      me: [
        'Elbows flaring out: keep them pointing at the ceiling.',
        'Letting the bar drift behind your head: keep your upper arms near vertical.',
        'Using too much weight: use a lighter bar and ask for a spotter when it gets heavy.',
      ],
      mi: [
        'Siku melebar: jaga mengarah ke langit-langit.',
        'Bar bergeser ke belakang kepala: jaga lengan atas hampir tegak.',
        'Beban terlalu berat: pakai bar lebih ringan dan minta spotter saat sudah berat.',
      ],
    },
  ],

  cardio: [
    {
      id: 'jumping_jacks', src: 'own', en: 'Jumping jacks', idn: 'Jumping jack', eq: 'bodyweight', lvl: 'beginner',
      p: ['quadriceps', 'calves'], s: ['shoulders', 'abductors', 'adductors'],
      se: [
        'Stand tall with your feet together and your arms at your sides.',
        'Jump your feet out wide while raising your arms overhead.',
        'Jump back to the start position.',
        'Repeat at a steady rhythm and land softly.',
      ],
      si: [
        'Berdiri tegak dengan kaki rapat dan tangan di samping badan.',
        'Lompat membuka kaki lebar sambil mengangkat tangan ke atas kepala.',
        'Lompat kembali ke posisi awal.',
        'Ulangi dengan irama stabil dan mendarat dengan lembut.',
      ],
      me: [
        'Landing with stiff, locked knees: bend them slightly and land softly.',
        'Landing flat on your heels: land on the balls of your feet.',
        'Too loud for your joints: switch to a step-out version, one foot at a time.',
      ],
      mi: [
        'Mendarat dengan lutut kaku terkunci: tekuk sedikit dan mendarat lembut.',
        'Mendarat dengan tumit rata: mendarat di bagian depan telapak kaki.',
        'Terlalu keras untuk sendi: ganti dengan versi melangkah, satu kaki bergantian.',
      ],
    },
    {
      id: 'high_knees', src: 'own', en: 'High knees', idn: 'High knees', eq: 'bodyweight', lvl: 'beginner',
      p: ['quadriceps', 'calves'], s: ['abs', 'glutes'],
      se: [
        'Stand tall with your feet hip-width apart.',
        'Run on the spot and drive your knees up toward hip height.',
        'Swing your arms in rhythm with your legs.',
        'Stay on the balls of your feet and keep your chest up.',
      ],
      si: [
        'Berdiri tegak dengan kaki selebar pinggul.',
        'Lari di tempat dan angkat lutut setinggi pinggul.',
        'Ayunkan lengan seirama dengan kaki.',
        'Tetap di bagian depan telapak kaki dan jaga dada tegak.',
      ],
      me: [
        'Leaning back: stay tall and slightly lean forward.',
        'Stomping heavily: stay light on the balls of your feet.',
        'Too fast to lift your knees: slow down and lift higher.',
      ],
      mi: [
        'Condong ke belakang: berdiri tegak dan condong sedikit ke depan.',
        'Menghentak keras: tetap ringan di bagian depan telapak kaki.',
        'Terlalu cepat sampai lutut tidak terangkat: pelankan dan angkat lebih tinggi.',
      ],
    },
    {
      id: 'burpee', src: 'own', en: 'Burpee', idn: 'Burpee', eq: 'bodyweight', lvl: 'intermediate',
      p: ['quadriceps', 'chest'], s: ['shoulders', 'triceps', 'abs', 'glutes'],
      se: [
        'Stand tall, then squat down and place your hands on the floor in front of you.',
        'Jump or step your feet back into a push-up position.',
        'Lower your chest to the floor and push back up, or skip the push-up if it is too hard.',
        'Jump or step your feet back toward your hands and stand up.',
        'Jump up with your arms overhead, or just stand tall if you want a gentler version.',
      ],
      si: [
        'Berdiri tegak, lalu jongkok dan letakkan tangan di lantai di depanmu.',
        'Lompat atau langkahkan kaki ke belakang ke posisi push-up.',
        'Turunkan dada ke lantai dan dorong naik, atau lewati push-up jika terlalu berat.',
        'Lompat atau langkahkan kaki kembali ke arah tangan lalu berdiri.',
        'Lompat dengan tangan di atas kepala, atau cukup berdiri tegak untuk versi yang lebih ringan.',
      ],
      me: [
        'Hips sagging in the push-up position: tighten your abs and glutes, or skip the push-up.',
        'Rounding your back as you stand up: keep your chest up.',
        'Rushing until your form falls apart: slow down and step instead of jumping.',
      ],
      mi: [
        'Pinggul turun di posisi push-up: kencangkan perut dan bokong, atau lewati push-up.',
        'Punggung membulat saat berdiri: jaga dada tegak.',
        'Terburu-buru sampai bentuk rusak: pelankan dan melangkah, jangan melompat.',
      ],
    },
    {
      id: 'butt_kicks', src: 'own', en: 'Butt kicks', idn: 'Butt kicks', eq: 'bodyweight', lvl: 'beginner',
      p: ['hamstrings', 'calves'], s: ['quadriceps'],
      se: [
        'Stand tall with your feet hip-width apart.',
        'Jog on the spot and kick your heels up toward your glutes.',
        'Swing your arms in rhythm with your legs.',
        'Stay on the balls of your feet and keep your torso upright.',
      ],
      si: [
        'Berdiri tegak dengan kaki selebar pinggul.',
        'Jogging di tempat dan tendang tumit ke arah bokong.',
        'Ayunkan lengan seirama dengan kaki.',
        'Tetap di bagian depan telapak kaki dan jaga badan tegak.',
      ],
      me: [
        'Leaning forward: stand tall.',
        'Landing heavily: stay light on the balls of your feet.',
        'Kicking only from the knee: lift your heels by bending your knees fully.',
      ],
      mi: [
        'Condong ke depan: berdiri tegak.',
        'Mendarat keras: tetap ringan di bagian depan telapak kaki.',
        'Menendang hanya dari lutut: angkat tumit dengan menekuk lutut penuh.',
      ],
    },
    {
      id: 'jump_rope', src: 'Rope_Jumping', en: 'Jump rope', idn: 'Lompat tali', eq: 'other', lvl: 'beginner', home: true,
      p: ['calves'], s: ['quadriceps', 'shoulders', 'forearms'],
      se: [
        'Hold the handles at your sides with your elbows close to your ribs and the rope behind your heels.',
        'Swing the rope over your head using your wrists, not your whole arms.',
        'Jump just high enough for the rope to pass under your feet.',
        'Land softly on the balls of your feet and keep a steady rhythm.',
      ],
      si: [
        'Pegang gagang di samping badan dengan siku dekat tulang rusuk dan tali di belakang tumit.',
        'Ayunkan tali di atas kepala memakai pergelangan tangan, bukan seluruh lengan.',
        'Lompat hanya setinggi cukup untuk tali lewat di bawah kaki.',
        'Mendarat lembut di bagian depan telapak kaki dan jaga irama stabil.',
      ],
      me: [
        'Jumping too high: jump just a couple of centimetres.',
        'Swinging with big arm circles: turn the rope with your wrists.',
        'Landing flat-footed: stay on the balls of your feet and bend your knees slightly.',
      ],
      mi: [
        'Melompat terlalu tinggi: lompat hanya beberapa sentimeter.',
        'Mengayun dengan lingkaran lengan besar: putar tali dengan pergelangan tangan.',
        'Mendarat dengan telapak rata: tetap di bagian depan telapak kaki dan tekuk lutut sedikit.',
      ],
    },
    {
      id: 'running_treadmill', src: 'Running_Treadmill', en: 'Treadmill run', idn: 'Lari di treadmill', eq: 'machine', lvl: 'beginner',
      se: [
        'Start with a slow walk for a couple of minutes to warm up.',
        'Increase the speed gradually to a pace where you could still speak in short sentences.',
        'Land with your feet under your body and keep your arms relaxed at about 90 degrees.',
        'Slow down to a walk for a couple of minutes at the end.',
      ],
      si: [
        'Mulai dengan jalan pelan beberapa menit untuk pemanasan.',
        'Naikkan kecepatan bertahap sampai tempo di mana kamu masih bisa bicara dalam kalimat pendek.',
        'Mendaratlah dengan kaki di bawah badan dan jaga lengan rileks di sekitar 90 derajat.',
        'Turunkan kecepatan jadi jalan beberapa menit di akhir.',
      ],
      me: [
        'Holding the rails while you run: let go once you are comfortable so your posture stays natural.',
        'Starting too fast: begin slow and build up.',
        'Overstriding with your feet far in front: take shorter, quicker steps.',
      ],
      mi: [
        'Berpegangan pada pegangan saat lari: lepaskan setelah nyaman supaya postur tetap alami.',
        'Mulai terlalu cepat: mulai pelan dan naikkan bertahap.',
        'Langkah terlalu panjang dengan kaki jauh di depan: ambil langkah lebih pendek dan cepat.',
      ],
    },
    {
      id: 'stationary_bike', src: 'Bicycling_Stationary', en: 'Stationary bike', idn: 'Sepeda statis', eq: 'machine', lvl: 'beginner',
      se: [
        'Adjust the seat so your knee is slightly bent at the bottom of the pedal stroke.',
        'Start pedalling easily for a couple of minutes to warm up.',
        'Raise the resistance until you can keep a steady pace while still breathing comfortably.',
        'Keep your back straight and your hands relaxed on the handles.',
      ],
      si: [
        'Atur jok supaya lutut sedikit ditekuk saat pedal di titik terbawah.',
        'Mulai mengayuh santai beberapa menit untuk pemanasan.',
        'Naikkan beban sampai kamu bisa menjaga tempo stabil sambil tetap bernapas nyaman.',
        'Jaga punggung lurus dan tangan rileks di pegangan.',
      ],
      me: [
        'Seat too low so your knees bend sharply: raise it a little.',
        'Gripping the handles hard: relax your hands and shoulders.',
        'Rocking your hips side to side: the seat is probably too high, so lower it a little.',
      ],
      mi: [
        'Jok terlalu rendah sehingga lutut menekuk tajam: naikkan sedikit.',
        'Mencengkeram pegangan dengan keras: rileks tangan dan bahu.',
        'Pinggul bergoyang ke samping: jok kemungkinan terlalu tinggi, turunkan sedikit.',
      ],
    },
  ],
};
