export interface Activity {
  readonly id: string;
  readonly title: string;
  readonly wheelLabel: string;
  readonly description: string;
  readonly emoji: string;
  readonly color: string;
  readonly ink: "light" | "dark";
}

export const activities = [
  {
    id: "cafe",
    title: "کافه‌گردی",
    wheelLabel: "کافه",
    description: "یک میز دنج کنار پنجره، دو فنجان قهوه و حرف‌هایی که تمام نمی‌شوند.",
    emoji: "☕",
    color: "#9d5862",
    ink: "light",
  },
  {
    id: "cinema",
    title: "یک شب سینما",
    wheelLabel: "سینما",
    description: "فیلم را تو انتخاب کن؛ پاپ‌کورنِ دونفره با من.",
    emoji: "🎞️",
    color: "#6a6984",
    ink: "light",
  },
  {
    id: "ice-cream",
    title: "بستنیِ بعد از پیاده‌روی",
    wheelLabel: "بستنی",
    description: "دو تا بستنی خوش‌رنگ و یک دورِ اضافه زیر نورهای شهر.",
    emoji: "🍦",
    color: "#e3a280",
    ink: "dark",
  },
  {
    id: "dinner",
    title: "شامِ دونفره",
    wheelLabel: "شامِ دونفره",
    description: "جایی تازه را امتحان کنیم و برای دسر هم حتماً جا بگذاریم.",
    emoji: "🍝",
    color: "#e0ac73",
    ink: "dark",
  },
  {
    id: "breakfast",
    title: "صبحانهٔ طولانی",
    wheelLabel: "صبحانه",
    description: "یک صبحِ بی‌عجله با نانِ گرم و برنامه‌ای برای هیچ‌جا.",
    emoji: "🥐",
    color: "#dfbd83",
    ink: "dark",
  },
  {
    id: "walk",
    title: "قدم‌زدنِ بی‌مقصد",
    wheelLabel: "قدم‌زدن",
    description: "کمی هوای تازه، دست‌های گرم و هر طرف که دلمان خواست.",
    emoji: "🌿",
    color: "#5d765f",
    ink: "light",
  },
  {
    id: "picnic",
    title: "پیک‌نیکِ کوچک",
    wheelLabel: "پیک‌نیک",
    description: "یک زیرانداز، چند خوراکیِ محبوب و سهمِ مساوی از آفتاب.",
    emoji: "🧺",
    color: "#577571",
    ink: "light",
  },
  {
    id: "bookshop",
    title: "کتاب‌فروشی‌گردی",
    wheelLabel: "کتاب",
    description: "برای هم کتاب انتخاب کنیم و بعد، گوشه‌ای چند صفحه بخوانیم.",
    emoji: "📚",
    color: "#765f7c",
    ink: "light",
  },
  {
    id: "museum",
    title: "یک موزهٔ دوست‌داشتنی",
    wheelLabel: "موزه",
    description: "آرام میان قصه‌های قدیمی بچرخیم و از نگاهِ هم چیز ببینیم.",
    emoji: "🏛️",
    color: "#925b58",
    ink: "light",
  },
  {
    id: "bowling",
    title: "بولینگ و خنده",
    wheelLabel: "بولینگ",
    description: "رقابت کاملاً دوستانه‌ست؛ جایزه‌اش را بازنده انتخاب می‌کند.",
    emoji: "🎳",
    color: "#836943",
    ink: "light",
  },
] as const satisfies readonly Activity[];
