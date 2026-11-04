/** 15 ta fan (bot menyusi va Mini App uchun umumiy): har biri uchun 3 ta namunaviy savol. */
export interface Subject {
  id: string;
  emoji: string;
  name: string;
  examples: readonly [string, string, string];
}

export const SUBJECTS: readonly Subject[] = [
  { id: "mat", emoji: "📐", name: "Matematika", examples: ["x² − 5x + 6 = 0 tenglamani yech", "Pifagor teoremasini tushuntir", "Hosila nima va qanday topiladi?"] },
  { id: "fiz", emoji: "⚛️", name: "Fizika", examples: ["Nyutonning uchta qonunini tushuntir", "Elektr toki qanday hosil bo'ladi?", "Yorug'lik tezligi nimaga teng?"] },
  { id: "kim", emoji: "🧪", name: "Kimyo", examples: ["Mendeleyev davriy jadvali qanday tuzilgan?", "Kislota va asosning farqi nima?", "Suv molekulasi (H₂O) qanday tuzilgan?"] },
  { id: "bio", emoji: "🧬", name: "Biologiya", examples: ["Fotosintez qanday jarayon?", "DNK nima?", "Hujayra qanday tuzilgan?"] },
  { id: "tar", emoji: "🏛", name: "Tarix", examples: ["Amir Temur davlati qanday tashkil topgan?", "Buyuk Ipak yo'li nima?", "Ikkinchi jahon urushining sabablari"] },
  { id: "geo", emoji: "🌍", name: "Geografiya", examples: ["O'zbekistonning tabiiy boyliklari", "Iqlim mintaqalari qanday bo'ladi?", "Orol dengizi muammosi"] },
  { id: "ada", emoji: "📖", name: "Ona tili va adabiyot", examples: ["Navoiyning «Xamsa» asari haqida", "Gapning bosh bo'laklari qaysilar?", "«O'tkan kunlar» romani haqida"] },
  { id: "ing", emoji: "🇬🇧", name: "Ingliz tili", examples: ["Present Perfect qachon ishlatiladi?", "Eng ko'p ishlatiladigan 10 ta fe'l", "«I have been» va «I was» farqi"] },
  { id: "rus", emoji: "🇷🇺", name: "Rus tili", examples: ["Rus tilida kelishiklar", "Fe'lning tugallangan va tugallanmagan turi", "Kundalik hayotda kerak bo'ladigan iboralar"] },
  { id: "inf", emoji: "💻", name: "Informatika", examples: ["Algoritm nima?", "Pythonda birinchi dasturni yozib ber", "Ikkilik sanoq sistemasi qanday ishlaydi?"] },
  { id: "iqt", emoji: "📊", name: "Iqtisodiyot", examples: ["Inflyatsiya nima?", "Talab va taklif qonuni", "Kichik biznesni qanday boshlash mumkin?"] },
  { id: "huq", emoji: "⚖️", name: "Huquq", examples: ["Konstitutsiya nima?", "Fuqarolarning asosiy huquqlari", "Shartnoma qanday tuziladi?"] },
  { id: "fal", emoji: "💭", name: "Falsafa", examples: ["Falsafa nimani o'rganadi?", "Forobiyning «Fozil odamlar shahri» asari", "Suqrot usuli nima?"] },
  { id: "ast", emoji: "🔭", name: "Astronomiya", examples: ["Quyosh sistemasidagi sayyoralar", "Qora tuynuk nima?", "Ulug'bek rasadxonasi haqida"] },
  { id: "tib", emoji: "🩺", name: "Tibbiyot", examples: ["Immunitetni qanday mustahkamlash mumkin?", "Ibn Sinoning «Tib qonunlari» asari", "Sog'lom ovqatlanish asoslari"] },
];

export function findSubject(id: string): Subject | undefined {
  return SUBJECTS.find((s) => s.id === id);
}
