export interface PartyOutcome {
  readonly id: string;
  readonly title: string;
  readonly headline: string;
  readonly reveal: string;
  readonly alt: string;
  readonly steps: readonly string[];
  readonly image: string;
}
import image_neon_night from "./assets/neon-night.svg";
import image_private_cinema from "./assets/private-cinema.svg";
import image_karaoke from "./assets/karaoke.svg";
import image_mystery_night from "./assets/mystery-night.svg";
import image_surprise_kitchen from "./assets/surprise-kitchen.svg";
import image_game_night from "./assets/game-night.svg";

export const partyOutcomes: readonly PartyOutcome[] = [
  {
    "id": "neon-night",
    "title": "شب نئون و موسیقی",
    "headline": "امشب نوبت درخشیدنه!",
    "reveal": "یه پلی‌لیست خوب، چندتا نور رنگی و کلی خاطرهٔ تازه!",
    "alt": "دو بلندگو، صفحهٔ موسیقی و گوی نورانی در یک اتاق شبانه",
    "steps": [
      "نورهای رنگی ملایم رو آماده کنین.",
      "هر کدوم سه آهنگ به پلی‌لیست اضافه کنین.",
      "خوراکی و نوشیدنی غیرالکلی آماده کنین.",
      "با آهنگ اول، مهمونی رو شروع کنین."
    ],
    "image": image_neon_night
  },
  {
    "id": "private-cinema",
    "title": "سینمای اختصاصی",
    "headline": "به ردیفِ مخصوص خودتون خوش اومدین",
    "reveal": "امشب بهترین صندلیِ سینما، همون جای دنجِ خونه‌ست.",
    "alt": "پردهٔ سینما، مبل دونفره و پاپ‌کورن در نور ملایم",
    "steps": [
      "از بین سه فیلم، یکی رو با هم انتخاب کنین.",
      "پتو و دو تا جای راحت آماده کنین.",
      "پاپ‌کورن درست کنین و نور رو کم کنین.",
      "بعد فیلم، هر کدوم صحنهٔ محبوبتون رو تعریف کنین."
    ],
    "image": image_private_cinema
  },
  {
    "id": "karaoke",
    "title": "کارائوکه دونفره",
    "headline": "صحنه امشب مال شماست",
    "reveal": "خوب خوندن شرط نیست؛ با هم خوندن کافیه!",
    "alt": "میکروفن طلایی روی صحنه با نت‌های موسیقی",
    "steps": [
      "هر کدوم دو آهنگ آشنا انتخاب کنین.",
      "متن ترانه‌ها رو روی نمایشگر باز کنین.",
      "نوبتی یک اجرای کوتاه داشته باشین.",
      "آخر شب یک آهنگ رو دونفره بخونین."
    ],
    "image": image_karaoke
  },
  {
    "id": "mystery-night",
    "title": "شب نقاب و معما",
    "headline": "اولین سرنخ همین‌جاست",
    "reveal": "دو ذهن کنجکاو، یک معما و یک شبِ پر از کشف.",
    "alt": "نقاب بنفش و پاکت سرنخ روی میز با ذره‌بین",
    "steps": [
      "با کاغذ، دو نقاب ساده بسازین.",
      "یک معمای کوتاه مناسب دو نفر پیدا کنین.",
      "سرنخ‌ها رو بلند بخونین و کنار هم بچینین.",
      "با حل معما، عکس یادگاریِ نقاب‌دار بگیرین."
    ],
    "image": image_mystery_night
  },
  {
    "id": "surprise-kitchen",
    "title": "آشپزخونه سورپرایزی",
    "headline": "خاطرهٔ امشب طعم داره",
    "reveal": "یه دستور ساده، دو آشپز و یک نتیجهٔ خوشمزه!",
    "alt": "کاسهٔ همزن و دو دسر با توت روی میز آشپزخانه",
    "steps": [
      "یک دسر ساده و بدون دردسر انتخاب کنین.",
      "مواد رو آماده و کارها رو تقسیم کنین.",
      "دو ظرف دسر رو با سلیقهٔ خودتون تزئین کنین.",
      "نتیجه‌ها رو کنار هم بچینین و مزه کنین."
    ],
    "image": image_surprise_kitchen
  },
  {
    "id": "game-night",
    "title": "رقابت بازی‌های دونفره",
    "headline": "یه رقابت کوچولو، کلی خنده",
    "reveal": "امتیازها فراموش می‌شن؛ لحظه‌های بامزه می‌مونن.",
    "alt": "صفحهٔ بازی دونفره با مهره‌های رنگی و جام کوچک",
    "steps": [
      "یک بازی مناسب دو نفر انتخاب کنین.",
      "قوانین و مدت بازی رو با هم مرور کنین.",
      "سه دور کوتاه با یک استراحتِ خوراکی بازی کنین.",
      "برنده آهنگ بعدی رو انتخاب کنه."
    ],
    "image": image_game_night
  }
];
