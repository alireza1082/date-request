import { isMoodId, type MoodId } from "../../data/moods";

export const MAX_INVITATION_LINK_LENGTH = 900;
export const MAX_INVITATION_GREETING_LENGTH = 100;
export const MAX_INVITATION_TITLE_LENGTH = 52;
const INVITATION_HASH_PREFIX = "#invite=";
const INVITATION_TOKEN_LIMIT = MAX_INVITATION_LINK_LENGTH;

export interface InvitationConfig {
  readonly mood: MoodId;
  readonly greeting?: string;
  readonly title?: string;
}

export interface InvitationReadResult {
  readonly invitation: InvitationConfig | null;
  readonly invalid: boolean;
}

function cleanShortText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`Invitation ${field} must be text.`);
  const withoutControls = Array.from(value.normalize("NFC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isBidiOverride = (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
    return codePoint < 32 || codePoint === 127 || isBidiOverride ? " " : character;
  }).join("");
  const normalized = withoutControls.replace(/\s+/g, " ").trim();
  if (Array.from(normalized).length > maximum) throw new RangeError(`Invitation ${field} is too long.`);
  return normalized || undefined;
}

export function validateInvitation(value: unknown): InvitationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invitation data must be an object.");
  }

  const data = value as Record<string, unknown>;
  const allowedKeys = new Set(["version", "mood", "greeting", "title"]);
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) throw new TypeError("Invitation data has unknown fields.");
  if (data.version !== undefined && data.version !== 1) throw new TypeError("Invitation version is unsupported.");
  const mood = data.mood === undefined ? "surprise" : data.mood;
  if (!isMoodId(mood)) throw new TypeError("Invitation mood is invalid.");

  const greeting = cleanShortText(data.greeting, "greeting", MAX_INVITATION_GREETING_LENGTH);
  const title = cleanShortText(data.title, "title", MAX_INVITATION_TITLE_LENGTH);
  if (!greeting && !title) throw new TypeError("An invitation needs a short title or greeting.");

  return {
    mood,
    ...(greeting ? { greeting } : {}),
    ...(title ? { title } : {}),
  };
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(token: string): string {
  if (!token || token.length > INVITATION_TOKEN_LIMIT || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new TypeError("Invitation link is malformed.");
  }
  const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeInvitation(config: InvitationConfig): string {
  const safe = validateInvitation(config);
  const payload = JSON.stringify({ version: 1, ...safe });
  return encodeBase64Url(payload);
}

export function decodeInvitation(token: string): InvitationConfig {
  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(token));
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw error;
    throw new TypeError("Invitation data could not be read.");
  }
  return validateInvitation(payload);
}

export function createInvitationUrl(config: InvitationConfig, currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = `${INVITATION_HASH_PREFIX.slice(1)}${encodeInvitation(config)}`;
  const result = url.toString();
  if (result.length > MAX_INVITATION_LINK_LENGTH) throw new RangeError("Invitation link is too long.");
  return result;
}

export function readInvitationFromLocation(hash: string, href: string): InvitationReadResult {
  if (!hash || !hash.startsWith(INVITATION_HASH_PREFIX)) return { invitation: null, invalid: false };
  try {
    if (href.length > MAX_INVITATION_LINK_LENGTH) throw new RangeError("Invitation link is too long.");
    const token = hash.slice(INVITATION_HASH_PREFIX.length);
    return { invitation: decodeInvitation(token), invalid: false };
  } catch {
    return { invitation: null, invalid: true };
  }
}
