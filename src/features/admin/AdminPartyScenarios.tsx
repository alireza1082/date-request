import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { AdminApiError, adminRequest, getAdminCsrf } from "./admin-api";
import { bundledPartyArtwork, type PartyOutcome } from "../party/party-catalog";
import { partyImage } from "../party/party-client";
import "./party-scenarios.css";

interface Scenario extends PartyOutcome {
  readonly enabled: boolean;
  readonly sort_order: number;
  readonly archived: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}
type ScenarioDraft = { id: string; title: string; headline: string; description: string; alt: string; steps: string[]; artwork_key: string; enabled: boolean; sort_order: number | null };
interface ScenarioResponse { readonly scenarios: Scenario[] }
interface SelectionResponse { readonly mode: "random" | "fixed"; readonly fixed_scenario_id: string | null; readonly scenarios: Scenario[] }
interface DraftSelection { readonly mode: "random" | "fixed"; readonly fixed_scenario_id: string | null }

const artLabels: Readonly<Record<string, string>> = {
  "neon-night": "نئون و موسیقی", "private-cinema": "سینمای اختصاصی", karaoke: "کارائوکه",
  "mystery-night": "نقاب و معما", "surprise-kitchen": "آشپزخونه", "game-night": "بازی دونفره", "dance-and-lights": "رقص و نور",
};
const emptyDraft = (): ScenarioDraft => ({ id: "", title: "", headline: "", description: "", alt: "تصویر یک مهمانی دونفره با نورپردازی گرم", steps: ["", "", "", ""], artwork_key: "dance-and-lights", enabled: false, sort_order: null });

