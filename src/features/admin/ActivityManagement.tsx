import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import catalog from "../../data/catalog.json";
import { moods, type MoodId } from "../../data/moods";
import type { Activity } from "../../data/activities";
import { DateWheel } from "../wheel/components/DateWheel";
import { useWheelSpin } from "../wheel/hooks/useWheelSpin";
import { getIconArtworkDataUrl } from "../results/activity-artwork-data";
import { AdminApiError, adminRequest, getAdminCsrf } from "./admin-api";
import "./activity-management.css";

interface AdminActivity extends Activity {
  readonly sortOrder: number;
  readonly moods: readonly MoodId[];
  readonly enabled: boolean;
  readonly archived: boolean;
}

interface ActivityIcon {
  readonly id: string;
  readonly label: string;
  readonly category: string;
}

interface ActivityDraft {
  id: string;
  title: string;
  wheelLabel: string;
  description: string;
  suggestion: string;
  icon: string;
  color: string;
  moods: MoodId[];
  enabled: boolean;
}

interface ActivityListResponse { readonly activities: readonly AdminActivity[] }
interface IconListResponse { readonly icons: readonly ActivityIcon[] }

type AvailabilityFilter = "all" | "enabled" | "disabled" | "archived";
const allowedColors = [...new Set(catalog.activities.map((activity) => activity.color))];
const emptyDraft: ActivityDraft = {
  id: "date-plan", title: "", wheelLabel: "", description: "", suggestion: "",
  icon: "cafe", color: allowedColors[0] ?? "#9d5862", moods: ["surprise"], enabled: true,
};

function friendlyError(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 409) return "این تغییر با محدودیت چرخ سازگار نیست. هر حال‌وهوا باید بین ۲ تا ۱۰ گزینهٔ فعال داشته باشه.";
    if (error.status === 422) return "یکی از فیلدها، آیکون‌ها یا شناسه‌ها معتبر نیست؛ موارد علامت‌خورده رو بررسی کن.";
    if (error.status === 503) return "ذخیره‌سازی قرارها فعلاً در دسترس نیست. تغییرت ذخیره نشد.";
    return error.message;
  }
  return "ارتباط با پنل برقرار نشد؛ تغییرات ذخیره نشدن.";
}

