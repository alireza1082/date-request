import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminApiError, getAdminCsrf, getAdminSession, loginAdmin, logoutAdmin } from "./admin-api";
import { ActivityManagement } from "./ActivityManagement";
import "./admin.css";

type AuthState = "checking" | "login" | "ready" | "unavailable";
type AdminSection = "overview" | "activities" | "history" | "settings";

const sections: readonly { readonly id: AdminSection; readonly label: string; readonly glyph: string }[] = [
  { id: "overview", label: "نمای کلی", glyph: "⌂" },
  { id: "activities", label: "قرارها و چرخ", glyph: "◉" },
  { id: "history", label: "تاریخچه", glyph: "◷" },
  { id: "settings", label: "تنظیمات", glyph: "⚙" },
];

export function AdminApp() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<AdminSection>("overview");

  const refreshSession = useCallback(async () => {
    setAuth("checking");
    setError("");
    try {
      await getAdminCsrf();
      await getAdminSession();
      setAuth("ready");
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 401) {
        setAuth("login");
        return;
      }
      setAuth("unavailable");
      setError(cause instanceof Error ? cause.message : "اتصال به پنل مدیریت ممکن نشد.");
    }
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    const expire = () => {
      setAuth("login");
      setError("نشست مدیریت پایان یافته؛ دوباره وارد شو.");
      void getAdminCsrf().catch(() => undefined);
    };
    window.addEventListener("datewheel:admin-unauthorized", expire);
    return () => window.removeEventListener("datewheel:admin-unauthorized", expire);
  }, []);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const challenge = await getAdminCsrf();
      await loginAdmin(password, challenge.csrf_token);
      await getAdminCsrf();
      setPassword("");
      setAuth("ready");
    } catch (cause) {
      setError(cause instanceof AdminApiError && cause.status === 401
        ? "ورود انجام نشد؛ رمز عبور را دوباره بررسی کن."
        : cause instanceof Error ? cause.message : "ورود ممکن نشد؛ کمی بعد دوباره امتحان کن.");
      if (cause instanceof AdminApiError && cause.status === 503) setAuth("unavailable");
    } finally { setBusy(false); }
  };

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await getAdminCsrf();
      await logoutAdmin(fresh.csrf_token);
      setAuth("login");
      setPassword("");
      setError("از پنل خارج شدی.");
      void getAdminCsrf().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خروج انجام نشد.");
      if (cause instanceof AdminApiError && cause.status === 401) setAuth("login");
    } finally { setBusy(false); }
  };

  if (auth === "checking") {
    return <main className="admin-gate" dir="rtl"><div className="admin-loading" role="status"><span className="admin-spinner" />در حال بررسی نشست مدیریت…</div></main>;
  }

  if (auth === "unavailable") {
    return <main className="admin-gate" dir="rtl"><section className="admin-login-card">
      <AdminBrand />
      <p className="admin-kicker">پنل مدیریت</p>
      <h1>فعلاً نمی‌تونیم وارد پنل بشیم</h1>
      <p className="admin-muted">تنظیمات یا ارتباط سرویس مدیریت در دسترس نیست. تجربهٔ اصلی Date Wheel همچنان جداگانه کار می‌کند.</p>
      {error && <p className="admin-alert" role="alert">{error}</p>}
      <button className="admin-primary" type="button" onClick={() => void refreshSession()}>دوباره تلاش کن</button>
      <a className="admin-back-link" href="/">بازگشت به چرخ</a>
    </section></main>;
  }

  if (auth === "login") {
    return <main className="admin-gate" dir="rtl">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <AdminBrand />
        <p className="admin-kicker">فضای اختصاصی صاحب چرخ</p>
        <h1 id="admin-login-title">خوش اومدی، مدیرِ قرارها</h1>
        <p className="admin-muted">برای مدیریت قرارها و دیدن گزارش‌ها، رمز مدیریتت رو وارد کن.</p>
        <form className="admin-login-form" onSubmit={(event) => void submitLogin(event)}>
          <label htmlFor="admin-password">رمز عبور</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} maxLength={128} required autoFocus />
          {error && <p className="admin-alert" role="alert">{error}</p>}
          <button className="admin-primary" type="submit" disabled={busy || password.length === 0}>
            {busy ? <><span className="admin-spinner" />در حال بررسی…</> : "ورود به پنل"}
          </button>
        </form>
        <a className="admin-back-link" href="/">بازگشت به تجربهٔ چرخ</a>
      </section>
    </main>;
  }

  return <div className="admin-layout" dir="rtl">
    <header className="admin-topbar">
      <AdminBrand />
      <div className="admin-topbar-actions"><span className="admin-online"><i />مدیریت امن</span>
        <button className="admin-logout" type="button" disabled={busy} onClick={() => void signOut()}>خروج</button>
      </div>
    </header>
    <div className="admin-frame">
      <aside className="admin-sidebar" aria-label="بخش‌های پنل مدیریت">
        <p className="admin-sidebar-caption">مدیریت Date Wheel</p>
        <nav>{sections.map((item) => <button key={item.id} type="button"
          className={`admin-nav-item${section === item.id ? " is-active" : ""}`}
          aria-current={section === item.id ? "page" : undefined}
          onClick={() => setSection(item.id)}>
          <span className="admin-nav-glyph" aria-hidden="true">{item.glyph}</span><span>{item.label}</span>
          {(item.id === "history" || item.id === "settings") && <span className="admin-nav-soon">به‌زودی</span>}
        </button>)}</nav>
        <div className="admin-sidebar-note"><span>✳</span><p>هر انتخاب کوچک،<br />یک خاطرهٔ تازه می‌سازه.</p></div>
      </aside>
      <main className="admin-content">
        <div className="admin-page-heading"><div><p className="admin-kicker">پنل صاحب چرخ</p><h1>{sections.find((item) => item.id === section)?.label}</h1></div>
          <a className="admin-public-link" href="/">دیدن تجربهٔ عمومی <span aria-hidden="true">↗</span></a></div>
        {error && <p className="admin-alert" role="status">{error}</p>}
        {section === "overview" ? <section className="admin-welcome-card">
          <span className="admin-welcome-ornament" aria-hidden="true">✳</span>
          <p className="admin-kicker">همه‌چیز برای یک قرار خوب</p>
          <h2>از اینجا، چرخِ قرارها رو بچین.</h2>
          <p>قرارها، حال‌وهوا و سورپرایزهای فصلی رو اینجا مدیریت می‌کنی. بخش‌های پنل به‌تدریج در دسترس قرار می‌گیرن.</p>
          <div className="admin-welcome-seal"><span>DATE<br />WHEEL</span><b>✦</b></div>
        </section> : section === "activities" ? <ActivityManagement /> : <section className="admin-welcome-card admin-soon-card"><p className="admin-kicker">در حال آماده‌سازی</p><h2>این بخش به‌زودی آماده می‌شه.</h2><p>فعلاً می‌تونی تجربهٔ عمومی چرخ رو ببینی.</p><a className="admin-primary admin-link-button" href="/">رفتن به چرخ</a></section>}
      </main>
    </div>
    <nav className="admin-mobile-nav" aria-label="پیمایش پنل مدیریت">{sections.map((item) => <button key={item.id} type="button"
      className={section === item.id ? "is-active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
      <span aria-hidden="true">{item.glyph}</span>{item.label}</button>)}</nav>
  </div>;
}

function AdminBrand() {
  return <a className="admin-brand" href="/admin" aria-label="Date Wheel، خانهٔ پنل مدیریت">
    <span className="admin-brand-mark" aria-hidden="true">✳</span>
    <span><strong>چرخِ قرار</strong><small>DATE WHEEL · STUDIO</small></span>
  </a>;
}
