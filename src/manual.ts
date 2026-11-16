export interface ManualSection {
  title: string;
  body: string;
  steps: string[];
  note?: string;
}

export interface ManualTopic {
  id: string;
  title: string;
  summary: string;
  sections: ManualSection[];
}

export const manualTopics: ManualTopic[] = [
  {
    id: 'boyash',
    title: 'Bo‘yash xizmati',
    summary: 'Bo‘yashni alohida xizmat sifatida sotish: bosqich, norma, marshrut, sexga tushirish va bosqich tannarxi.',
    sections: [
      {
        title: '1. Bo‘yash bosqichini yarating',
        body: 'Sozlamalar → Ma’lumotnoma → Operatsiyalar bo‘limida «Bo‘yash» bosqichini m² o‘lchovida yarating. Stavka — bajarilgan ishning tannarxi, u buyurtma tannarxiga tushadi va oylikka qo‘shilmaydi. Mijoz narxi — hisob-fakturaga tushadigan summa. Ikkalasini ham to‘ldiring.',
        steps: [
          'Operatsiyalar ro‘yxatida yangi bosqich qo‘shing: nomi «Bo‘yash», o‘lchov «m²».',
          'Bosqich stavkasi va mijoz narxini yozing, faol xodimlarni belgilang.',
          'Xuddi shu tarzda «Jilolash» bosqichini yarating — marshrut ketma-ket ishlaydi.',
        ],
      },
      {
        title: '2. 1 m² normasini kiriting',
        body: 'Bo‘yash bosqichini tahrirlash oynasida «1 m² uchun norma» bo‘limi chiqadi. Normaga bo‘yoq, qotiruvchi va boshqa sarf materiallarini qo‘shing.',
        steps: [
          '«Norma qo‘shish» tugmasini bosing.',
          '«Poliuretan bo‘yoq · oq» uchun 1 m² sarfini yozing, masalan 0,25 l.',
          '«Qotiruvchi» uchun 0,1 l qo‘shing va saqlang.',
        ],
        note: 'Norma faqat korxona materiallariga yoziladi; mijoz materiali normaga tushmaydi. Normasiz materiallar buyurtmada avtomatik band qilinmaydi.',
      },
      {
        title: '3. Buyurtmaga xizmat qatorini qo‘shing',
        body: 'Savdo → Buyurtma → yangi buyurtma. Mijozni tanlab, pozitsiya qo‘shish orqali alohida xizmat qatorini yarating.',
        steps: [
          'Pozitsiya turi — «Alohida xizmat», nomi — masalan «Fasadni bo‘yash».',
          'Miqdorga bo‘yaladigan maydonni m² da yozing — norma shu miqdorga ko‘paytiriladi.',
          'Marshrutga «Jilolash», keyin «Bo‘yash» bosqichlarini qo‘shing va ijrochilarni tanlang.',
          'Mijoz narxini kiriting va buyurtmani saqlang.',
        ],
        note: 'Narx va bosqich stavkasi ma’lumotnomadan avtomatik olinadi; qo‘lda o‘zgartirsangiz, faqat shu buyurtmaga ta’sir qiladi.',
      },
      {
        title: '4. Sexga tushiring va natijani qabul qiling',
        body: 'Buyurtma qoralamada turadi. Karta ochilgach uni sexga ishga tushiring, materiallarni bering va bosqichlarni yoping.',
        steps: [
          'Buyurtma kartasida «Sexga ishga tushirish» tugmasini bosing.',
          '«Materiallarni berish» yoki «Sexga berish» bilan ombordan sarfni chiqaring.',
          'Xodim natijani topshiradi — qabul qilingan hajm bosqich tannarxi sifatida hisobga olinadi. Jilolash va bo‘yashda qabulni usta qo‘lda tasdiqlaydi.',
        ],
        note: 'Keyingi bosqich oldingisi tugagach ochiladi. Qabul qilingan hajmni pastga tushirib bo‘lmaydi.',
      },
    ],
  },
  {
    id: 'fasadlar',
    title: 'Mijoz fasadlarini buyurtmaga bog‘lash',
    summary: 'Mijoz o‘z fasadlarini olib kelganda ularni alohida qabul qilish, buyurtmaga bog‘lash va boshqa mijozga ishlatmaslik.',
    sections: [
      {
        title: '1. Mijoz materialini yarating',
        body: 'Avval katalogda mijozga tegishli pozitsiya bo‘lishi kerak. Ombor → Tasniflagich → «Pozitsiya» oynasida yarating.',
        steps: [
          'Pozitsiya nomini yozing, masalan «Mijoz fasadi · oshxona».',
          '«Kimning materiallari» maydonida mijozni tanlang — nom yonida «mijozniki» belgisi chiqadi.',
          'Saqlang: mijoz materiali qiymatsiz hisobga olinadi va korxona zaxirasi qiymatiga qo‘shilmaydi.',
        ],
      },
      {
        title: '2. Fasadlarni qabul qiling',
        body: 'Mijoz olib kelgan fasadlar omborga «Mijozdan qabul» orqali kiradi. Bu oynada faqat mijoz materiallari ko‘rinadi.',
        steps: [
          'Ombor → Tasniflagich → «Mijozdan qabul».',
          '«Mijoz materiali» ro‘yxatidan kerakli pozitsiyani tanlang.',
          'Miqdorni va asos hujjatini yozing, so‘ng saqlang.',
        ],
        note: 'Korxona materialini bu yerga qabul qilib bo‘lmaydi — u faqat xarid orqali kiradi.',
      },
      {
        title: '3. Buyurtmaga bog‘lang',
        body: 'Buyurtma mijoziga tegishli materiallargina o‘sha buyurtma pozitsiyasida tanlanadi. Boshqa mijozning materiali ro‘yxatda chiqmaydi.',
        steps: [
          'Savdo → Buyurtma: aynan shu mijozni tanlang.',
          'Pozitsiya materiallari bo‘limida «Qator» tugmasini bosing.',
          'Ro‘yxatdan «mijozniki» belgili fasadni tanlang va miqdorni yozing.',
        ],
        note: 'Mijoz materiali tannarxga kirmaydi, lekin qoldiqdan band qilinadi va sarf sifatida hisobdan chiqadi.',
      },
      {
        title: '4. Qaytarish va nazorat',
        body: 'Buyurtma bekor qilinsa, berilgan materiallar omborga qaytadi. Mijoz materiali boshqa buyurtmaga yoki ombor savdosiga o‘tmaydi.',
        steps: [
          'Harakatlarni Ombor → Qoldiqlar bo‘limida tekshiring.',
          'Mijoz materiali qoldig‘i alohida pozitsiya sifatida yuritiladi.',
          'Kerak bo‘lsa, xuddi shu pozitsiya orqali yangi qabul kiriting.',
        ],
        note: 'Mijoz materiallarini xaridga, retseptga yoki ombor savdosiga qo‘shib bo‘lmaydi.',
      },
    ],
  },
  {
    id: 'lkm',
    title: 'LKM va normalar hisobi',
    summary: 'Bo‘yoq, lak, qotiruvchi va abrazivlarni tasniflash, xarid qilish, norma bo‘yicha band qilish va fakt bo‘yicha chiqim qilish.',
    sections: [
      {
        title: '1. Materiallarni tasniflang',
        body: 'Har bir LKM pozitsiyasi ombor tasniflagichida o‘z kodiga ega bo‘lsin — shunda qoldiq va tannarx hisoboti to‘g‘ri yig‘iladi.',
        steps: [
          'Ombor → Tasniflagich → «Pozitsiya».',
          'Bo‘yoq — 06.01, lak — 06.02, grunt — 06.03, qotiruvchi — 06.04, erituvchi — 06.05, shpaklyovka — 06.06.',
          'Abraziv doiralar — 07.03 guruhi.',
        ],
        note: '06 Bo‘yoq va kimyo guruhi barcha LKM qoldiqlari va hisobotlarini birlashtiradi.',
      },
      {
        title: '2. Xarid va qabul',
        body: 'LKM omborga faqat xarid qabuli orqali kiradi; qabul paytida o‘rtacha tannarx yangilanadi.',
        steps: [
          'Xaridlar → «Xarid»: yetkazib beruvchi va pozitsiyalarni tanlang.',
          '«Materiallarni qabul qilish» orqali kelgan miqdorni kiriting.',
          'Yetkazib beruvchiga qarz «To‘lash» tugmasi bilan yopiladi.',
        ],
      },
      {
        title: '3. Norma va smeta',
        body: 'Bo‘yash yoki jilolash bosqichidagi 1 m² normasi buyurtma yaratilganda material qatorlariga aylanadi va maydonga ko‘paytiriladi.',
        steps: [
          'Sozlamalar → bosqichni tahrirlash → «1 m² uchun norma».',
          'Bo‘yoq, qotiruvchi va abraziv sarfini yozing.',
          'Buyurtmada maydonni m² da kiriting — tizim kerakli miqdorni hisoblaydi va band qiladi.',
        ],
        note: 'Smeta qiymati materialning joriy tannarxi bo‘yicha hisoblanadi. Fakt qiymati material berilganda qayd etiladi.',
      },
      {
        title: '4. Chiqim va qoldiq',
        body: 'Material sexga berilganda qoldiq kamayadi va fakt tannarx buyurtmaga yoziladi.',
        steps: [
          'Buyurtma kartasida «Materiallarni berish» yoki «Sexga berish» tugmasini bosing.',
          'Sarf smetadan farq qilsa, materialni berishdan oldin qator miqdorini tuzating.',
          'Ombor → Qoldiqlar bo‘limida qoldiq va harakatni tekshiring.',
        ],
        note: 'Mijoz materiali normaga va LKM xaridiga qo‘shilmaydi. Qoldiq minimaldan pastga tushsa, Ombor bo‘limi to‘ldirishni eslatadi.',
      },
    ],
  },
];
