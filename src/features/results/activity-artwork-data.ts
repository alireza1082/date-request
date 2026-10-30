import type { Activity } from "../../data/activities";

const artworkById: Readonly<Record<string, string>> = {
  cafe: `<path d="M47 66h54l-5 39c-1 9-8 15-17 15H68c-9 0-16-6-17-15l-4-39Z" fill="#fff9f0" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M101 73h11c12 0 15 19 4 25l-18 8M56 111h42M61 55c-8-10 7-12 0-22m20 22c-8-10 7-12 0-22" fill="none" stroke="ACCENT" stroke-width="5" stroke-linecap="round"/>`,
  cinema: `<path d="m56 55 54-8 10 67-54 8-10-67Z" fill="#fff9f0" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="m58 68 54-8m-48 20 54-8m-48 20 54-8" fill="none" stroke="ACCENT" stroke-width="4"/><path d="m75 75 1 5m30-5 1 5m-27 14 1 5m30-5 1 5" stroke="#c6946d" stroke-width="4" stroke-linecap="round"/><path d="m75 109 25-4-2-19-25 4 2 19Z" fill="#e8bd8c" stroke="ACCENT" stroke-width="4"/>`,
  "ice-cream": `<path d="m59 90 22 48 24-48H59Z" fill="#e5b887" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M58 86c-9-16 8-26 18-22 0-17 25-20 31-5 17-2 25 16 13 29H62c-2 0-3-1-4-2Z" fill="#fff9f0" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="m71 110 22 11m-16-25 19 10m-7-29 1 2" stroke="#c6946d" stroke-width="4" stroke-linecap="round"/>`,
  dinner: `<circle cx="80" cy="83" r="36" fill="#fff9f0" stroke="ACCENT" stroke-width="5"/><circle cx="80" cy="83" r="23" fill="none" stroke="#d6a47d" stroke-width="4"/><path d="M42 53v31m-8-31v13m16-13v13m-8 18v39m76-70v70m-8-70v18c0 8 16 8 16 0V53" fill="none" stroke="ACCENT" stroke-width="5" stroke-linecap="round"/>`,
  breakfast: `<path d="M45 99c3-26 22-47 45-48 14 0 26 8 31 22l-4 35c-9 13-25 19-42 16-18-3-31-12-30-25Z" fill="#fff9f0" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M57 96c5-13 15-22 27-25m-20 42c8-14 19-23 32-27m-14 39c8-13 18-20 30-24m-60-12c10 1 18 4 25 10" fill="none" stroke="#c6946d" stroke-width="4" stroke-linecap="round"/>`,
  walk: `<path d="M35 111c15-19 28-25 42-12 12 11 22 7 35-11 7-9 15-11 24-7v46H35v-16Z" fill="#e0eadb" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M59 85c0-11 8-19 19-19m10-14c0-9 7-16 16-16m-13 19c0 10-8 18-18 18m24-13c10 0 18 8 18 18" fill="none" stroke="ACCENT" stroke-width="5" stroke-linecap="round"/><path d="M78 71c13 0 20 9 20 20-12 0-20-8-20-20Z" fill="#f7eadc" stroke="#62806a" stroke-width="4"/>`,
  picnic: `<path d="M48 82h64l-8 49H56l-8-49Z" fill="#e6c49b" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M43 79h74v20H43zM64 78c0-13 7-23 16-23s16 10 16 23M67 99v29m26-29v29" fill="#fff9f0" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M80 84V99m-19-15v13m38-13v13" stroke="#c6946d" stroke-width="4" stroke-linecap="round"/>`,
  bookshop: `<path d="M40 56c17-6 31-3 40 8v62c-10-10-24-14-40-8V56Zm80 0c-17-6-31-3-40 8v62c10-10 24-14 40-8V56Z" fill="#fff9f0" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M51 73c9-2 17-1 23 3m-23 13c9-2 17-1 23 3m32-19c7-4 15-5 23-3m-23 19c7-4 15-5 23-3" fill="none" stroke="#c6946d" stroke-width="4" stroke-linecap="round"/><path d="M80 64v62" stroke="ACCENT" stroke-width="4"/>`,
  museum: `<path d="m37 68 43-25 43 25H37Z" fill="#e8c99c" stroke="ACCENT" stroke-width="5" stroke-linejoin="round"/><path d="M45 73h70m-63 0v48m18-48v48m29-48v48m18-48v48M39 124h82" fill="none" stroke="ACCENT" stroke-width="5" stroke-linecap="round"/><path d="M66 57h28" stroke="#fff9f0" stroke-width="4" stroke-linecap="round"/>`,
  bowling: `<path d="M56 67c-8 0-14 9-14 22s6 21 14 21 14-8 14-21-6-22-14-22Zm24-8c-8 0-14 9-14 22s6 22 14 22 14-9 14-22-6-22-14-22Zm24 8c-8 0-14 9-14 22s6 21 14 21 14-8 14-21-6-22-14-22Z" fill="#fff9f0" stroke="ACCENT" stroke-width="4"/><path d="M49 82h14m10-5h14m10 5h14" stroke="#bc7772" stroke-width="4"/><circle cx="80" cy="124" r="15" fill="#d89183" stroke="ACCENT" stroke-width="4"/><circle cx="75" cy="120" r="2.5" fill="#fff9f0"/><circle cx="84" cy="119" r="2.5" fill="#fff9f0"/><circle cx="80" cy="128" r="2.5" fill="#fff9f0"/>`,
};

export function getIconArtworkSvg(iconId: string, color: string): string {
  const illustration = artworkById[iconId];
  if (!illustration) throw new RangeError(`No local illustration is defined for ${iconId}.`);
  const accent = /^#[0-9a-f]{6}$/i.test(color) ? color : "#995d68";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" fill="#f7ecdf"/><circle cx="80" cy="80" r="61" fill="none" stroke="#d9bda3" stroke-width="1.5"/><path d="M80 21v7m0 104v7M21 80h7m104 0h7" stroke="#c39675" stroke-width="2" stroke-linecap="round"/><g>${illustration.replaceAll("ACCENT", accent)}</g></svg>`;
}

export function getActivityArtworkSvg(activity: Activity): string {
  return getIconArtworkSvg(activity.icon || activity.id, activity.color);
}

export function getIconArtworkDataUrl(iconId: string, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getIconArtworkSvg(iconId, color))}`;
}

export function getActivityArtworkDataUrl(activity: Activity): string {
  return getIconArtworkDataUrl(activity.icon || activity.id, activity.color);
}
