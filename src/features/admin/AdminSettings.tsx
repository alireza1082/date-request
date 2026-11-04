import { useCallback, useEffect, useRef, useState } from "react";
import { resolvePublicMode, type SeasonalSettings } from "../../data/seasonal-settings";
import { HalloweenInvitationCard } from "../halloween/HalloweenScreen";
import { AdminApiError, adminRequest, getAdminCsrf } from "./admin-api";
interface TelegramDiagnostics {
  readonly api_operational: boolean;
  readonly configured: boolean;
  readonly bot_token_configured: boolean;
  readonly destination_configured: boolean;
  readonly bot_validation: "valid" | "invalid" | "not_checked";
  readonly bot_validated_at: string | null;
  readonly validation_error: string | null;
  readonly last_successful_acceptance: string | null;
  readonly last_failed_attempt: string | null;
  readonly last_failure_summary: string | null;
  readonly success_count: number;
  readonly failure_count: number;
  readonly last_test_at: string | null;
  readonly read_by_recipient: null;
  readonly delivery_semantics: string;
}
const emptySettings: SeasonalSettings = { halloween_enabled: false, party_enabled: false, mode_version: 0, halloween_title: "", halloween_subtitle: "", halloween_cta: "", halloween_note: "" };
const faNumber = new Intl.NumberFormat("fa-IR");
type PublicMode = "normal" | "halloween" | "party";