export function ActivityManagement() {
  const [activities, setActivities] = useState<readonly AdminActivity[]>([]);
  const [icons, setIcons] = useState<readonly ActivityIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [moodFilter, setMoodFilter] = useState<MoodId | "all">("all");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewMood, setPreviewMood] = useState<MoodId>("surprise");
  const [iconSearch, setIconSearch] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const wheelRef = useRef<HTMLDivElement>(null);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const previewWheel = useWheelSpin();
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [activityResponse, iconResponse] = await Promise.all([
        adminRequest<ActivityListResponse>("/api/admin/activities"),
        adminRequest<IconListResponse>("/api/admin/icons"),
      ]);
      setActivities(activityResponse.activities);
      setIcons(iconResponse.icons);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!draft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft]);

  const visible = useMemo(() => activities.filter((activity) => {
    const needle = search.trim().toLocaleLowerCase();
    const matchesSearch = !needle || activity.title.toLocaleLowerCase().includes(needle) || activity.id.includes(needle);
    const matchesMood = moodFilter === "all" || activity.moods.includes(moodFilter);
    const matchesAvailability = availability === "all"
      || (availability === "enabled" && activity.enabled && !activity.archived)
      || (availability === "disabled" && !activity.enabled && !activity.archived)
      || (availability === "archived" && activity.archived);
    return matchesSearch && matchesMood && matchesAvailability;
  }), [activities, availability, moodFilter, search]);

  const beginCreate = () => {
    if (draft && !window.confirm("تغییرهای ذخیره‌نشده کنار گذاشته بشن؟")) return;
    setEditingId(null);
    setDraft({ ...emptyDraft });
    setSavedDraft("");
    setIconSearch("");
    setError("");
    setNotice("");
  };

  const beginEdit = (activity: AdminActivity) => {
    if (draft && !window.confirm("تغییرهای ذخیره‌نشده کنار گذاشته بشن؟")) return;
    setEditingId(activity.id);
    setDraft({ id: activity.id, title: activity.title, wheelLabel: activity.wheelLabel,
      description: activity.description, suggestion: activity.suggestion, icon: activity.icon,
      color: activity.color, moods: [...activity.moods], enabled: activity.enabled });
    setSavedDraft(JSON.stringify({ id: activity.id, title: activity.title, wheelLabel: activity.wheelLabel,
      description: activity.description, suggestion: activity.suggestion, icon: activity.icon,
      color: activity.color, moods: [...activity.moods], enabled: activity.enabled }));
    setIconSearch("");
    setError("");
    setNotice("");
  };

  const dirty = Boolean(draft && JSON.stringify(draft) !== savedDraft);
  const discardDraft = () => {
    if (dirty && !window.confirm("تغییرهای ذخیره‌نشده از بین می‌رن. ادامه بدیم؟")) return;
    setDraft(null);
    setEditingId(null);
    setError("");
  };

  const updateDraft = <K extends keyof ActivityDraft>(key: K, value: ActivityDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setNotice("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { csrf_token: csrf } = await getAdminCsrf();
      const { id, ...editable } = draft;
      const url = editingId ? `/api/admin/activities/${encodeURIComponent(editingId)}` : "/api/admin/activities";
      const method = editingId ? "PATCH" : "POST";
      await adminRequest<AdminActivity>(url, { method, body: JSON.stringify(editingId ? editable : { id, ...editable }) }, csrf);
      setNotice(editingId ? "قرار با موفقیت به‌روزرسانی شد." : "قرار تازه به چرخ اضافه شد.");
      setDraft(null);
      setEditingId(null);
      await reload();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  };

  const mutate = async (activity: AdminActivity, method: "PATCH" | "DELETE", body?: object) => {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { csrf_token: csrf } = await getAdminCsrf();
      await adminRequest<AdminActivity>(`/api/admin/activities/${encodeURIComponent(activity.id)}`, {
        method, ...(body ? { body: JSON.stringify(body) } : {}),
      }, csrf);
      setNotice(method === "DELETE" ? "قرار بایگانی شد." : activity.archived ? "قرار به فهرست برگشت." : "وضعیت قرار ذخیره شد.");
      await reload();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  };

  const archive = (activity: AdminActivity) => {
    if (!window.confirm(`«${activity.title}» بایگانی بشه؟ این قرار از چرخ کنار می‌ره و تاریخچهٔ قبلیش حفظ می‌شه.`)) return;
    void mutate(activity, "DELETE");
  };

  const toggle = (activity: AdminActivity) => {
    if (!activity.archived) void mutate(activity, "PATCH", { enabled: !activity.enabled });
  };

  const reorder = async (activity: AdminActivity, direction: -1 | 1) => {
    const active = activities.filter((item) => !item.archived);
    const index = active.findIndex((item) => item.id === activity.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= active.length || saving) return;
    const ids = active.map((item) => item.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { csrf_token: csrf } = await getAdminCsrf();
      const result = await adminRequest<ActivityListResponse>("/api/admin/activities/reorder", {
        method: "POST", body: JSON.stringify({ ids }),
      }, csrf);
      setActivities(result.activities);
      setNotice("ترتیب تازه ذخیره شد.");
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  };

  const previewActivities = useMemo(() => {
    const current = activities.filter((activity) => activity.enabled && !activity.archived).map((activity) => ({ ...activity }));
    if (draft) {
      const preview: AdminActivity = { ...draft, id: draft.id || "preview-new", icon: draft.icon || "cafe",
        title: draft.title || "قرار تازه", wheelLabel: draft.wheelLabel || "قرار تازه",
        description: draft.description || "یک پیشنهاد تازه برای چرخ.", suggestion: draft.suggestion || "با هم یه تجربهٔ تازه بسازین.",
        emoji: activities.find((item) => item.icon === draft.icon)?.emoji ?? "✦", ink: "dark",
        sortOrder: draft ? (activities.find((item) => item.id === editingId)?.sortOrder ?? activities.length) : activities.length,
        moods: draft.moods, enabled: true, archived: false };
      const existingIndex = current.findIndex((activity) => activity.id === editingId);
      if (draft.enabled && draft.moods.includes(previewMood)) {
        if (existingIndex >= 0) current[existingIndex] = preview;
        else current.push(preview);
      } else if (existingIndex >= 0) current.splice(existingIndex, 1);
    }
    return current.filter((activity) => activity.moods.includes(previewMood)).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }, [activities, draft, editingId, previewMood]);

  const matchingIcons = icons.filter((icon) => !iconSearch.trim()
    || icon.label.includes(iconSearch.trim()) || icon.id.includes(iconSearch.trim()) || icon.category.includes(iconSearch.trim()));
  const activeCount = activities.filter((activity) => activity.enabled && !activity.archived).length;

  if (loading) return <div className="admin-loading admin-activity-loading" role="status"><span className="admin-spinner" />در حال بارگذاری قرارها…</div>;

  return <div className="activity-management">
    <div className="activity-heading-row">
      <div><p className="admin-kicker">فهرست زندهٔ گزینه‌ها</p><h2>قرارهای روی چرخ</h2><p className="activity-intro">هر تغییر پس از ذخیره روی چرخ اعمال می‌شه؛ چرخِ در حال حرکت، گزینه‌های خودش رو نگه می‌داره.</p></div>
      <button className="admin-primary activity-add-button" type="button" onClick={beginCreate} disabled={saving}>＋ افزودن قرار</button>
    </div>
    <div className="activity-summary-line"><span><strong>{activeCount}</strong> گزینهٔ فعال</span><span>{activities.filter((activity) => activity.archived).length} بایگانی‌شده</span></div>
    {error && <p className="admin-alert" role="alert">{error}</p>}
    {notice && <p className="admin-success" role="status">{notice}</p>}

    <section className="activity-list-card" aria-label="فهرست قرارها">
      <div className="activity-filters">
        <label className="activity-search"><span className="visually-hidden">جست‌وجوی قرارها</span><span aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجو بین قرارها…" /></label>
        <label><span className="visually-hidden">فیلتر حال‌وهوا</span><select value={moodFilter} onChange={(event) => setMoodFilter(event.target.value as MoodId | "all")}>
          <option value="all">همهٔ حال‌وهواها</option>{moods.map((mood) => <option key={mood.id} value={mood.id}>{mood.label}</option>)}
        </select></label>
        <label><span className="visually-hidden">فیلتر وضعیت</span><select value={availability} onChange={(event) => setAvailability(event.target.value as AvailabilityFilter)}>
          <option value="all">همهٔ وضعیت‌ها</option><option value="enabled">فعال</option><option value="disabled">غیرفعال</option><option value="archived">بایگانی‌شده</option>
        </select></label>
      </div>
      {visible.length === 0 ? <div className="activity-empty"><span aria-hidden="true">✳</span><h3>چیزی پیدا نشد</h3><p>فیلترها رو تغییر بده یا یک قرار تازه بساز.</p></div> :
        <div className="activity-items">{visible.map((activity) => <article className={`activity-row${activity.archived ? " is-archived" : ""}`} key={activity.id}>
          <img className="activity-row-art" src={getIconArtworkDataUrl(activity.icon, activity.color)} alt="" aria-hidden="true" />
          <div className="activity-row-copy"><div className="activity-row-title"><h3>{activity.title}</h3>
            <span className={`activity-status${activity.archived ? " archived" : activity.enabled ? " active" : " disabled"}`}>{activity.archived ? "بایگانی" : activity.enabled ? "فعال" : "غیرفعال"}</span></div>
            <p>{activity.description}</p><div className="activity-row-meta"><code dir="ltr">{activity.id}</code><span>{activity.moods.map((id) => moods.find((mood) => mood.id === id)?.label).filter(Boolean).join(" · ")}</span><span>ترتیب {activity.sortOrder + 1}</span></div></div>
          <div className="activity-row-actions">
            <div className="activity-order-controls" aria-label={`ترتیب ${activity.title}`}>
              <button type="button" aria-label={`انتقال ${activity.title} به بالا`} disabled={saving || activity.archived || activities.filter((item) => !item.archived)[0]?.id === activity.id} onClick={() => void reorder(activity, -1)}>↑</button>
              <button type="button" aria-label={`انتقال ${activity.title} به پایین`} disabled={saving || activity.archived || activities.filter((item) => !item.archived).at(-1)?.id === activity.id} onClick={() => void reorder(activity, 1)}>↓</button>
            </div>
            {activity.archived ? <button className="activity-text-action" type="button" disabled={saving} onClick={() => void mutate(activity, "PATCH", { archived: false })}>بازگردانی</button> : <>
              <button className="activity-text-action" type="button" disabled={saving} onClick={() => toggle(activity)}>{activity.enabled ? "غیرفعال" : "فعال‌کردن"}</button>
              <button className="activity-text-action" type="button" disabled={saving} onClick={() => beginEdit(activity)}>ویرایش</button>
              <button className="activity-icon-action archive" type="button" aria-label={`بایگانی ${activity.title}`} title="بایگانی" disabled={saving} onClick={() => archive(activity)}>⌫</button>
            </>}
          </div>
        </article>)}</div>}
    </section>

    <section className="activity-preview-card activity-live-preview" aria-label="پیش‌نمایش زندهٔ چرخ">
      <div className="activity-preview-heading"><div><span>پیش‌نمایش زندهٔ چرخ</span><small>هم‌خوان با طراحی چرخ اصلی</small></div><span>فقط برای مدیر</span></div>
      <div className="activity-preview-moods" role="group" aria-label="حال‌وهوای پیش‌نمایش">{moods.map((mood) => <button key={mood.id} type="button" className={previewMood === mood.id ? "is-active" : ""} aria-pressed={previewMood === mood.id} onClick={() => { setPreviewMood(mood.id); previewWheel.clearResult(); }}>{mood.label}</button>)}</div>
      {previewActivities.length >= 2 && previewActivities.length <= 10 ? <>
        <div className="admin-wheel-preview"><DateWheel activities={previewActivities} rotation={previewWheel.rotation} isSpinning={previewWheel.isSpinning} hasResult={previewWheel.selectedIndex !== null} wheelRef={wheelRef} spinButtonRef={spinButtonRef} onSpin={() => previewWheel.spin(wheelRef.current, previewActivities.length)} /></div>
        <p className="activity-preview-count">{previewActivities.length} گزینهٔ فعال در حال‌وهوای «{moods.find((mood) => mood.id === previewMood)?.label}»</p>
      </> : <div className="activity-preview-warning" role="status">برای پیش‌نمایش معتبر، دست‌کم ۲ و حداکثر ۱۰ قرار فعال در این حال‌وهوا لازمه.</div>}
    </section>

    {draft && <section className="activity-editor" aria-labelledby="activity-editor-title">
      <div className="activity-editor-heading"><div><p className="admin-kicker">{editingId ? "ویرایش اطلاعات" : "یک پیشنهاد تازه"}</p><h2 id="activity-editor-title">{editingId ? "ویرایش قرار" : "افزودن قرار تازه"}</h2></div>
        {dirty && <span className="activity-unsaved">تغییر ذخیره‌نشده</span>}</div>
      <div className="activity-editor-grid">
        <form className="activity-form" onSubmit={(event) => void save(event)}>
          <div className="activity-fields-two">
            <label>عنوان قرار<input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} maxLength={80} required placeholder="مثلاً: تماشای غروب" /></label>
            <label>برچسب روی چرخ<input value={draft.wheelLabel} onChange={(event) => updateDraft("wheelLabel", event.target.value)} maxLength={14} required placeholder="کوتاه و خوانا" /><small>{draft.wheelLabel.length}/۱۴ نویسه</small></label>
          </div>
          {!editingId && <label>شناسهٔ ثابت (انگلیسی)<input className="activity-latin-input" dir="ltr" value={draft.id} onChange={(event) => updateDraft("id", event.target.value)} maxLength={32} pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*" required aria-describedby="activity-id-help" /><small id="activity-id-help">با حرف کوچک شروع کن؛ فاصله نذار و از خط تیره استفاده کن.</small></label>}
          <label>توضیح کوتاه<textarea value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} maxLength={240} rows={3} required placeholder="برای کارت نتیجه هم نمایش داده می‌شه." /></label>
          <label>پیشنهاد کوچولوی این قرار<textarea value={draft.suggestion} onChange={(event) => updateDraft("suggestion", event.target.value)} maxLength={160} rows={2} required placeholder="مثلاً: برای هم یه کتاب انتخاب کنین." /></label>
          <fieldset className="activity-mood-field"><legend>این قرار در کدام حال‌وهواها باشه؟</legend><div className="activity-mood-options">{moods.map((mood) => <label key={mood.id} className="activity-check-chip">
            <input type="checkbox" checked={draft.moods.includes(mood.id)} onChange={(event) => updateDraft("moods", event.target.checked ? [...draft.moods, mood.id] : draft.moods.filter((item) => item !== mood.id))} />
            <span>{mood.label}</span></label>)}</div><small>هر حال‌وهوا باید دست‌کم ۲ و حداکثر ۱۰ قرار فعال داشته باشه.</small></fieldset>
          <div className="activity-editor-subgrid">
            <fieldset className="activity-color-field"><legend>رنگِ چرخ</legend><div className="activity-colors">{allowedColors.map((color) => <button key={color} type="button" className={`activity-color-chip${draft.color === color ? " is-selected" : ""}`} style={{ "--activity-color": color } as CSSProperties} aria-label={`رنگ ${color}`} aria-pressed={draft.color === color} onClick={() => updateDraft("color", color)} />)}</div></fieldset>
            <label className="activity-enabled-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft("enabled", event.target.checked)} /><span><strong>روی چرخ فعال باشه</strong><small>گزینهٔ غیرفعال در wheel نمیاد.</small></span></label>
          </div>
          <fieldset className="activity-icon-field"><legend>تصویرِ این قرار</legend>
            <label className="activity-icon-search"><span className="visually-hidden">جست‌وجوی نماد</span><input value={iconSearch} onChange={(event) => setIconSearch(event.target.value)} placeholder="جست‌وجوی آیکون…" /></label>
            <div className="activity-icon-grid" role="group" aria-label="انتخاب آیکون قرار">{matchingIcons.map((icon) => <button key={icon.id} type="button" className={`activity-icon-choice${draft.icon === icon.id ? " is-selected" : ""}`} aria-pressed={draft.icon === icon.id} onClick={() => updateDraft("icon", icon.id)}>
              <img src={getIconArtworkDataUrl(icon.id, draft.color)} alt="" aria-hidden="true" /><span>{icon.label}</span><small>{icon.category}</small>
            </button>)}</div>
            {matchingIcons.length === 0 && <p className="activity-no-icons">آیکونی با این عبارت پیدا نشد.</p>}
          </fieldset>
          <div className="activity-form-actions"><button className="admin-primary" type="submit" disabled={saving || !dirty && Boolean(editingId)}>{saving ? <><span className="admin-spinner" />در حال ذخیره…</> : "ذخیرهٔ تغییرها"}</button>
            <button className="activity-cancel" type="button" disabled={saving} onClick={discardDraft}>انصراف</button></div>
        </form>
      </div>
    </section>}
  </div>;
}
