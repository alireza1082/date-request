import { useCallback, useEffect, useState, type FormEvent } from "react";
import { moods, type MoodId } from "../../data/moods";
import { AdminApiError, adminRequest, getAdminCsrf } from "./admin-api";

type TelegramStatus = "not_sent" | "attempted" | "accepted" | "failed";
interface HistoryItem {
  readonly event_id: string;
  readonly created_at: string;
  readonly display_name: string | null;
  readonly mood_id: MoodId;
  readonly activity_id: string;
  readonly activity_title: string;
  readonly invitation_used: boolean;
  readonly invitation_title: string | null;
  readonly telegram_status: TelegramStatus;
  readonly telegram_accepted_at: string | null;
  readonly reported_by_visitor: true;
}
interface HistoryResponse { readonly items: readonly HistoryItem[]; readonly total: number; readonly page_size: number; readonly offset: number; readonly reported_events: true; readonly retention_days: number }
interface Stats { readonly reported_events: true; readonly timezone: "UTC"; readonly retention_days: number; readonly total_spins: number; readonly today_spins: number; readonly last_7_days: number; readonly invitation_spins: number; readonly telegram: Readonly<Record<TelegramStatus, number>> }
interface ActivityResponse { readonly activities: readonly { readonly id: string; readonly title: string }[] }
interface Filter { readonly date_from: string; readonly date_to: string; readonly mood_id: string; readonly activity_id: string; readonly invitation_used: string; readonly telegram_status: string }
const emptyFilter: Filter = { date_from: "", date_to: "", mood_id: "", activity_id: "", invitation_used: "", telegram_status: "" };
const pageSize = 20;
const faNumber = new Intl.NumberFormat("fa-IR");
const moodLabels: Readonly<Record<MoodId, string>> = Object.fromEntries(moods.map((mood) => [mood.id, mood.label])) as Record<MoodId, string>;
const telegramLabels: Readonly<Record<TelegramStatus, string>> = { not_sent: "ارسال نشده", attempted: "در حال بررسی", accepted: "پذیرفته‌شده", failed: "ناموفق" };

