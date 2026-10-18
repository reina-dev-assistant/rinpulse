import type { Curation } from './curation-types';

export const PUSH_PULL: Curation = {
  push_h: [
    {
      id: 'push_up', src: 'Pushups', en: 'Push-up', idn: 'Push-up', eq: 'bodyweight', lvl: 'beginner',
      se: [
        'Place your hands on the floor slightly wider than your shoulders and extend your legs behind you.',
        'Tighten your core and glutes so your body forms a straight line from head to heels.',
        'Bend your elbows to lower your chest toward the floor, with your elbows at about 45 degrees from your body.',
        'Push the floor away until your arms are straight.',
      ],
      si: [
        'Letakkan tangan di lantai sedikit lebih lebar dari bahu dan luruskan kaki ke belakang.',
        'Kencangkan perut dan bokong supaya tubuh membentuk garis lurus dari kepala sampai tumit.',
        'Tekuk siku untuk menurunkan dada ke lantai, siku sekitar 45 derajat dari badan.',
        'Dorong lantai menjauh sampai lengan lurus.',
      ],
      me: [
        'Hips sag or pike up: squeeze your glutes and abs so your body stays in one line.',
        'Elbows flare out wide: tuck them to about 45 degrees.',
        'Half reps: lower until your chest is a fist away from the floor, or switch to the incline version.',
      ],
      mi: [
        'Pinggul turun atau naik: kencangkan bokong dan perut supaya tubuh tetap satu garis.',
        'Siku melebar ke samping: rapatkan sampai sekitar 45 derajat.',
        'Turun setengah-setengah: turun sampai dada sejauh satu kepalan dari lantai, atau pakai versi incline.',
      ],
    },
    {
      id: 'incline_push_up', src: 'Incline_Push-Up', en: 'Incline push-up', idn: 'Incline push-up', eq: 'bodyweight', lvl: 'beginner',
      se: [
        'Place your hands on a sturdy bench, table or stair, slightly wider than your shoulders.',
        'Step your feet back until your body forms a straight line from head to heels.',
        'Bend your elbows to lower your chest toward the edge.',
        'Push away until your arms are straight.',
      ],
      si: [
        'Letakkan tangan di bangku, meja, atau anak tangga yang kokoh, sedikit lebih lebar dari bahu.',
        'Mundurkan kaki sampai tubuh membentuk garis lurus dari kepala sampai tumit.',
        'Tekuk siku untuk menurunkan dada ke arah tepinya.',
        'Dorong menjauh sampai lengan lurus.',
      ],
      me: [
        'Sagging in the middle: tighten your abs and glutes.',
        'Using a surface that slides: pick something fixed, like a wall-backed bench.',
        'Neck jutting forward: keep your head in line with your spine.',
      ],
      mi: [
        'Tubuh melorot di tengah: kencangkan perut dan bokong.',
        'Memakai tumpuan yang bergeser: pilih yang tetap, misalnya bangku yang bersandar ke dinding.',
        'Leher menjulur ke depan: jaga kepala sejajar tulang belakang.',
      ],
    },
    {
      id: 'knee_push_up', src: 'own', en: 'Knee push-up', idn: 'Push-up lutut', eq: 'bodyweight', lvl: 'beginner',
      p: ['chest'], s: ['triceps', 'shoulders', 'abs'],
      se: [
        'Kneel on the floor and place your hands slightly wider than your shoulders.',
        'Walk your hands forward so your body is a straight line from your head to your knees.',
        'Bend your elbows to lower your chest toward the floor.',
        'Push up until your arms are straight.',
      ],
      si: [
        'Berlutut di lantai dan letakkan tangan sedikit lebih lebar dari bahu.',
        'Jalankan tangan ke depan sampai tubuh membentuk garis lurus dari kepala sampai lutut.',
        'Tekuk siku untuk menurunkan dada ke lantai.',
        'Dorong naik sampai lengan lurus.',
      ],
      me: [
        'Sticking your hips up: keep a straight line from your head to your knees.',
        'Elbows wide open: tuck them to about 45 degrees.',
        'Dropping your head first: lower your chest and head together.',
      ],
      mi: [
        'Pinggul menjulang: jaga garis lurus dari kepala sampai lutut.',
        'Siku terbuka lebar: rapatkan sampai sekitar 45 derajat.',
        'Kepala turun lebih dulu: turunkan dada dan kepala bersamaan.',
      ],
    },
    {
      id: 'machine_chest_press', src: 'Machine_Bench_Press', en: 'Machine chest press', idn: 'Chest press machine', eq: 'machine', lvl: 'beginner',
      se: [
        'Adjust the seat so the handles are level with the middle of your chest.',
        'Sit with your back flat against the pad and your feet flat on the floor.',
        'Grip the handles and press them forward until your arms are almost straight.',
        'Return slowly until you feel a light stretch across your chest.',
      ],
      si: [
        'Atur jok supaya gagang sejajar dengan bagian tengah dada.',
        'Duduk dengan punggung rata di sandaran dan telapak kaki rata di lantai.',
        'Pegang gagang dan dorong ke depan sampai lengan hampir lurus.',
        'Kembali pelan sampai dada terasa teregang ringan.',
      ],
      me: [
        'Shoulders rolling forward: pull your shoulder blades back and down against the pad.',
        'Locking your elbows hard: stop just short of straight.',
        'Bouncing out of the bottom: control the return.',
      ],
      mi: [
        'Bahu terdorong ke depan: tarik tulang belikat ke belakang dan ke bawah menempel di sandaran.',
        'Mengunci siku dengan keras: berhenti sedikit sebelum lurus penuh.',
        'Memantul dari posisi bawah: kontrol saat kembali.',
      ],
    },
    {
      id: 'db_floor_press', src: 'Dumbbell_Floor_Press', en: 'Dumbbell floor press', idn: 'Floor press dumbbell', eq: 'dumbbell', lvl: 'beginner',
      p: ['chest'], s: ['triceps', 'shoulders'],
      se: [
        'Lie on your back on the floor with your knees bent and a dumbbell in each hand above your chest.',
        'Lower the dumbbells until your upper arms touch the floor.',
        'Pause briefly without relaxing your shoulders.',
        'Press the dumbbells back up until your arms are straight.',
      ],
      si: [
        'Berbaring telentang di lantai dengan lutut ditekuk dan satu dumbbell di tiap tangan di atas dada.',
        'Turunkan dumbbell sampai lengan atas menyentuh lantai.',
        'Berhenti sebentar tanpa merilekskan bahu.',
        'Dorong dumbbell naik lagi sampai lengan lurus.',
      ],
      me: [
        'Elbows flared straight out to the side: angle them to about 45 degrees.',
        'Bouncing off the floor: pause for a moment at the bottom.',
        'Dumbbells drifting apart: keep them above your chest the whole time.',
      ],
      mi: [
        'Siku terbuka lurus ke samping: arahkan sekitar 45 derajat.',
        'Memantul dari lantai: berhenti sebentar di bawah.',
        'Dumbbell menjauh satu sama lain: jaga tetap di atas dada sepanjang gerakan.',
      ],
    },
    {
      id: 'band_chest_press', src: 'Bench_Press_-_With_Bands', en: 'Banded chest press', idn: 'Chest press pakai band', eq: 'band', lvl: 'beginner',
      se: [
        'Wrap a resistance band behind your upper back and hold an end in each hand at chest height.',
        'Get into a stable stance with one foot slightly forward.',
        'Press both hands forward until your arms are almost straight.',
        'Bring your hands back slowly against the band.',
      ],
      si: [
        'Lingkarkan resistance band di belakang punggung atas dan pegang tiap ujungnya setinggi dada.',
        'Ambil kuda-kuda yang stabil dengan satu kaki sedikit di depan.',
        'Dorong kedua tangan ke depan sampai lengan hampir lurus.',
        'Kembalikan tangan pelan-pelan melawan tarikan band.',
      ],
      me: [
        'Letting the band snap back: control the return.',
        'Shrugging your shoulders: keep them down and away from your ears.',
        'Band riding up your neck: keep it under your shoulder blades.',
      ],
      mi: [
        'Membiarkan band menyentak balik: kontrol saat kembali.',
        'Bahu terangkat: jaga tetap turun dan jauh dari telinga.',
        'Band naik ke leher: jaga di bawah tulang belikat.',
      ],
    },
    {
      id: 'db_bench_press', src: 'Dumbbell_Bench_Press', en: 'Dumbbell bench press', idn: 'Dumbbell bench press', eq: 'dumbbell', lvl: 'beginner', home: false, img: [114, 113],
      se: [
        'Sit on a flat bench with a dumbbell on each thigh, then lie back and bring them to your chest.',
        'Plant your feet on the floor and pull your shoulder blades together.',
        'Press the dumbbells up until your arms are straight above your chest.',
        'Lower them slowly until your elbows are slightly below the bench.',
      ],
      si: [
        'Duduk di bangku datar dengan satu dumbbell di tiap paha, lalu berbaring dan bawa ke dada.',
        'Tapakkan kaki di lantai dan tarik kedua tulang belikat ke belakang.',
        'Dorong dumbbell naik sampai lengan lurus di atas dada.',
        'Turunkan pelan-pelan sampai siku sedikit di bawah bangku.',
      ],
      me: [
        'Arching your back off the bench: keep your glutes and shoulders on the bench.',
        'Elbows flared at 90 degrees: tuck them to about 45 degrees.',
        'Dropping the dumbbells fast: lower for two seconds.',
      ],
      mi: [
        'Punggung melengkung lepas dari bangku: jaga bokong dan bahu menempel di bangku.',
        'Siku terbuka 90 derajat: rapatkan sampai sekitar 45 derajat.',
        'Menjatuhkan dumbbell dengan cepat: turunkan dalam dua detik.',
      ],
    },
    {
      id: 'close_grip_push_up', src: 'Push-Ups_-_Close_Triceps_Position', en: 'Close-grip push-up', idn: 'Push-up tangan rapat', eq: 'bodyweight', lvl: 'intermediate', img: [326],
      se: [
        'Start in a push-up position with your hands directly under your shoulders or slightly closer.',
        'Keep your body in a straight line from head to heels.',
        'Lower your chest with your elbows brushing your sides.',
        'Push up until your arms are straight.',
      ],
      si: [
        'Mulai dengan posisi push-up, tangan tepat di bawah bahu atau sedikit lebih rapat.',
        'Jaga tubuh dalam garis lurus dari kepala sampai tumit.',
        'Turunkan dada dengan siku menyentuh sisi badan.',
        'Dorong naik sampai lengan lurus.',
      ],
      me: [
        'Hands so close that your wrists hurt: place them at shoulder width.',
        'Elbows flaring out: keep them tucked against your ribs.',
        'Hips sagging: tighten your abs and glutes.',
      ],
      mi: [
        'Tangan terlalu rapat sampai pergelangan nyeri: letakkan selebar bahu.',
        'Siku melebar: jaga tetap rapat ke tulang rusuk.',
        'Pinggul turun: kencangkan perut dan bokong.',
      ],
    },
    {
      id: 'decline_push_up', src: 'Decline_Push-Up', en: 'Decline push-up', idn: 'Decline push-up', eq: 'bodyweight', lvl: 'intermediate', img: [357],
      se: [
        'Put your feet on a sturdy bench or step and your hands on the floor slightly wider than your shoulders.',
        'Keep your body in a straight line from head to heels.',
        'Bend your elbows to lower your chest toward the floor.',
        'Push the floor away until your arms are straight.',
      ],
      si: [
        'Letakkan kaki di bangku atau pijakan yang kokoh dan tangan di lantai sedikit lebih lebar dari bahu.',
        'Jaga tubuh dalam garis lurus dari kepala sampai tumit.',
        'Tekuk siku untuk menurunkan dada ke lantai.',
        'Dorong lantai menjauh sampai lengan lurus.',
      ],
      me: [
        'Hips piking up: keep your abs tight so your body stays in one line.',
        'Elbows flaring: keep them at about 45 degrees.',
        'Starting too high: use a lower step or return to the regular push-up first.',
      ],
      mi: [
        'Pinggul naik: kencangkan perut supaya tubuh tetap satu garis.',
        'Siku melebar: jaga sekitar 45 derajat.',
        'Mulai terlalu tinggi: pakai pijakan lebih rendah atau kembali ke push-up biasa dulu.',
      ],
    },
    {
      id: 'barbell_bench_press', src: 'Barbell_Bench_Press_-_Medium_Grip', en: 'Barbell bench press', idn: 'Bench press', eq: 'barbell', lvl: 'intermediate', home: false, img: [70, 68],
      se: [
        'Lie on a flat bench with your eyes under the bar, your feet on the floor and your shoulder blades pulled together.',
        'Grip the bar a little wider than your shoulders and unrack it over your chest.',
        'Lower the bar slowly to your mid-chest.',
        'Press the bar up until your arms are straight.',
        'Rack the bar before you let go, and use a spotter or safety arms for heavy sets.',
      ],
      si: [
        'Berbaring di bangku datar dengan mata tepat di bawah bar, kaki di lantai, dan tulang belikat ditarik rapat.',
        'Pegang bar sedikit lebih lebar dari bahu dan angkat dari rak ke atas dada.',
        'Turunkan bar pelan-pelan ke tengah dada.',
        'Dorong bar naik sampai lengan lurus.',
        'Kembalikan bar ke rak sebelum melepas, dan pakai spotter atau pengaman untuk set berat.',
      ],
      me: [
        'Bouncing the bar off your chest: lower it under control and touch lightly.',
        'Lifting your hips off the bench: keep your feet planted and your glutes down.',
        'Pressing without a spotter: set the safety arms at a height that catches the bar.',
      ],
      mi: [
        'Memantulkan bar di dada: turunkan terkontrol dan sentuh dengan ringan.',
        'Pinggul terangkat dari bangku: tapakkan kaki dan jaga bokong tetap turun.',
        'Menekan tanpa spotter: atur pengaman pada ketinggian yang menahan bar.',
      ],
    },
    {
      id: 'incline_db_press', src: 'Incline_Dumbbell_Press', en: 'Incline dumbbell press', idn: 'Incline dumbbell press', eq: 'dumbbell', lvl: 'intermediate', home: false, img: [106, 105],
      se: [
        'Set a bench to a slight incline of about 30 degrees and sit with a dumbbell on each thigh.',
        'Lie back, bring the dumbbells to your shoulders and pull your shoulder blades together.',
        'Press the dumbbells up until your arms are straight above your chest.',
        'Lower them slowly to the sides of your upper chest.',
      ],
      si: [
        'Atur bangku ke kemiringan ringan sekitar 30 derajat dan duduk dengan dumbbell di tiap paha.',
        'Berbaring, bawa dumbbell ke bahu, dan tarik kedua tulang belikat ke belakang.',
        'Dorong dumbbell naik sampai lengan lurus di atas dada.',
        'Turunkan pelan-pelan ke sisi dada bagian atas.',
      ],
      me: [
        'Bench set too steep: lower the incline so your chest does the work, not your shoulders.',
        'Elbows flaring wide: tuck them to about 45 degrees.',
        'Dumbbells clashing at the top: stop with them just above your chest.',
      ],
      mi: [
        'Bangku terlalu curam: turunkan kemiringan supaya dada yang bekerja, bukan bahu.',
        'Siku terbuka lebar: rapatkan sampai sekitar 45 derajat.',
        'Dumbbell saling berbenturan di atas: berhenti saat berada tepat di atas dada.',
      ],
    },
    {
      id: 'cable_crossover', src: 'Cable_Crossover', en: 'Cable crossover', idn: 'Cable crossover', eq: 'cable', lvl: 'intermediate', img: [128, 127],
      se: [
        'Set both pulleys high, hold a handle in each hand and step forward into a split stance.',
        'Lean forward slightly and start with your arms out to the sides with soft elbows.',
        'Bring your hands down and together in front of your hips in a wide arc.',
        'Squeeze your chest for a second, then open your arms back up slowly.',
      ],
      si: [
        'Pasang kedua katrol di atas, pegang satu gagang di tiap tangan, dan melangkah maju dengan kuda-kuda terbelah.',
        'Condongkan badan sedikit ke depan dan mulai dengan lengan terbuka ke samping, siku sedikit ditekuk.',
        'Bawa kedua tangan turun dan bertemu di depan pinggul dengan lengkungan lebar.',
        'Tahan sebentar sambil mengencangkan dada, lalu buka lengan lagi dengan pelan.',
      ],
      me: [
        'Pulling with your arms bending: keep the same soft elbow bend throughout.',
        'Letting the cables yank your shoulders forward: use a lighter weight and control the way back.',
        'Rocking your torso: brace your core and stay still.',
      ],
      mi: [
        'Menarik sambil menekuk lengan: jaga tekukan siku yang sama sepanjang gerakan.',
        'Kabel menarik bahu ke depan: pakai beban lebih ringan dan kontrol saat kembali.',
        'Badan bergoyang: kencangkan perut dan tetap stabil.',
      ],
    },
  ],

  push_v: [
    {
      id: 'db_shoulder_press', src: 'Seated_Dumbbell_Press', en: 'Dumbbell shoulder press', idn: 'Shoulder press dumbbell', eq: 'dumbbell', lvl: 'beginner', img: [174, 173],
      se: [
        'Sit on a chair or bench with your back straight and hold a dumbbell at each shoulder.',
        'Brace your core and keep your ribs down.',
        'Press the dumbbells straight up until your arms are almost straight.',
        'Lower them slowly back to shoulder height.',
      ],
      si: [
        'Duduk di kursi atau bangku dengan punggung tegak dan pegang dumbbell di tiap bahu.',
        'Kencangkan perut dan jaga tulang rusuk tetap turun.',
        'Dorong dumbbell lurus ke atas sampai lengan hampir lurus.',
        'Turunkan pelan-pelan kembali setinggi bahu.',
      ],
      me: [
        'Arching your lower back: tighten your abs and press straight up.',
        'Pressing the dumbbells forward: move them in a line above your shoulders.',
        'Shrugging at the top: keep your neck long.',
      ],
      mi: [
        'Punggung bawah melengkung: kencangkan perut dan dorong lurus ke atas.',
        'Mendorong dumbbell ke depan: gerakkan dalam garis lurus di atas bahu.',
        'Bahu terangkat di atas: jaga leher tetap panjang.',
      ],
    },
    {
      id: 'pike_push_up', src: 'own', en: 'Pike push-up', idn: 'Pike push-up', eq: 'bodyweight', lvl: 'intermediate',
      p: ['shoulders'], s: ['triceps', 'chest', 'traps'],
      se: [
        'Start in a push-up position, then walk your feet in so your hips lift into an upside-down V.',
        'Keep your arms and legs nearly straight.',
        'Bend your elbows to lower the top of your head toward the floor between your hands.',
        'Push the floor away to return to the V shape.',
      ],
      si: [
        'Mulai dengan posisi push-up, lalu jalankan kaki mendekat sampai pinggul terangkat membentuk huruf V terbalik.',
        'Jaga lengan dan kaki hampir lurus.',
        'Tekuk siku untuk menurunkan puncak kepala ke lantai di antara kedua tangan.',
        'Dorong lantai menjauh untuk kembali ke bentuk V.',
      ],
      me: [
        'Hips drop into a regular push-up: keep your hips high and your head moving down.',
        'Flaring your elbows wide: keep them at about 45 degrees.',
        'Lowering fast onto your head: lower slowly and stop before you touch the floor.',
      ],
      mi: [
        'Pinggul turun jadi push-up biasa: jaga pinggul tinggi dan kepala yang bergerak turun.',
        'Siku melebar: jaga sekitar 45 derajat.',
        'Turun cepat ke arah kepala: turun pelan dan berhenti sebelum menyentuh lantai.',
      ],
    },
    {
      id: 'db_lateral_raise', src: 'Side_Lateral_Raise', en: 'Dumbbell lateral raise', idn: 'Lateral raise', eq: 'dumbbell', lvl: 'beginner', img: [178, 177],
      se: [
        'Stand tall holding a light dumbbell in each hand at your sides.',
        'Keep a slight bend in your elbows and lift your arms out to the sides.',
        'Stop when your hands reach shoulder height.',
        'Lower the dumbbells slowly.',
      ],
      si: [
        'Berdiri tegak sambil memegang dumbbell ringan di tiap tangan di sisi tubuh.',
        'Tekuk siku sedikit dan angkat kedua lengan ke samping.',
        'Berhenti saat tangan setinggi bahu.',
        'Turunkan dumbbell pelan-pelan.',
      ],
      me: [
        'Swinging the weight with your body: use lighter dumbbells and stand still.',
        'Lifting above shoulder height with shrugged shoulders: stop at shoulder height.',
        'Leading with your hands: lead with your elbows.',
      ],
      mi: [
        'Mengayun beban dengan badan: pakai dumbbell lebih ringan dan berdiri diam.',
        'Mengangkat di atas bahu sambil mengangkat bahu: berhenti setinggi bahu.',
        'Tangan yang memimpin: pimpin dengan siku.',
      ],
    },
    {
      id: 'band_shoulder_press', src: 'Shoulder_Press_-_With_Bands', en: 'Banded shoulder press', idn: 'Shoulder press pakai band', eq: 'band', lvl: 'beginner',
      se: [
        'Stand on the middle of a resistance band and hold the ends at shoulder height with your palms forward.',
        'Brace your core and keep your ribs down.',
        'Press your hands straight up until your arms are almost straight.',
        'Lower them slowly back to your shoulders.',
      ],
      si: [
        'Berdiri di tengah resistance band dan pegang kedua ujungnya setinggi bahu dengan telapak menghadap depan.',
        'Kencangkan perut dan jaga tulang rusuk tetap turun.',
        'Dorong tangan lurus ke atas sampai lengan hampir lurus.',
        'Turunkan pelan-pelan kembali ke bahu.',
      ],
      me: [
        'Leaning back as you press: tighten your abs and stand tall.',
        'Band slipping from under your feet: step on it with your whole foot.',
        'Letting the band snap down: control the lowering.',
      ],
      mi: [
        'Bersandar ke belakang saat menekan: kencangkan perut dan berdiri tegak.',
        'Band terlepas dari bawah kaki: injak dengan seluruh telapak kaki.',
        'Membiarkan band menyentak turun: kontrol saat menurunkan.',
      ],
    },
    {
      id: 'machine_shoulder_press', src: 'Machine_Shoulder_Military_Press', en: 'Machine shoulder press', idn: 'Shoulder press machine', eq: 'machine', lvl: 'beginner', img: [196, 195],
      se: [
        'Adjust the seat so the handles are at shoulder height when you sit.',
        'Sit with your back against the pad and your feet flat on the floor.',
        'Press the handles up until your arms are almost straight.',
        'Lower them slowly until your hands are at shoulder level.',
      ],
      si: [
        'Atur jok supaya gagang setinggi bahu saat kamu duduk.',
        'Duduk dengan punggung menempel di sandaran dan telapak kaki rata di lantai.',
        'Dorong gagang ke atas sampai lengan hampir lurus.',
        'Turunkan pelan-pelan sampai tangan setinggi bahu.',
      ],
      me: [
        'Arching your back off the pad: keep your lower back against it.',
        'Shrugging toward your ears: keep your shoulders down.',
        'Locking your elbows hard: stop just short of straight.',
      ],
      mi: [
        'Punggung melengkung lepas dari sandaran: jaga punggung bawah tetap menempel.',
        'Bahu naik ke arah telinga: jaga bahu tetap turun.',
        'Mengunci siku dengan keras: berhenti sedikit sebelum lurus penuh.',
      ],
    },
    {
      id: 'barbell_overhead_press', src: 'Standing_Military_Press', en: 'Barbell overhead press', idn: 'Overhead press', eq: 'barbell', lvl: 'intermediate', home: false, img: [647],
      se: [
        'Hold the bar at shoulder height with your hands just outside your shoulders and your elbows slightly in front of the bar.',
        'Stand with your feet hip-width apart and squeeze your glutes and abs.',
        'Press the bar straight up, moving your head slightly back, then forward once the bar passes your forehead.',
        'Lock out the bar over your mid-foot with your arms straight.',
        'Lower the bar slowly to your shoulders.',
      ],
      si: [
        'Pegang bar setinggi bahu dengan tangan sedikit di luar bahu dan siku sedikit di depan bar.',
        'Berdiri dengan kaki selebar pinggul dan kencangkan bokong dan perut.',
        'Dorong bar lurus ke atas, kepala sedikit ke belakang, lalu maju lagi setelah bar melewati dahi.',
        'Kunci bar di atas tengah telapak kaki dengan lengan lurus.',
        'Turunkan bar pelan-pelan ke bahu.',
      ],
      me: [
        'Leaning back and turning it into a bench press: squeeze your glutes and abs and keep your ribs down.',
        'Pushing the bar forward in an arc: move it in a straight line over your mid-foot.',
        'Starting too heavy: reduce the weight until your back stays straight.',
      ],
      mi: [
        'Bersandar ke belakang sehingga jadi seperti bench press: kencangkan bokong dan perut dan jaga tulang rusuk turun.',
        'Mendorong bar ke depan dengan lengkungan: gerakkan dalam garis lurus di atas tengah telapak kaki.',
        'Mulai dengan beban terlalu berat: kurangi beban sampai punggung tetap lurus.',
      ],
    },
  ],

  pull_h: [
    {
      id: 'one_arm_db_row', src: 'One-Arm_Dumbbell_Row', en: 'One-arm dumbbell row', idn: 'One-arm dumbbell row', eq: 'dumbbell', lvl: 'beginner', img: [410],
      se: [
        'Place one hand and the same-side knee on a bench or sturdy chair, with your other foot on the floor.',
        'Hold a dumbbell in your free hand with your arm hanging straight down and keep your back flat.',
        'Pull the dumbbell toward your hip by driving your elbow back.',
        'Squeeze your shoulder blade for a second.',
        'Lower the dumbbell slowly until your arm is straight, then switch sides after your reps.',
      ],
      si: [
        'Letakkan satu tangan dan lutut di sisi yang sama di bangku atau kursi kokoh, kaki satunya di lantai.',
        'Pegang dumbbell di tangan bebas dengan lengan menggantung lurus ke bawah dan punggung lurus.',
        'Tarik dumbbell ke arah pinggul dengan mendorong siku ke belakang.',
        'Kencangkan tulang belikat selama satu detik.',
        'Turunkan dumbbell pelan sampai lengan lurus, lalu ganti sisi setelah repetisi selesai.',
      ],
      me: [
        'Twisting your torso to lift: keep your shoulders square to the floor.',
        'Pulling with your arm and shrugging: lead with your elbow and keep your shoulder down.',
        'Rounding your back: look slightly ahead of your hand and keep your spine flat.',
      ],
      mi: [
        'Memutar badan untuk mengangkat: jaga bahu tetap rata menghadap lantai.',
        'Menarik dengan lengan sambil mengangkat bahu: pimpin dengan siku dan jaga bahu tetap turun.',
        'Punggung membulat: pandang sedikit di depan tanganmu dan jaga tulang belakang lurus.',
      ],
    },
    {
      id: 'band_row', src: 'own', en: 'Banded row', idn: 'Row pakai band', eq: 'band', lvl: 'beginner',
      p: ['middle_back', 'lats'], s: ['biceps', 'shoulders'],
      se: [
        'Sit on the floor with your legs straight and loop a resistance band around your feet.',
        'Hold the ends with both hands and sit tall with your arms straight.',
        'Pull your elbows back and squeeze your shoulder blades together.',
        'Return slowly with your arms straight again.',
      ],
      si: [
        'Duduk di lantai dengan kaki lurus dan kaitkan resistance band di telapak kaki.',
        'Pegang kedua ujung dengan dua tangan dan duduk tegak dengan lengan lurus.',
        'Tarik siku ke belakang dan rapatkan kedua tulang belikat.',
        'Kembali pelan sampai lengan lurus lagi.',
      ],
      me: [
        'Leaning back as you pull: sit tall and keep your torso still.',
        'Shrugging your shoulders: keep them down and pull with your back.',
        'Letting the band snap forward: control the return.',
      ],
      mi: [
        'Bersandar ke belakang saat menarik: duduk tegak dan jaga badan tetap diam.',
        'Mengangkat bahu: jaga tetap turun dan tarik memakai punggung.',
        'Membiarkan band menyentak ke depan: kontrol saat kembali.',
      ],
    },
    {
      id: 'seated_cable_row', src: 'Seated_Cable_Rows', en: 'Seated cable row', idn: 'Seated cable row', eq: 'cable', lvl: 'beginner',
      se: [
        'Sit at the cable station with your feet on the platform and your knees slightly bent.',
        'Hold the handle with straight arms and sit tall with a flat back.',
        'Pull the handle to your lower ribs by driving your elbows back.',
        'Squeeze your shoulder blades together for a second.',
        'Let your arms straighten slowly without rounding your back.',
      ],
      si: [
        'Duduk di stasiun kabel dengan kaki di pijakan dan lutut sedikit ditekuk.',
        'Pegang gagang dengan lengan lurus, duduk tegak, dan punggung lurus.',
        'Tarik gagang ke tulang rusuk bawah dengan mendorong siku ke belakang.',
        'Rapatkan kedua tulang belikat selama satu detik.',
        'Biarkan lengan lurus kembali pelan-pelan tanpa membulatkan punggung.',
      ],
      me: [
        'Rocking your torso back and forth: keep your torso still and lighten the weight.',
        'Rounding forward at the stretch: stay tall and only stretch as far as your back stays flat.',
        'Pulling with your biceps: think about driving your elbows back.',
      ],
      mi: [
        'Badan mengayun maju mundur: jaga badan diam dan ringankan beban.',
        'Membungkuk saat teregang: tetap tegak dan teregang hanya sejauh punggung tetap lurus.',
        'Menarik dengan bisep: bayangkan mendorong siku ke belakang.',
      ],
    },
    {
      id: 'band_pull_apart', src: 'Band_Pull_Apart', en: 'Band pull-apart', idn: 'Band pull-apart', eq: 'band', lvl: 'beginner',
      se: [
        'Hold a resistance band in front of you at chest height with your hands shoulder-width apart.',
        'Keep your arms nearly straight and your ribs down.',
        'Pull the band apart by moving your hands out to the sides until the band touches your chest.',
        'Return slowly with control.',
      ],
      si: [
        'Pegang resistance band di depanmu setinggi dada dengan tangan selebar bahu.',
        'Jaga lengan hampir lurus dan tulang rusuk tetap turun.',
        'Tarik band terbuka dengan menggerakkan tangan ke samping sampai band menyentuh dada.',
        'Kembali pelan dengan terkontrol.',
      ],
      me: [
        'Shrugging your shoulders: keep them down.',
        'Arching your lower back: tighten your abs and stand tall.',
        'Band too heavy so your arms bend: use a lighter band.',
      ],
      mi: [
        'Bahu terangkat: jaga tetap turun.',
        'Punggung bawah melengkung: kencangkan perut dan berdiri tegak.',
        'Band terlalu berat sampai lengan menekuk: pakai band yang lebih ringan.',
      ],
    },
    {
      id: 'band_face_pull', src: 'Face_Pull', en: 'Banded face pull', idn: 'Face pull pakai band', eq: 'band', lvl: 'beginner',
      p: ['shoulders', 'middle_back'], s: ['traps'],
      se: [
        'Anchor a resistance band at about face height and hold an end in each hand with your arms straight.',
        'Step back until the band is tight and stand with your feet shoulder-width apart.',
        'Pull your hands toward your face with your elbows high and wide.',
        'Squeeze your shoulder blades together for a second.',
        'Let your arms straighten slowly.',
      ],
      si: [
        'Pasang resistance band di titik setinggi wajah dan pegang satu ujung di tiap tangan dengan lengan lurus.',
        'Mundur sampai band kencang dan berdiri dengan kaki selebar bahu.',
        'Tarik tangan ke arah wajah dengan siku tinggi dan terbuka lebar.',
        'Rapatkan kedua tulang belikat selama satu detik.',
        'Biarkan lengan lurus kembali pelan-pelan.',
      ],
      me: [
        'Leaning back to pull: stand tall and step closer or use a lighter band.',
        'Elbows dropping low: keep them at about shoulder height.',
        'Shrugging your shoulders: keep them down.',
      ],
      mi: [
        'Bersandar ke belakang untuk menarik: berdiri tegak dan maju sedikit atau pakai band lebih ringan.',
        'Siku turun rendah: jaga sekitar setinggi bahu.',
        'Bahu terangkat: jaga tetap turun.',
      ],
    },
    {
      id: 'machine_row', src: 'Leverage_Iso_Row', en: 'Machine row', idn: 'Row machine', eq: 'machine', lvl: 'beginner', img: [598],
      se: [
        'Adjust the seat so you can reach the handles with your arms straight and your chest against the pad.',
        'Grip the handles and pull your shoulders back.',
        'Pull the handles toward your torso by driving your elbows back.',
        'Squeeze your shoulder blades together for a second.',
        'Return slowly until your arms are straight.',
      ],
      si: [
        'Atur jok supaya kamu bisa meraih gagang dengan lengan lurus dan dada menempel di bantalan.',
        'Pegang gagang dan tarik bahu ke belakang.',
        'Tarik gagang ke arah badan dengan mendorong siku ke belakang.',
        'Rapatkan kedua tulang belikat selama satu detik.',
        'Kembali pelan sampai lengan lurus.',
      ],
      me: [
        'Shrugging your shoulders: keep them down and away from your ears.',
        'Leaning back to pull: keep your chest against the pad.',
        'Letting the weights drop back: control the return.',
      ],
      mi: [
        'Bahu terangkat: jaga tetap turun dan jauh dari telinga.',
        'Bersandar ke belakang untuk menarik: jaga dada menempel di bantalan.',
        'Membiarkan beban jatuh kembali: kontrol saat kembali.',
      ],
    },
    {
      id: 'chest_supported_db_row', src: 'Dumbbell_Incline_Row', en: 'Chest-supported dumbbell row', idn: 'Chest-supported row dumbbell', eq: 'dumbbell', lvl: 'beginner', home: false, img: [459],
      se: [
        'Set a bench to a slight incline and lie face down on it with your chest against the pad.',
        'Hold a dumbbell in each hand with your arms hanging straight down.',
        'Pull both dumbbells toward your hips by driving your elbows back.',
        'Squeeze your shoulder blades together for a second.',
        'Lower slowly until your arms are straight.',
      ],
      si: [
        'Atur bangku ke kemiringan ringan dan berbaring tengkurap dengan dada menempel di bantalan.',
        'Pegang dumbbell di tiap tangan dengan lengan menggantung lurus ke bawah.',
        'Tarik kedua dumbbell ke arah pinggul dengan mendorong siku ke belakang.',
        'Rapatkan kedua tulang belikat selama satu detik.',
        'Turunkan pelan sampai lengan lurus.',
      ],
      me: [
        'Lifting your chest off the pad: keep it on the bench.',
        'Shrugging your shoulders: keep them down.',
        'Using momentum: lighten the dumbbells and pull smoothly.',
      ],
      mi: [
        'Dada terangkat dari bantalan: jaga tetap menempel di bangku.',
        'Bahu terangkat: jaga tetap turun.',
        'Memakai momentum: ringankan dumbbell dan tarik dengan halus.',
      ],
    },
    {
      id: 'inverted_row', src: 'Inverted_Row', en: 'Inverted row', idn: 'Inverted row', eq: 'bar', lvl: 'beginner', home: false, img: [428],
      se: [
        'Set a bar in a rack at about hip height and lie underneath it, holding the bar with an overhand grip a little wider than your shoulders.',
        'Straighten your body with your heels on the floor and your arms straight.',
        'Pull your chest toward the bar while keeping your body in a straight line.',
        'Lower yourself slowly until your arms are straight.',
      ],
      si: [
        'Pasang bar di rak setinggi pinggul dan berbaring di bawahnya, pegang bar dengan genggaman dari atas sedikit lebih lebar dari bahu.',
        'Luruskan tubuh dengan tumit di lantai dan lengan lurus.',
        'Tarik dada ke arah bar sambil menjaga tubuh dalam garis lurus.',
        'Turunkan badan pelan sampai lengan lurus.',
      ],
      me: [
        'Hips sagging: squeeze your glutes and abs to keep one line.',
        'Not reaching the bar: raise the bar or bend your knees to make it easier.',
        'Pulling with your neck stretched forward: keep your chin tucked.',
      ],
      mi: [
        'Pinggul turun: kencangkan bokong dan perut untuk menjaga satu garis.',
        'Tidak sampai ke bar: naikkan bar atau tekuk lutut supaya lebih mudah.',
        'Menarik dengan leher menjulur ke depan: jaga dagu tetap ditarik.',
      ],
    },
    {
      id: 'barbell_bent_over_row', src: 'Bent_Over_Barbell_Row', en: 'Barbell bent-over row', idn: 'Barbell row', eq: 'barbell', lvl: 'intermediate', home: false, img: [90, 84],
      se: [
        'Hold a barbell with an overhand grip just outside your knees and hinge at your hips until your torso is nearly parallel to the floor.',
        'Keep your back flat and your knees slightly bent.',
        'Pull the bar toward your lower ribs by driving your elbows back.',
        'Squeeze your shoulder blades together for a second.',
        'Lower the bar slowly until your arms are straight.',
      ],
      si: [
        'Pegang barbell dengan genggaman dari atas sedikit di luar lutut dan tekuk di pinggul sampai badan hampir sejajar lantai.',
        'Punggung tetap lurus dan lutut sedikit ditekuk.',
        'Tarik bar ke tulang rusuk bawah dengan mendorong siku ke belakang.',
        'Rapatkan kedua tulang belikat selama satu detik.',
        'Turunkan bar pelan sampai lengan lurus.',
      ],
      me: [
        'Standing up as you pull: keep the same torso angle for the whole set.',
        'Rounding your back: lighten the weight and keep your chest proud.',
        'Yanking the bar with momentum: pause briefly at the top and lower under control.',
      ],
      mi: [
        'Badan naik saat menarik: jaga sudut badan yang sama sepanjang set.',
        'Punggung membulat: ringankan beban dan jaga dada tetap membusung.',
        'Menyentak bar dengan momentum: berhenti sebentar di atas dan turunkan dengan terkontrol.',
      ],
    },
  ],

  pull_v: [
    {
      id: 'lat_pulldown', src: 'Wide-Grip_Lat_Pulldown', en: 'Lat pulldown', idn: 'Lat pulldown', eq: 'cable', lvl: 'beginner',
      se: [
        'Sit at the machine with your thighs under the pads and grab the bar with an overhand grip wider than your shoulders.',
        'Lean back slightly and keep your chest up.',
        'Pull the bar down to your upper chest by driving your elbows down and back.',
        'Squeeze your shoulder blades for a second.',
        'Let the bar rise slowly until your arms are straight.',
      ],
      si: [
        'Duduk di mesin dengan paha di bawah bantalan dan pegang bar dari atas lebih lebar dari bahu.',
        'Condongkan badan sedikit ke belakang dan jaga dada tegak.',
        'Tarik bar turun ke dada atas dengan mendorong siku ke bawah dan ke belakang.',
        'Kencangkan tulang belikat selama satu detik.',
        'Biarkan bar naik pelan sampai lengan lurus.',
      ],
      me: [
        'Pulling the bar behind your neck: pull it in front, to your upper chest.',
        'Swinging your whole body: lighten the weight and keep your torso still.',
        'Shrugging toward your ears: pull your shoulders down first.',
      ],
      mi: [
        'Menarik bar ke belakang leher: tarik ke depan, ke dada atas.',
        'Mengayun seluruh badan: ringankan beban dan jaga badan tetap diam.',
        'Bahu naik ke telinga: tarik bahu ke bawah dulu.',
      ],
    },
    {
      id: 'band_lat_pulldown', src: 'own', en: 'Banded lat pulldown', idn: 'Lat pulldown pakai band', eq: 'band', lvl: 'beginner',
      p: ['lats'], s: ['biceps', 'middle_back'],
      se: [
        'Anchor a resistance band above you, such as over a sturdy door, and kneel facing it.',
        'Hold the band with your arms straight above you and your chest up.',
        'Pull your elbows down toward your sides until your hands reach your chest.',
        'Squeeze your shoulder blades for a second.',
        'Let your arms rise slowly back up.',
      ],
      si: [
        'Pasang resistance band di atasmu, misalnya di atas pintu yang kokoh, lalu berlutut menghadapnya.',
        'Pegang band dengan lengan lurus di atasmu dan dada tegak.',
        'Tarik siku turun ke sisi badan sampai tangan mencapai dada.',
        'Kencangkan tulang belikat selama satu detik.',
        'Biarkan lengan naik kembali dengan pelan.',
      ],
      me: [
        'Anchoring on a door that is not secure: check that the band cannot slip or pull the door open.',
        'Leaning far back: stay mostly upright.',
        'Pulling with your hands only: think about driving your elbows down.',
      ],
      mi: [
        'Memasang band di pintu yang tidak aman: pastikan band tidak bisa tergelincir atau menarik pintu terbuka.',
        'Bersandar jauh ke belakang: tetap hampir tegak.',
        'Menarik hanya dengan tangan: bayangkan mendorong siku ke bawah.',
      ],
    },
    {
      id: 'db_pullover', src: 'Straight-Arm_Dumbbell_Pullover', en: 'Dumbbell pullover', idn: 'Pullover dumbbell', eq: 'dumbbell', lvl: 'intermediate',
      p: ['lats'], s: ['chest', 'triceps'],
      se: [
        'Lie on your back on a bench or the floor with your knees bent and hold one dumbbell upright above your chest with both hands.',
        'Keep your elbows slightly bent and lower the dumbbell back over your head in an arc.',
        'Stop when you feel a stretch in your lats and ribs.',
        'Pull the dumbbell back over your chest using your lats.',
      ],
      si: [
        'Berbaring telentang di bangku atau lantai dengan lutut ditekuk dan pegang satu dumbbell tegak di atas dada dengan dua tangan.',
        'Tekuk siku sedikit dan turunkan dumbbell ke belakang kepala dalam lengkungan.',
        'Berhenti saat latmu dan tulang rusuk terasa teregang.',
        'Tarik dumbbell kembali ke atas dada memakai lat.',
      ],
      me: [
        'Going too deep and arching your back: stop where your ribs stay down.',
        'Bending and straightening your elbows: keep the same elbow angle.',
        'Starting too heavy: use a lighter dumbbell and control the stretch.',
      ],
      mi: [
        'Turun terlalu dalam sehingga punggung melengkung: berhenti saat tulang rusuk tetap turun.',
        'Menekuk dan meluruskan siku: jaga sudut siku yang sama.',
        'Mulai dengan beban terlalu berat: pakai dumbbell lebih ringan dan kontrol saat teregang.',
      ],
    },
    {
      id: 'straight_arm_pulldown', src: 'Straight-Arm_Pulldown', en: 'Straight-arm pulldown', idn: 'Straight-arm pulldown', eq: 'cable', lvl: 'beginner', img: [599],
      se: [
        'Stand facing a high cable and hold the bar or rope with straight arms and your hands about shoulder-width apart.',
        'Hinge slightly at your hips and keep your core tight.',
        'Pull the bar down in an arc to your thighs with your arms almost straight.',
        'Squeeze your lats for a second.',
        'Let the bar rise slowly back up.',
      ],
      si: [
        'Berdiri menghadap kabel tinggi dan pegang bar atau tali dengan lengan lurus dan tangan selebar bahu.',
        'Tekuk sedikit di pinggul dan kencangkan perut.',
        'Tarik bar turun dalam lengkungan sampai ke paha dengan lengan hampir lurus.',
        'Kencangkan lat selama satu detik.',
        'Biarkan bar naik pelan kembali.',
      ],
      me: [
        'Bending your elbows into a triceps pushdown: keep the same slight elbow bend.',
        'Swinging your torso: brace your core and keep still.',
        'Letting the bar yank up: control the return.',
      ],
      mi: [
        'Menekuk siku sehingga jadi triceps pushdown: jaga tekukan siku yang sama.',
        'Mengayun badan: kencangkan perut dan diam.',
        'Membiarkan bar tersentak naik: kontrol saat kembali.',
      ],
    },
    {
      id: 'prone_y_raise', src: 'own', en: 'Prone Y raise', idn: 'Y raise tengkurap', eq: 'bodyweight', lvl: 'beginner', timed: false,
      p: ['traps', 'middle_back'], s: ['shoulders', 'lower_back'],
      se: [
        'Lie face down with your arms stretched overhead in a Y shape and your thumbs pointing up.',
        'Keep your forehead near the floor and your neck long.',
        'Lift your arms and chest slightly off the floor by squeezing your upper back.',
        'Hold for a second, then lower slowly.',
      ],
      si: [
        'Berbaring tengkurap dengan lengan terentang di atas kepala membentuk huruf Y dan jempol menghadap atas.',
        'Dahi dekat lantai dan leher tetap panjang.',
        'Angkat lengan dan dada sedikit dari lantai dengan mengencangkan punggung atas.',
        'Tahan satu detik, lalu turun pelan.',
      ],
      me: [
        'Craning your neck up: keep your gaze on the floor.',
        'Lifting with your lower back: lift only a little and lead with your arms.',
        'Shrugging toward your ears: pull your shoulders away from them.',
      ],
      mi: [
        'Mendongak: jaga pandangan ke lantai.',
        'Mengangkat dengan punggung bawah: angkat sedikit saja dan pimpin dengan lengan.',
        'Bahu naik ke telinga: tarik bahu menjauh dari telinga.',
      ],
    },
    {
      id: 'pull_up', src: 'Pullups', en: 'Pull-up', idn: 'Pull-up', eq: 'bar', lvl: 'intermediate', home: false, img: [323],
      se: [
        'Hang from a bar with an overhand grip a little wider than your shoulders and your arms straight.',
        'Pull your shoulder blades down and keep your core tight.',
        'Pull your chest toward the bar by driving your elbows down.',
        'Lower yourself slowly until your arms are straight.',
      ],
      si: [
        'Bergantung di bar dengan genggaman dari atas sedikit lebih lebar dari bahu dan lengan lurus.',
        'Tarik tulang belikat ke bawah dan kencangkan perut.',
        'Tarik dada ke arah bar dengan mendorong siku ke bawah.',
        'Turunkan badan pelan sampai lengan lurus.',
      ],
      me: [
        'Kicking and swinging for momentum: squeeze your glutes and keep your body still.',
        'Half reps: start every rep from a full hang.',
        'Too hard to start: use a band for assistance or lower down slowly instead.',
      ],
      mi: [
        'Menendang dan mengayun untuk momentum: kencangkan bokong dan jaga badan diam.',
        'Setengah repetisi: mulai tiap repetisi dari gantung penuh.',
        'Terlalu berat untuk memulai: pakai band bantu atau cukup turun pelan saja.',
      ],
    },
    {
      id: 'chin_up', src: 'Chin-Up', en: 'Chin-up', idn: 'Chin-up', eq: 'bar', lvl: 'intermediate', home: false, img: [73, 75],
      se: [
        'Hang from a bar with an underhand grip about shoulder-width apart and your arms straight.',
        'Pull your shoulder blades down and keep your core tight.',
        'Pull your chin over the bar by driving your elbows down and back.',
        'Lower yourself slowly until your arms are straight.',
      ],
      si: [
        'Bergantung di bar dengan genggaman dari bawah selebar bahu dan lengan lurus.',
        'Tarik tulang belikat ke bawah dan kencangkan perut.',
        'Tarik dagu melewati bar dengan mendorong siku ke bawah dan ke belakang.',
        'Turunkan badan pelan sampai lengan lurus.',
      ],
      me: [
        'Craning your neck over the bar: keep your head in line and lead with your chest.',
        'Dropping down fast: take about two seconds to lower.',
        'Swinging: tighten your core and keep your legs still.',
      ],
      mi: [
        'Menjulurkan leher melewati bar: jaga kepala sejajar dan pimpin dengan dada.',
        'Turun terlalu cepat: butuh sekitar dua detik untuk turun.',
        'Mengayun: kencangkan perut dan jaga kaki diam.',
      ],
    },
  ],
};
