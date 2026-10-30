import "@fontsource-variable/vazirmatn";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AdminApp } from "./features/admin/AdminApp";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The root element was not found.");
}

const application = window.location.pathname.startsWith("/admin") ? <AdminApp /> : <App />;

createRoot(rootElement).render(
  <StrictMode>
    {application}
  </StrictMode>,
);