function queryFor(filters: Filter, offset: number) {
  const query = new URLSearchParams({ page_size: String(pageSize), offset: String(offset) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.toString();
}

export function HistoryManagement() {
  const [filters, setFilters] = useState<Filter>(emptyFilter);
  const [applied, setApplied] = useState<Filter>(emptyFilter);
  const [activities, setActivities] = useState<ActivityResponse["activities"]>([]);
  const [items, setItems] = useState<readonly HistoryItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [retentionDays, setRetentionDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (nextFilters: Filter, nextOffset: number) => {
    setLoading(true); setError(""); setNotice("");
    try {
      const [history, summary] = await Promise.all([
        adminRequest<HistoryResponse>(`/api/admin/history?${queryFor(nextFilters, nextOffset)}`),
        adminRequest<Stats>("/api/admin/history/stats"),
      ]);
      setItems(history.items); setTotal(history.total); setOffset(history.offset); setRetentionDays(history.retention_days); setStats(summary);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تاریخچه بارگذاری نشد."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([
      adminRequest<ActivityResponse>("/api/admin/activities"),
      adminRequest<HistoryResponse>(`/api/admin/history?${queryFor(emptyFilter, 0)}`),
      adminRequest<Stats>("/api/admin/history/stats"),
    ]).then(([activityResponse, history, summary]) => {
      if (!current) return;
      setActivities(activityResponse.activities.filter((activity) => activity));
      setItems(history.items); setTotal(history.total); setOffset(history.offset); setRetentionDays(history.retention_days); setStats(summary); setError("");
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : "تاریخچه بارگذاری نشد."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setApplied(filters); void load(filters, 0);
  };
  const clear = async () => {
    if (clearing || !window.confirm("همهٔ نتیجه‌های ثبت‌شده برای همیشه پاک بشن؟ اطلاعات قرارها و تنظیمات دست‌نخورده می‌مونن.")) return;
    setClearing(true); setError(""); setNotice("");
    try {
      const { csrf_token: csrf } = await getAdminCsrf();
      const result = await adminRequest<{ readonly deleted: number }>("/api/admin/history", { method: "DELETE", body: JSON.stringify({ confirmation: "CLEAR_HISTORY" }) }, csrf);
      await load(applied, 0); setNotice(`${faNumber.format(result.deleted)} نتیجه پاک شد.`);
    } catch (cause) { setError(cause instanceof AdminApiError ? cause.message : "پاک‌کردن تاریخچه انجام نشد."); }
    finally { setClearing(false); }
  };

  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (loading && !stats) return <div className="admin-loading admin-report-loading" role="status"><span className="admin-spinner" />در حال بارگذاری تاریخچه…</div>;

  return <div className="admin-history">
    <section className="admin-history-intro"><div><p className="admin-kicker">فقط نتیجه‌های ثبت‌شده با اجازهٔ بازدیدکننده</p><h2>ردّ قرارهای چرخ</h2><p>نام‌ها اختیاری‌اند؛ این رویدادها از سمت بازدیدکننده ثبت شده‌اند و تأیید مستقلِ چرخش نیستند. زمان‌ها بر اساس UTC نمایش داده می‌شن.</p></div><button className="admin-danger-button" type="button" disabled={clearing || loading || total === 0} onClick={() => void clear()}>{clearing ? "در حال پاک‌کردن…" : "پاک‌کردن تاریخچه"}</button></section>
    {stats && <div className="admin-history-summary"><span><strong>{faNumber.format(stats.total_spins)}</strong> ثبت‌شده</span><span><strong>{faNumber.format(stats.today_spins)}</strong> امروز</span><span><strong>{faNumber.format(stats.last_7_days)}</strong> در هفت روز</span><span><strong>{faNumber.format(stats.invitation_spins)}</strong> دعوت‌نامه</span><span>نگهداری: {faNumber.format(retentionDays)} روز</span></div>}
    <form className="admin-history-filters" onSubmit={submit}>
      <label>از تاریخ (UTC)<input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} /></label>
      <label>تا تاریخ (UTC)<input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} /></label>
      <label>حال‌وهوا<select value={filters.mood_id} onChange={(event) => setFilters({ ...filters, mood_id: event.target.value })}><option value="">همه</option>{moods.map((mood) => <option key={mood.id} value={mood.id}>{mood.label}</option>)}</select></label>
      <label>قرار<select value={filters.activity_id} onChange={(event) => setFilters({ ...filters, activity_id: event.target.value })}><option value="">همه</option>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.title}</option>)}</select></label>
      <label>مسیر دعوت<select value={filters.invitation_used} onChange={(event) => setFilters({ ...filters, invitation_used: event.target.value })}><option value="">همه</option><option value="true">دعوت‌نامه</option><option value="false">عادی</option></select></label>
      <label>تلگرام<select value={filters.telegram_status} onChange={(event) => setFilters({ ...filters, telegram_status: event.target.value })}><option value="">همه</option>{Object.entries(telegramLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <div className="admin-history-filter-actions"><button className="admin-primary" type="submit" disabled={loading}>اعمال فیلتر</button><button className="admin-secondary-button" type="button" disabled={loading} onClick={() => { setFilters(emptyFilter); setApplied(emptyFilter); void load(emptyFilter, 0); }}>پاک‌کردن</button></div>
    </form>
    {error && <p className="admin-alert" role="alert">{error}</p>}{notice && <p className="admin-success" role="status">{notice}</p>}
    {loading ? <div className="admin-loading" role="status"><span className="admin-spinner" />در حال به‌روزرسانی…</div> : items.length === 0 ? <section className="admin-report-empty-card"><span aria-hidden="true">◷</span><h3>هنوز نتیجه‌ای اینجا نیست</h3><p>وقتی بازدیدکننده اجازهٔ ثبت تاریخچه بده، نتیجه‌ها اینجا دیده می‌شن.</p></section> : <>
      <div className="admin-history-table-wrap"><table className="admin-history-table"><thead><tr><th>زمان</th><th>بازدیدکننده</th><th>قرار</th><th>حال‌وهوا</th><th>دعوت</th><th>تلگرام</th></tr></thead><tbody>{items.map((item) => <tr key={item.event_id}><td><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></td><td>{item.display_name || <span className="admin-anonymous-name">بدون نام</span>}</td><td><strong>{item.activity_title}</strong>{item.invitation_title && <small className="admin-history-subtitle">«{item.invitation_title}»</small>}</td><td>{moodLabels[item.mood_id]}</td><td><span className={`admin-history-pill${item.invitation_used ? " is-invitation" : ""}`}>{item.invitation_used ? "دعوت‌نامه" : "عادی"}</span></td><td><span className={`admin-history-pill telegram-${item.telegram_status}`}>{telegramLabels[item.telegram_status]}</span></td></tr>)}</tbody></table></div>
      <div className="admin-history-cards">{items.map((item) => <article className="admin-history-card" key={item.event_id}><div className="admin-history-card-top"><strong>{item.activity_title}</strong><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></div><p>{item.display_name || "بدون نام"} <span>·</span> {moodLabels[item.mood_id]}</p><div><span className="admin-history-pill">{item.invitation_used ? "دعوت‌نامه" : "عادی"}</span><span className={`admin-history-pill telegram-${item.telegram_status}`}>{telegramLabels[item.telegram_status]}</span></div></article>)}</div>
      <nav className="admin-pagination" aria-label="صفحه‌های تاریخچه"><button type="button" disabled={loading || page <= 1} onClick={() => void load(applied, Math.max(0, offset - pageSize))}>قبلی</button><span>صفحهٔ {faNumber.format(page)} از {faNumber.format(pageCount)} · {faNumber.format(total)} نتیجه</span><button type="button" disabled={loading || page >= pageCount} onClick={() => void load(applied, offset + pageSize)}>بعدی</button></nav>
    </>}
  </div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "زمان نامعتبر";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}
