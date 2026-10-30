import { useEffect, useState } from "react";
import { adminRequest } from "./admin-api";

interface HistoryStats {
  readonly reported_events: true;
  readonly timezone: "UTC";
  readonly retention_days: number;
  readonly total_spins: number;
  readonly today_spins: number;
  readonly last_7_days: number;
  readonly most_selected: readonly { readonly activity_id: string; readonly activity_title: string; readonly count: number }[];
  readonly mood_distribution: Readonly<Record<"surprise" | "calm" | "outdoor", number>>;
  readonly invitation_spins: number;
  readonly telegram: Readonly<Record<"not_sent" | "attempted" | "accepted" | "failed", number>>;
}
interface ActivityListResponse { readonly activities: readonly { readonly enabled: boolean; readonly archived: boolean }[] }
interface Settings { readonly halloween_enabled: boolean }
interface TelegramStatus { readonly configured: boolean; readonly bot_validation: "valid" | "invalid" | "not_checked" }
interface Props { readonly onNavigate: (section: "activities" | "history" | "settings") => void }

const moodCopy = { surprise: "سورپرایزم کن", calm: "یه چیز آروم", outdoor: "بریم بیرون" } as const;
const number = new Intl.NumberFormat("fa-IR");

export function AdminOverview({ onNavigate }: Props) {
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [activeActivities, setActiveActivities] = useState<number | null>(null);
  const [halloween, setHalloween] = useState<boolean | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    void Promise.all([
      adminRequest<HistoryStats>("/api/admin/history/stats"),
      adminRequest<ActivityListResponse>("/api/admin/activities"),
      adminRequest<Settings>("/api/admin/settings"),
      adminRequest<TelegramStatus>("/api/admin/telegram/diagnostics"),
    ]).then(([history, activities, settings, telegramStatus]) => {
      if (!current) return;
      setStats(history);
      setActiveActivities(activities.activities.filter((activity) => activity.enabled && !activity.archived).length);
      setHalloween(settings.halloween_enabled);
      setTelegram(telegramStatus);
      setError("");
    }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : "گزارش پنل بارگذاری نشد.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  if (loading) return <div className="admin-loading admin-report-loading" role="status"><span className="admin-spinner" />در حال آماده‌کردن نمای کلی…</div>;
  if (error || !stats || activeActivities === null || halloween === null || !telegram) return <section className="admin-report-error" role="alert"><h2>گزارش فعلاً در دسترس نیست</h2><p>{error || "بخشی از اطلاعات مدیریتی دریافت نشد."}</p><p>تجربهٔ عمومی همچنان فعال است؛ اتصال API و نشست مدیر را بررسی کن.</p></section>;

  const popularMax = Math.max(1, ...stats.most_selected.map((item) => item.count));
  const moods = Object.entries(stats.mood_distribution) as [keyof typeof moodCopy, number][];
  return <div className="admin-overview">
    <section className="admin-overview-intro"><div><p className="admin-kicker">گزارش قرارهای ثبت‌شده</p><h2>چرخ این روزها چه خبرهایی داشته؟</h2><p>این آمار فقط نتیجه‌هایی رو نشون می‌ده که بازدیدکننده برای ثبت‌شون اجازه داده؛ همهٔ چرخش‌ها قابل مشاهده نیستن.</p></div><span className="admin-overview-seal" aria-hidden="true">✳</span></section>
    <div className="admin-stat-grid">
      <Stat label="همهٔ نتیجه‌های ثبت‌شده" value={stats.total_spins} detail={`نگهداری تا ${number.format(stats.retention_days)} روز · زمان UTC`} glyph="◷" />
      <Stat label="ثبت‌شده‌های امروز" value={stats.today_spins} detail="از نیمه‌شب UTC" glyph="✦" />
      <Stat label="هفت روز اخیر" value={stats.last_7_days} detail="نتیجه‌های رضایت‌داده‌شده" glyph="↗" />
      <Stat label="گزینه‌های فعال چرخ" value={activeActivities} detail="در فهرست مدیریت قرارها" glyph="◉" />
    </div>
    <div className="admin-overview-grid">
      <section className="admin-report-card"><div className="admin-report-card-heading"><div><p className="admin-kicker">از بین نتیجه‌های ثبت‌شده</p><h3>محبوب‌ترین قرارها</h3></div><button className="admin-quiet-link" type="button" onClick={() => onNavigate("history")}>دیدن تاریخچه ←</button></div>
        {stats.most_selected.length === 0 ? <p className="admin-report-empty">هنوز نتیجه‌ای برای گزارش ثبت نشده.</p> : <ol className="admin-popular-list">{stats.most_selected.map((item) => <li key={`${item.activity_id}:${item.activity_title}`}><div className="admin-popular-copy"><strong>{item.activity_title}</strong><span>{number.format(item.count)} بار</span></div><div className="admin-meter" aria-label={`${item.activity_title}: ${item.count}`}><span style={{ width: `${Math.max(6, item.count / popularMax * 100)}%` }} /></div></li>)}</ol>}
      </section>
      <section className="admin-report-card"><div className="admin-report-card-heading"><div><p className="admin-kicker">انتخاب‌های ثبت‌شده</p><h3>حال‌وهواها</h3></div></div>
        <ul className="admin-mood-summary">{moods.map(([id, count]) => <li key={id}><span>{moodCopy[id]}</span><strong>{number.format(count)}</strong></li>)}</ul>
        <div className="admin-report-divider" />
        <div className="admin-summary-line"><span>از مسیر دعوت‌نامه</span><strong>{number.format(stats.invitation_spins)}</strong></div>
        <div className="admin-summary-line"><span>پیام پذیرفته‌شدهٔ تلگرام</span><strong>{number.format(stats.telegram.accepted)}</strong></div>
      </section>
    </div>
    <section className="admin-status-strip"><div><span className={halloween ? "admin-status-dot is-on" : "admin-status-dot"} /><span>تجربهٔ هالووین</span><strong>{halloween ? "روشن" : "خاموش"}</strong><button className="admin-quiet-link" type="button" onClick={() => onNavigate("settings")}>تنظیمات</button></div><div><span className={telegram.configured ? "admin-status-dot is-on" : "admin-status-dot is-off"} /><span>اتصال تلگرام</span><strong>{telegram.configured ? telegram.bot_validation === "valid" ? "ربات بررسی شده" : "نیازمند بررسی" : "تنظیم نشده"}</strong><button className="admin-quiet-link" type="button" onClick={() => onNavigate("settings")}>بررسی</button></div></section>
  </div>;
}

function Stat({ label, value, detail, glyph }: { readonly label: string; readonly value: number; readonly detail: string; readonly glyph: string }) {
  return <article className="admin-stat-card"><span className="admin-stat-glyph" aria-hidden="true">{glyph}</span><p>{label}</p><strong>{number.format(value)}</strong><small>{detail}</small></article>;
}