export function AdminSettings() {
  const [settings, setSettings] = useState<SeasonalSettings>(emptySettings);
  const [modeState, setModeState] = useState<SeasonalSettings>(emptySettings);
  const [modePreview, setModePreview] = useState<PublicMode | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeFeedback, setModeFeedback] = useState("");
  const [saved, setSaved] = useState("");
  const [diagnostics, setDiagnostics] = useState<TelegramDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [telegramAction, setTelegramAction] = useState<"validate" | "test" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const modeStateRef = useRef(modeState);
  const modeIntentRef = useRef<PublicMode | null>(null);
  const modeWorkerRef = useRef(false);

  const applyMode = (result: SeasonalSettings) => {
    modeStateRef.current = result;
    setModeState(result);
  };

  const loadDiagnostics = useCallback(async () => {
    const response = await adminRequest<TelegramDiagnostics>("/api/admin/telegram/diagnostics");
    setDiagnostics(response);
    return response;
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([
      adminRequest<SeasonalSettings>("/api/admin/settings"),
      adminRequest<TelegramDiagnostics>("/api/admin/telegram/diagnostics"),
    ]).then(([seasonal, telegram]) => {
      if (!current) return;
      setSettings(seasonal); setSaved(JSON.stringify(seasonal)); applyMode(seasonal); setDiagnostics(telegram); setError("");
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : "تنظیمات بارگذاری نشدن."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const dirty = JSON.stringify(settings) !== saved;
  const update = <K extends keyof SeasonalSettings>(key: K, value: SeasonalSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value })); setNotice("");
  };

  const requestMode = (mode: PublicMode) => {
    modeIntentRef.current = mode;
    setModePreview(mode);
    setModeSaving(true);
    setModeFeedback("در حال ذخیرهٔ فوری تجربه…");
    setError("");
    if (modeWorkerRef.current) return;
    modeWorkerRef.current = true;
    void (async () => {
      while (modeIntentRef.current !== null) {
        const target = modeIntentRef.current;
        modeIntentRef.current = null;
        try {
          const { csrf_token: csrf } = await getAdminCsrf();
          const result = await adminRequest<{ mode: PublicMode; halloween_enabled: boolean; party_enabled: boolean; mode_version: number }>(
            "/api/admin/mode",
            { method: "PATCH", body: JSON.stringify({ mode: target, expected_version: modeStateRef.current.mode_version }) },
            csrf,
          );
          const confirmed = { ...modeStateRef.current, halloween_enabled: result.halloween_enabled, party_enabled: result.party_enabled, mode_version: result.mode_version };
          applyMode(confirmed);
          if (modeIntentRef.current === null) {
            setModePreview(null);
            setModeFeedback("تجربهٔ عمومی ذخیره شد.");
          }
        } catch (cause) {
          const hadQueuedIntent = modeIntentRef.current !== null;
          try {
            const confirmed = await adminRequest<SeasonalSettings>("/api/admin/settings");
            applyMode(confirmed);
          } catch { /* The visible controls remain at their last confirmed value. */ }
          if (cause instanceof AdminApiError && cause.status === 409) modeIntentRef.current = null;
          if (!hadQueuedIntent || cause instanceof AdminApiError && [401, 403, 409].includes(cause.status)) {
            modeIntentRef.current = null;
            setModePreview(null);
            setModeFeedback("");
            setError(cause instanceof AdminApiError && cause.status === 409
              ? "تنظیم حالت در تب دیگری تغییر کرده؛ وضعیت ذخیره‌شده دوباره بارگذاری شد."
              : cause instanceof Error ? cause.message : "تغییر حالت ذخیره نشد؛ وضعیت قبلی بازیابی شد.");
          }
        }
      }
      modeWorkerRef.current = false;
      setModeSaving(false);
    })();
  };
  const saveSettings = async () => {
    if (!dirty || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { csrf_token: csrf } = await getAdminCsrf();
      const result = await adminRequest<SeasonalSettings>("/api/admin/settings", { method: "PATCH", body: JSON.stringify({
        halloween_title: settings.halloween_title,
        halloween_subtitle: settings.halloween_subtitle,
        halloween_cta: settings.halloween_cta,
        halloween_note: settings.halloween_note,
      }) }, csrf);
      setSettings(result); setSaved(JSON.stringify(result)); applyMode(result); setNotice("متن‌های هالووین ذخیره شدن.");
    } catch (cause) { setError(cause instanceof AdminApiError ? cause.message : "تنظیمات ذخیره نشدن؛ دوباره تلاش کن."); }
    finally { setSaving(false); }
  };

  const telegramRequest = async (action: "validate" | "test") => {
    if (telegramAction) return;
    setTelegramAction(action); setError(""); setNotice("");
    try {
      const { csrf_token: csrf } = await getAdminCsrf();
      const result = await adminRequest<{ readonly validated?: boolean; readonly accepted?: boolean; readonly error_summary?: string }>(`/api/admin/telegram/${action}`, { method: "POST" }, csrf);
      const diagnosticsResult = await loadDiagnostics();
      const successful = action === "validate" ? result.validated === true : result.accepted === true;
      setNotice(action === "validate"
        ? successful ? "تلگرام توکن ربات رو معتبر شناخت." : result.error_summary || diagnosticsResult.validation_error || "اعتبارسنجی ربات موفق نشد."
        : successful ? "تلگرام درخواست پیام آزمایشی رو پذیرفت؛ خوانده‌شدن پیام قابل بررسی نیست." : result.error_summary || diagnosticsResult.last_failure_summary || "ارسال آزمایشی پذیرفته نشد.");
      if (!successful) setError(action === "validate" ? result.error_summary || diagnosticsResult.validation_error || "ربات معتبر نشد." : result.error_summary || diagnosticsResult.last_failure_summary || "پیام پذیرفته نشد.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ارتباط با تلگرام برقرار نشد."); }
    finally { setTelegramAction(null); }
  };

  if (loading) return <div className="admin-loading admin-report-loading" role="status"><span className="admin-spinner" />در حال بارگذاری تنظیمات…</div>;
  if (!diagnostics && error) return <section className="admin-report-error" role="alert"><h2>تنظیمات در دسترس نیست</h2><p>{error}</p></section>;

  return <div className="admin-settings-page">
    <section className="admin-settings-intro"><p className="admin-kicker">تنظیم تجربهٔ بازدیدکننده</p><h2>جزئیات حال‌وهوای چرخ</h2><p>محتوا پس از ذخیره از API خوانده می‌شه و به build تازه‌ای نیاز نداره.</p></section>
    {error && <p className="admin-alert" role="alert">{error}</p>}{notice && <p className="admin-success" role="status">{notice}</p>}
    <section className="admin-settings-card admin-mode-card" aria-labelledby="public-mode-title">
      <div className="admin-settings-card-head"><div><p className="admin-kicker">انتخاب تجربه</p><h3 id="public-mode-title">حالت فعال وب‌سایت</h3></div><span className="admin-mode-current">{({ normal: "چرخ قرار", halloween: "هالووین", party: "شب دونفره" })[modePreview ?? resolvePublicMode(modeState)]}</span></div>
      <p className="admin-settings-explanation">تغییر هر کلید بلافاصله ذخیره می‌شود. دو حالت ویژه هم‌زمان فعال نمی‌مانند؛ خاموش‌کردن حالت جاری، تجربهٔ عادی را فعال می‌کند.</p>
      <div className="admin-mode-switches">
        <label className="admin-toggle"><input type="checkbox" role="switch" aria-label="حالت هالووین" checked={(modePreview ?? resolvePublicMode(modeState)) === "halloween"} onChange={event => requestMode(event.target.checked ? "halloween" : "normal")} /><span aria-hidden="true" /><strong>حالت هالووین</strong></label>
        <label className="admin-toggle"><input type="checkbox" role="switch" aria-label="حالت شب دونفره" checked={(modePreview ?? resolvePublicMode(modeState)) === "party"} onChange={event => requestMode(event.target.checked ? "party" : "normal")} /><span aria-hidden="true" /><strong>حالت شب دونفره</strong></label>
      </div>
      <p className={`admin-mode-feedback${error ? " is-error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{error || (modeSaving ? <><span className="admin-spinner" /> {modeFeedback}</> : modeFeedback)}</p>
    </section>
    <section className="admin-settings-card" aria-labelledby="halloween-settings-title">
      <div className="admin-settings-card-head"><div><p className="admin-kicker">پیشنهاد فصلی</p><h3 id="halloween-settings-title">شب هالووین</h3></div><span className="admin-diagnostic-badge">{modeState.halloween_enabled ? "تجربهٔ فعال" : "خاموش"}</span></div>
      <p className="admin-settings-explanation">روشن یا خاموش‌کردن از بخش «حالت فعال وب‌سایت» فوری ذخیره می‌شود. متن‌های دعوت پس از ذخیره برای ورودی‌های بعدی به‌روز می‌شوند.</p>
      <div className="admin-settings-editor"><label>عنوان<input value={settings.halloween_title} maxLength={80} onChange={(event) => update("halloween_title", event.target.value)} /></label><label>متن دعوت<textarea rows={4} value={settings.halloween_subtitle} maxLength={240} onChange={(event) => update("halloween_subtitle", event.target.value)} /></label><label>متن دکمه<input value={settings.halloween_cta} maxLength={60} onChange={(event) => update("halloween_cta", event.target.value)} /></label><label>یادداشت کوتاه<textarea rows={2} value={settings.halloween_note} maxLength={160} onChange={(event) => update("halloween_note", event.target.value)} /></label></div>
      <section className="admin-halloween-preview" aria-label="پیش‌نمایش دعوت هالووین"><HalloweenInvitationCard settings={settings} onContinue={() => undefined} preview /></section>
      <div className="admin-settings-actions"><span>{dirty ? "تغییر ذخیره‌نشده" : "همه‌چیز ذخیره شده"}</span><button className="admin-primary" type="button" disabled={!dirty || saving} onClick={() => void saveSettings()}>{saving ? <><span className="admin-spinner" />در حال ذخیره…</> : "ذخیرهٔ تنظیمات"}</button></div>
    </section>
    {diagnostics && <section className="admin-settings-card admin-telegram-card" aria-labelledby="telegram-diagnostics-title">
      <div className="admin-settings-card-head"><div><p className="admin-kicker">وضعیت ارسال نتیجه</p><h3 id="telegram-diagnostics-title">اتصال تلگرام</h3></div><span className={`admin-diagnostic-badge${diagnostics.configured ? " is-ready" : ""}`}><i />{diagnostics.configured ? "تنظیم‌شده" : "تنظیم نشده"}</span></div>
      <p className="admin-settings-explanation">{diagnostics.configured ? diagnostics.bot_validation === "valid" ? "ربات توسط تلگرام شناسایی شده." : diagnostics.bot_validation === "invalid" ? diagnostics.validation_error || "آخرین بررسی ربات موفق نبود." : "توکن و مقصد تنظیم شده‌اند؛ هنوز اعتبار ربات بررسی نشده." : "برای فعال‌شدن، متغیرهای ربات و مقصد باید در محیط API تنظیم شوند."} پیام فقط به مقصد تنظیم‌شده در سرور می‌ره؛ خواندن پیام از اینجا قابل تشخیص نیست.</p>
      <div className="admin-telegram-metrics"><Metric label="پذیرفته‌شده" value={diagnostics.success_count} /><Metric label="ناموفق" value={diagnostics.failure_count} /><Metric label="آخرین موفقیت" value={diagnostics.last_successful_acceptance} /><Metric label="آخرین خطا" value={diagnostics.last_failed_attempt} /><Metric label="آخرین تست" value={diagnostics.last_test_at} /></div>
      {diagnostics.last_failure_summary && <p className="admin-telegram-last-error"><strong>توضیح امن:</strong> {diagnostics.last_failure_summary}</p>}
      <div className="admin-settings-actions"><button className="admin-secondary-button" type="button" disabled={Boolean(telegramAction)} onClick={() => void telegramRequest("validate")}>{telegramAction === "validate" ? <><span className="admin-spinner" />در حال بررسی…</> : "بررسی اعتبار ربات"}</button><button className="admin-primary" type="button" disabled={!diagnostics.configured || Boolean(telegramAction)} onClick={() => void telegramRequest("test")}>{telegramAction === "test" ? <><span className="admin-spinner" />در حال ارسال…</> : "ارسال پیام تست"}</button></div>
      <small className="admin-telegram-footnote">وضعیت «موفق» یعنی Telegram API پیام را پذیرفته؛ خواندن پیام توسط صاحب چت قابل راستی‌آزمایی نیست.</small>
    </section>}
  </div>;
}

function Metric({ label, value }: { readonly label: string; readonly value: string | number | null }) {
  return <div><span>{label}</span><strong>{typeof value === "number" ? faNumber.format(value) : value ? formatUtc(value) : "—"}</strong></div>;
}
function formatUtc(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}
