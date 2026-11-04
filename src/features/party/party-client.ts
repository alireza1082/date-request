import { readPublicJson } from "../../data/public-read";
import { selectRandomIndex, type RandomUint32 } from "../wheel/engine/wheel-engine";
import { bundledPartyArtwork, type PartyCatalog, type PartyOutcome } from "./party-catalog";

export class PartyCatalogError extends Error {
  constructor(message = "سناریوهای شب دونفره در دسترس نیستند.") {
    super(message);
    this.name = "PartyCatalogError";
  }
}

const mediaPath = /^\/api\/party\/media\/[a-f0-9-]{36}$/;
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function parsePartyCatalog(value: unknown): PartyCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PartyCatalogError();
  const record = value as Record<string, unknown>;
  if ((record.selection_mode !== "random" && record.selection_mode !== "fixed") || !Array.isArray(record.scenarios) || record.scenarios.length < 1 || record.scenarios.length > 100) {
    throw new PartyCatalogError("فهرست سورپرایزها پاسخ معتبری نداشت.");
  }
  const seen = new Set<string>();
  const scenarios = record.scenarios.map((entry): PartyOutcome => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new PartyCatalogError();
    const item = entry as Record<string, unknown>;
    const strings = ["id", "title", "headline", "description", "alt", "artwork_key"] as const;
    if (strings.some((key) => typeof item[key] !== "string" || (item[key] as string).length > (key === "description" ? 320 : 200))
      || !idPattern.test(item.id as string) || seen.has(item.id as string)
      || !Array.isArray(item.steps) || item.steps.length < 3 || item.steps.length > 5
      || item.steps.some((step) => typeof step !== "string" || step.length < 1 || step.length > 180)
      || !Object.hasOwn(bundledPartyArtwork, item.artwork_key as string)
      || (item.image_url !== null && (typeof item.image_url !== "string" || !mediaPath.test(item.image_url)))) {
      throw new PartyCatalogError("اطلاعات یکی از سورپرایزها قابل نمایش نیست.");
    }
    seen.add(item.id as string);
    return {
      id: item.id as string,
      title: item.title as string,
      headline: item.headline as string,
      description: item.description as string,
      alt: item.alt as string,
      steps: item.steps as string[],
      artwork_key: item.artwork_key as string,
      image_url: item.image_url as string | null,
    };
  });
  if (record.selection_mode === "fixed" && scenarios.length !== 1) throw new PartyCatalogError("سناریوی ثابت تنظیم‌شده در دسترس نیست.");
  return { selection_mode: record.selection_mode, scenarios };
}

export function fetchPartyCatalog(): Promise<PartyCatalog> {
  return readPublicJson("/api/party", 512 * 1024).then(parsePartyCatalog).catch((error: unknown) => {
    if (error instanceof PartyCatalogError) throw error;
    throw new PartyCatalogError("اتصال به سورپرایزهای شب دونفره برقرار نشد؛ دوباره تلاش کن.");
  });
}

export function partyImage(outcome: Pick<PartyOutcome, "artwork_key" | "image_url">): string {
  return outcome.image_url ?? bundledPartyArtwork[outcome.artwork_key] ?? bundledPartyArtwork["neon-night"]!;
}

/** Stable visual target for fixed results; random mode uses the selected pool index. */
export function partyTargetSegment(outcome: PartyOutcome, poolIndex: number, mode: PartyCatalog["selection_mode"]): number {
  if (mode === "random") return poolIndex % 6;
  let hash = 2166136261;
  for (const character of outcome.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % 6;
}

export function selectPartyOutcome(catalog: PartyCatalog, randomUint32?: RandomUint32): { readonly outcome: PartyOutcome; readonly poolIndex: number; readonly segmentIndex: number } {
  const poolIndex = catalog.selection_mode === "fixed" || catalog.scenarios.length === 1
    ? 0
    : selectRandomIndex(catalog.scenarios.length, randomUint32);
  const outcome = catalog.scenarios[poolIndex];
  if (!outcome) throw new PartyCatalogError("سناریوی قابل‌استفاده‌ای برای چرخش پیدا نشد.");
  return { outcome, poolIndex, segmentIndex: partyTargetSegment(outcome, poolIndex, catalog.selection_mode) };
}