export function AdminPartyScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [savedSelection, setSavedSelection] = useState<DraftSelection>({ mode: "random", fixed_scenario_id: null });
  const [selectionDraft, setSelectionDraft] = useState<DraftSelection>(savedSelection);
  const [scenario, setScenario] = useState<ScenarioDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [library, selection] = await Promise.all([
        adminRequest<ScenarioResponse>("/api/admin/party/scenarios"),
        adminRequest<SelectionResponse>("/api/admin/party/selection"),
      ]);
      setScenarios(library.scenarios);
      const next = { mode: selection.mode, fixed_scenario_id: selection.fixed_scenario_id } as const;
      setSavedSelection(next); setSelectionDraft(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "سناریوها بارگذاری نشدن."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const active = useMemo(() => scenarios.filter((item) => item.enabled && !item.archived), [scenarios]);
  const visible = useMemo(() => scenarios.filter((item) => `${item.title} ${item.description}`.includes(query.trim())), [query, scenarios]);
  const dirty = scenario !== null && JSON.stringify(scenario) !== savedDraft;
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const openNew = () => {
    if (dirty && !window.confirm("تغییرهای ذخیره‌نشده کنار گذاشته بشن؟")) return;
    const next = emptyDraft(); setScenario(next); setEditingId(null); setSavedDraft(JSON.stringify(next)); setFile(null); setError(""); setNotice("");
  };

  const openEdit = (item: Scenario) => {
    if (dirty && !window.confirm("تغییرهای ذخیره‌نشده کنار گذاشته بشن؟")) return;
    const next: ScenarioDraft = { id: item.id, title: item.title, headline: item.headline, description: item.description, alt: item.alt, steps: [...item.steps], artwork_key: item.artwork_key, enabled: item.enabled, sort_order: item.sort_order };
    setScenario(next); setEditingId(item.id); setSavedDraft(JSON.stringify(next)); setFile(null); setError(""); setNotice("");
  };

  const closeEditor = () => {
    if (dirty && !window.confirm("تغییرهای ذخیره‌نشده از دست می‌رن. ببندیم؟")) return;
    setScenario(null); setEditingId(null); setFile(null);
  };

  const edit = <K extends keyof ScenarioDraft>(key: K, value: ScenarioDraft[K]) => setScenario((current) => current ? { ...current, [key]: value } : current);
  const editStep = (index: number, value: string) => setScenario((current) => current ? { ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? value : step) } : current);

  const persistSelection = async () => {
    if (busy || JSON.stringify(selectionDraft) === JSON.stringify(savedSelection)) return;
    setBusy("selection"); setError(""); setNotice("");
    try {
      const { csrf_token } = await getAdminCsrf();
      const result = await adminRequest<SelectionResponse>("/api/admin/party/selection", { method: "PATCH", body: JSON.stringify(selectionDraft) }, csrf_token);
      setSavedSelection({ mode: result.mode, fixed_scenario_id: result.fixed_scenario_id }); setSelectionDraft({ mode: result.mode, fixed_scenario_id: result.fixed_scenario_id });
      setScenarios(result.scenarios); setNotice("روش انتخاب نتیجه ذخیره شد.");
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "روش انتخاب ذخیره نشد.");
      void load();
    } finally { setBusy(""); }
  };

  const saveScenario = async () => {
    if (!scenario || busy) return;
    setError(""); setNotice("");
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scenario.id) || scenario.id.length > 40) { setError("شناسه باید با حروف انگلیسی کوچک شروع شود و فقط خط تیره و عدد داشته باشد."); return; }
    const steps = scenario.steps.map((step) => step.trim()).filter(Boolean);
    if (!scenario.title.trim() || !scenario.headline.trim() || !scenario.description.trim() || scenario.alt.trim().length < 8 || steps.length < 3 || steps.length > 5) { setError("عنوان، تیتر، توضیح، متن تصویر و سه تا پنج مرحلهٔ کامل لازم است."); return; }
    if (file && file.size > 4 * 1024 * 1024) { setError("حجم تصویر نباید بیشتر از ۴ مگابایت باشد."); return; }
    setBusy("save");
    try {
      const { csrf_token } = await getAdminCsrf();
      const body = { title: scenario.title, headline: scenario.headline, description: scenario.description, alt: scenario.alt, steps, artwork_key: scenario.artwork_key, enabled: file && !editingId ? false : scenario.enabled, sort_order: scenario.sort_order };
      let saved: Scenario;
      if (editingId) {
        saved = await adminRequest<Scenario>(`/api/admin/party/scenarios/${editingId}`, { method: "PATCH", body: JSON.stringify(body) }, csrf_token);
      } else {
        saved = await adminRequest<Scenario>("/api/admin/party/scenarios", { method: "POST", body: JSON.stringify({ ...body, id: scenario.id }) }, csrf_token);
        setEditingId(saved.id);
      }
      if (file) {
        const fresh = await getAdminCsrf();
        saved = await adminRequest<Scenario>(`/api/admin/party/scenarios/${saved.id}/image`, { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } }, fresh.csrf_token);
        setFile(null);
      }
      if (scenario.enabled && !saved.enabled) {
        const fresh = await getAdminCsrf();
        saved = await adminRequest<Scenario>(`/api/admin/party/scenarios/${saved.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }, fresh.csrf_token);
      }
      setScenarios((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => a.sort_order - b.sort_order));
      const next = { id: saved.id, title: saved.title, headline: saved.headline, description: saved.description, alt: saved.alt, steps: [...saved.steps], artwork_key: saved.artwork_key, enabled: saved.enabled, sort_order: saved.sort_order };
      setScenario(next); setSavedDraft(JSON.stringify(next)); setNotice("سناریو ذخیره شد. تا زمان فعال‌سازی، در تجربهٔ عمومی نمایش داده نمی‌شود.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "سناریو ذخیره نشد؛ تغییرها باقی موندن."); }
    finally { setBusy(""); }
  };

  const toggle = async (item: Scenario, enabled: boolean) => {
    if (busy) return;
    setBusy(`toggle:${item.id}`); setError(""); setNotice("");
    try {
      const { csrf_token } = await getAdminCsrf();
      const saved = await adminRequest<Scenario>(`/api/admin/party/scenarios/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }, csrf_token);
      setScenarios((current) => current.map((entry) => entry.id === saved.id ? saved : entry)); setNotice(enabled ? "سناریو برای بازدیدکننده‌های جدید فعال شد." : "سناریو غیرفعال شد.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "وضعیت سناریو تغییر نکرد."); void load(); }
    finally { setBusy(""); }
  };

  const archive = async (item: Scenario) => {
    if (busy || !window.confirm(`سناریوی «${item.title}» بایگانی بشه؟ تاریخچه و تصویر قبلی حذف نمی‌شن.`)) return;
    setBusy(`archive:${item.id}`); setError(""); setNotice("");
    try {
      const { csrf_token } = await getAdminCsrf();
      await adminRequest<void>(`/api/admin/party/scenarios/${item.id}`, { method: "DELETE" }, csrf_token);
      setScenarios((current) => current.filter((entry) => entry.id !== item.id));
      setNotice("سناریو بایگانی شد؛ اطلاعاتش برای حفظ سابقه باقی موند.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "سناریو بایگانی نشد."); }
    finally { setBusy(""); }
  };

  const move = async (item: Scenario, direction: -1 | 1) => {
    if (busy) return;
    const ordered = [...scenarios].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((entry) => entry.id === item.id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[index]!];
    setBusy("reorder"); setError("");
    try {
      const { csrf_token } = await getAdminCsrf();
      const result = await adminRequest<ScenarioResponse>("/api/admin/party/scenarios/reorder", { method: "POST", body: JSON.stringify({ ids: ordered.map((entry) => entry.id) }) }, csrf_token);
      setScenarios(result.scenarios); setNotice("ترتیب کتابخانه به‌روز شد.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ترتیب تغییر نکرد."); void load(); }
    finally { setBusy(""); }
  };

  if (loading) return <div className="admin-loading admin-report-loading" role="status"><span className="admin-spinner" />در حال بارگذاری سناریوها…</div>;

  return <div className="admin-party-page">
    <section className="admin-party-intro"><div><p className="admin-kicker">کتابخانهٔ تجربه‌های دونفره</p><h2>هر بار، یک حال‌وهوای تازه</h2><p>سناریوهای فعال به‌صورت تصادفی انتخاب می‌شن یا می‌تونی یک نتیجهٔ مشخص رو برای همه انتخاب کنی. چرخ شش بخش رمزآلودش رو حفظ می‌کنه.</p></div><span aria-hidden="true">✦</span></section>
    {error && <p className="admin-alert" role="alert">{error}</p>}{notice && <p className="admin-success" role="status">{notice}</p>}

    <section className="admin-party-selection admin-settings-card" aria-labelledby="party-selection-title">
      <div className="admin-party-section-heading"><div><p className="admin-kicker">تنظیم نتیجه</p><h3 id="party-selection-title">چطور سورپرایز انتخاب بشه؟</h3></div><span className="admin-party-step">۰۱</span></div>
      <div className="admin-party-mode-options">
        <label className={selectionDraft.mode === "random" ? "is-selected" : ""}><input type="radio" name="party-selection-mode" checked={selectionDraft.mode === "random"} onChange={() => setSelectionDraft({ mode: "random", fixed_scenario_id: null })} /><span><strong>انتخاب تصادفی از سناریوهای فعال</strong><small>همهٔ سناریوهای فعال شانس برابر دارن.</small></span></label>
        <label className={selectionDraft.mode === "fixed" ? "is-selected" : ""}><input type="radio" name="party-selection-mode" checked={selectionDraft.mode === "fixed"} onChange={() => setSelectionDraft({ mode: "fixed", fixed_scenario_id: active[0]?.id ?? null })} /><span><strong>نمایش سناریوی مشخص</strong><small>هر چرخش به همان نتیجهٔ انتخاب‌شده می‌رسه.</small></span></label>
      </div>
      {selectionDraft.mode === "fixed" && <label className="admin-party-fixed-select">سناریوی ثابت<select value={selectionDraft.fixed_scenario_id ?? ""} onChange={(event) => setSelectionDraft({ mode: "fixed", fixed_scenario_id: event.target.value || null })}><option value="">انتخاب سناریوی فعال</option>{active.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      <div className="admin-party-selection-actions"><span>{selectionDraft.mode === "fixed" ? "حالت ثابت در صفحهٔ عمومی هم شفاف اعلام می‌شه." : `${active.length} سناریوی فعال در استخر انتخاب قرار دارن.`}</span><button className="admin-primary" type="button" disabled={busy !== "" || JSON.stringify(selectionDraft) === JSON.stringify(savedSelection)} onClick={() => void persistSelection()}>{busy === "selection" ? <><span className="admin-spinner" />در حال ذخیره…</> : "ذخیرهٔ روش انتخاب"}</button></div>
    </section>

    <section className="admin-party-library" aria-labelledby="party-library-title">
      <div className="admin-party-section-heading"><div><p className="admin-kicker">مدیریت محتوا</p><h3 id="party-library-title">سناریوهای شب دونفره <small>{scenarios.length}</small></h3></div><button className="admin-primary" type="button" onClick={openNew}>ساخت سناریو <span aria-hidden="true">＋</span></button></div>
      <label className="admin-party-search">جست‌وجو<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام یا توضیح سناریو" /></label>
      {visible.length === 0 ? <div className="admin-report-empty-card"><span aria-hidden="true">✦</span><h3>هنوز سناریویی پیدا نشد</h3><p>جست‌وجو رو تغییر بده یا سناریوی تازه بساز.</p></div> : <div className="admin-party-library-grid">{visible.map((item, index) => <article className={`admin-party-scenario${item.enabled ? " is-enabled" : ""}`} key={item.id}>
        <div className="admin-party-thumb"><img src={partyImage(item)} alt="" width="480" height="300" /><span className={item.enabled ? "is-on" : ""}>{item.enabled ? "فعال" : "پیش‌نویس"}</span></div>
        <div className="admin-party-scenario-copy"><h4>{item.title}</h4><p>{item.description}</p><small>{item.id} · {item.steps.length} مرحله</small></div>
        <div className="admin-party-card-actions"><label className="admin-party-active"><input type="checkbox" role="switch" aria-label={`فعال‌کردن ${item.title}`} checked={item.enabled} disabled={busy !== ""} onChange={(event) => void toggle(item, event.target.checked)} /><span aria-hidden="true" />{busy === `toggle:${item.id}` ? "ذخیره…" : item.enabled ? "فعال" : "غیرفعال"}</label>
          <button type="button" onClick={() => openEdit(item)}>ویرایش</button><button type="button" aria-label={`انتقال ${item.title} به بالا`} disabled={index === 0 || busy !== ""} onClick={() => void move(item, -1)}>↑</button><button type="button" aria-label={`انتقال ${item.title} به پایین`} disabled={index === visible.length - 1 || busy !== ""} onClick={() => void move(item, 1)}>↓</button><button className="is-danger" type="button" onClick={() => void archive(item)}>بایگانی</button>
        </div>
      </article>)}</div>}
    </section>

    {scenario && <section className="admin-party-editor admin-settings-card" aria-labelledby="party-editor-title">
      <div className="admin-party-section-heading"><div><p className="admin-kicker">{editingId ? "ویرایش محتوا" : "سناریوی تازه"}</p><h3 id="party-editor-title">{editingId ? scenario.title : "ساخت یک شب تازه"}</h3></div><button className="admin-secondary-button" type="button" onClick={closeEditor}>بستن و بازگشت</button></div>
      {dirty && <p className="admin-party-unsaved" role="status">تغییرهای این فرم هنوز ذخیره نشده‌اند.</p>}
      <div className="admin-party-editor-grid">
        <div className="admin-party-form">
          {!editingId && <label>شناسهٔ پایدار<input dir="ltr" value={scenario.id} maxLength={40} pattern="[a-z][a-z0-9-]*" onChange={(event) => edit("id", event.target.value)} placeholder="مثلاً starlight-night" /><small>بعد از ساخت قابل تغییر نیست.</small></label>}
          <label>عنوان سناریو<input value={scenario.title} maxLength={80} onChange={(event) => edit("title", event.target.value)} /></label>
          <label>تیتر لحظهٔ آشکارشدن<input value={scenario.headline} maxLength={100} onChange={(event) => edit("headline", event.target.value)} /></label>
          <label>توضیح کوتاه<textarea rows={3} maxLength={320} value={scenario.description} onChange={(event) => edit("description", event.target.value)} /></label>
          <label>توضیح دسترس‌پذیر تصویر<input value={scenario.alt} maxLength={200} onChange={(event) => edit("alt", event.target.value)} /></label>
          <fieldset className="admin-party-art-selector"><legend>تصویر پایه</legend><div>{Object.entries(bundledPartyArtwork).map(([key, src]) => <button key={key} type="button" className={scenario.artwork_key === key ? "is-selected" : ""} onClick={() => edit("artwork_key", key)} aria-pressed={scenario.artwork_key === key}><img src={src} alt="" width="480" height="300" /><span>{artLabels[key] ?? key}</span></button>)}</div></fieldset>
          <label className="admin-party-upload">تصویر اختصاصی<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} /><small>JPEG، PNG یا WebP؛ حداکثر ۴ مگابایت. فایل روی سرور بازبینی و به WebP تبدیل می‌شود.</small></label>
          <fieldset className="admin-party-steps"><legend>مراحل برنامه (۳ تا ۵ مورد)</legend>{scenario.steps.map((step, index) => <div key={index}><label htmlFor={`party-step-${index}`}>مرحلهٔ {index + 1}<input id={`party-step-${index}`} value={step} maxLength={180} onChange={(event) => editStep(index, event.target.value)} /></label><button type="button" aria-label={`حذف مرحلهٔ ${index + 1}`} disabled={scenario.steps.length <= 3} onClick={() => edit("steps", scenario.steps.filter((_, stepIndex) => stepIndex !== index))}>−</button></div>)}{scenario.steps.length < 5 && <button className="admin-secondary-button" type="button" onClick={() => edit("steps", [...scenario.steps, ""])}>افزودن مرحله</button>}</fieldset>
        </div>
        <div className="admin-party-preview-column"><p className="admin-party-preview-label">پیش‌نمایش نتیجه برای بازدیدکننده</p><PartyPreview scenario={scenario} image={localPreview ?? (editingId ? scenarios.find((item) => item.id === editingId)?.image_url : null) ?? partyImage({ artwork_key: scenario.artwork_key, image_url: null })} /><label className="admin-party-publish"><input type="checkbox" checked={scenario.enabled} onChange={(event) => edit("enabled", event.target.checked)} />فعال‌شدن پس از ذخیره</label></div>
      </div>
      <div className="admin-party-editor-actions"><button className="admin-secondary-button" type="button" onClick={closeEditor}>انصراف</button><button className="admin-primary" type="button" disabled={busy !== ""} onClick={() => void saveScenario()}>{busy === "save" ? <><span className="admin-spinner" />در حال ذخیره…</> : "ذخیره سناریو"}</button></div>
      {error && <p className="admin-alert" role="alert">{error}</p>}
    </section>}
  </div>;
}

function PartyPreview({ scenario, image }: { readonly scenario: ScenarioDraft; readonly image: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return <article className="admin-party-preview-card" dir="rtl"><div className="admin-party-preview-image">{!failed ? <img src={image} alt={scenario.alt || ""} width="480" height="300" onError={() => setFailed(true)} /> : <div role="img" aria-label={scenario.alt || "تصویر پیش‌فرض مهمانی"}>✦</div>}</div><div><p>سورپرایز امشب</p><h4>{scenario.headline || "تیتر سورپرایز"}</h4><h5>{scenario.title || "عنوان سناریو"}</h5><span>{scenario.description || "توضیح کوتاه اینجا نمایش داده می‌شود."}</span><strong>نقشهٔ کوچولوی امشب</strong><ol>{scenario.steps.filter(Boolean).map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol></div></article>;
}
