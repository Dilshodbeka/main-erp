export interface SupportFaq {
  id: string;
  question: string;
  answer: string;
}

export const supportFaq: SupportFaq[] = [
  {
    id: 'new-order',
    question: 'Qanday qilib yangi buyurtma yarataman?',
    answer: '«Savdo va CRM» bo‘limida «Buyurtma qabul qilish» tugmasini bosing, mijozni tanlang va pozitsiyani to‘ldiring. Saqlangandan so‘ng buyurtmani «Sexga ishga tushirish» orqali ishlab chiqarishga bering.',
  },
  {
    id: 'accept-work',
    question: 'Sexda ishni qanday qabul qilaman?',
    answer: '«Ishlab chiqarish» bo‘limida o‘z topshirig‘ingizni toping va «Topshiriqni qabul qilish» tugmasini bosing. Ish tugagach «Natijani topshirish» orqali miqdorni yuboring.',
  },
  {
    id: 'receive-material',
    question: 'Materialni omborga qanday qabul qilaman?',
    answer: '«Ta’minot» bo‘limida xaridni ochib «Qabul qilish» tugmasini bosing va kelgan miqdorni kiriting. Qoldiq va o‘rtacha tannarx avtomatik yangilanadi.',
  },
  {
    id: 'customer-payment',
    question: 'Kassaga to‘lovni qanday kiritaman?',
    answer: '«Moliya va kassa» bo‘limida «Kirim» tugmasini bosing, mijozni va hisobni tanlang. Saqlangach chek raqami avtomatik beriladi va qarz qoldig‘i kamayadi.',
  },
  {
    id: 'worker-access',
    question: 'Xodimga tizimga kirish huquqini qanday beraman?',
    answer: '«Sozlamalar» → «Kirish» bo‘limida «Yangi kirish» tugmasini bosing va xodimni tanlang. Email va parolni xodimning o‘ziga bering — huquqlar rol bo‘yicha cheklanadi.',
  },
  {
    id: 'salary-advance',
    question: 'Oylik va avans qanday hisoblanadi?',
    answer: '«Oylik va qarzlar» bo‘limida oylik reja va avanslar bir joyda ko‘rinadi. Avans to‘langanda qoldiq shu yerda kamayadi, yakuniy oylik reja asosida hisoblanadi.',
  },
  {
    id: 'offline',
    question: 'Oflayn rejimda nima ishlaydi?',
    answer: 'Oflayn rejimda amallar «Oflayn navbat» ga saqlanadi va internet qaytgach yuboriladi. Kesh 24 soatgacha amal qiladi; shundan keyin yangilash uchun internetga ulaning.',
  },
  {
    id: 'support-contact',
    question: 'Muammo bo‘lsa, kimga murojaat qilaman?',
    answer: '«Yordamchi» → «Murojaat» bo‘limida «Yangi murojaat» tugmasini bosing va muammoni yozing. Diagnostika ma’lumoti avtomatik qo‘shiladi, javobni shu yerda ko‘rasiz.',
  },
];

export function searchFaq(query: string, items: SupportFaq[] = supportFaq): SupportFaq[] {
  const needle = query.toLocaleLowerCase('uz').trim();
  if (!needle) return items;
  return items.filter(item => `${item.question} ${item.answer}`.toLocaleLowerCase('uz').includes(needle));
}
