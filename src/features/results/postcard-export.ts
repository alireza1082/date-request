import type { Activity } from "../../data/activities";
import { getActivityArtworkDataUrl } from "./activity-artwork-data";

const POSTCARD_WIDTH = 1080;
const POSTCARD_HEIGHT = 1350;
const FONT_FAMILY = '"Vazirmatn Variable", Vazirmatn, Tahoma, sans-serif';

export function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): readonly string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawRoundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function loadArtwork(activity: Activity): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The postcard illustration could not be loaded."));
    image.src = getActivityArtworkDataUrl(activity);
  });
}

function drawCenteredLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  y: number,
  lineHeight: number,
  maxLines: number,
): number {
  const lines = wrapCanvasText(context, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => context.fillText(line, POSTCARD_WIDTH / 2, y + index * lineHeight, maxWidth));
  return y + lines.length * lineHeight;
}

export async function createPostcardBlob(activity: Activity): Promise<Blob> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error("Postcard saving is not supported in this browser.");
  }
  if (document.fonts?.ready) await document.fonts.ready;
  if (document.fonts?.load) await document.fonts.load(`600 40px ${FONT_FAMILY}`);

  const canvas = document.createElement("canvas");
  canvas.width = POSTCARD_WIDTH;
  canvas.height = POSTCARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A canvas is not available for postcard saving.");

  const artwork = await loadArtwork(activity);
  const background = context.createLinearGradient(0, 0, POSTCARD_WIDTH, POSTCARD_HEIGHT);
  background.addColorStop(0, "#fffaf2");
  background.addColorStop(0.54, "#f8efe3");
  background.addColorStop(1, "#f2e6d9");
  context.fillStyle = background;
  context.fillRect(0, 0, POSTCARD_WIDTH, POSTCARD_HEIGHT);

  context.strokeStyle = "#d2b79d";
  context.lineWidth = 2;
  drawRoundedRectangle(context, 36, 36, POSTCARD_WIDTH - 72, POSTCARD_HEIGHT - 72, 34);
  context.stroke();
  context.strokeStyle = "rgba(157, 101, 102, 0.13)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(540, 218, 298, 0.18, Math.PI - 0.18);
  context.stroke();
  context.beginPath();
  context.arc(540, 1170, 250, Math.PI + 0.15, Math.PI * 2 - 0.15);
  context.stroke();

  context.direction = "rtl";
  context.textAlign = "center";
  context.fillStyle = "#9a6269";
  context.font = `600 27px ${FONT_FAMILY}`;
  context.fillText("چرخِ قرار  ·  یه بهونه برای باهم‌بودن", 540, 120, 820);
  context.fillStyle = "#b1846e";
  context.font = `500 25px ${FONT_FAMILY}`;
  context.fillText("پیشنهادِ کوچولوی ما", 540, 175, 760);

  context.drawImage(artwork, 400, 218, 280, 280);
  context.fillStyle = "#46383a";
  context.font = `700 65px ${FONT_FAMILY}`;
  let textY = drawCenteredLines(context, activity.title, 850, 585, 82, 2);

  context.fillStyle = "#73615c";
  context.font = `400 36px ${FONT_FAMILY}`;
  textY = drawCenteredLines(context, activity.description, 790, textY + 42, 59, 3);

  context.fillStyle = "#b1846e";
  context.fillRect(475, Math.max(910, textY + 28), 130, 2);
  const suggestionTop = 1000;
  context.fillStyle = "rgba(255, 250, 242, 0.76)";
  drawRoundedRectangle(context, 116, suggestionTop, 848, 192, 25);
  context.fill();
  context.strokeStyle = "rgba(157, 101, 102, 0.18)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#9a6269";
  context.font = `600 27px ${FONT_FAMILY}`;
  context.fillText("یه پیشنهادِ کوچولو", 540, suggestionTop + 54, 720);
  context.fillStyle = "#5d4a49";
  context.font = `500 34px ${FONT_FAMILY}`;
  drawCenteredLines(context, activity.suggestion, 750, suggestionTop + 112, 48, 2);

  context.fillStyle = "#a58c7e";
  context.font = `500 23px ${FONT_FAMILY}`;
  context.fillText("امیدوارم بهونه‌ی خوبی برای باهم‌بودن باشه.", 540, 1260, 820);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The postcard image could not be created."));
    }, "image/png");
  });
}

export async function downloadPostcard(activity: Activity): Promise<void> {
  const blob = await createPostcardBlob(activity);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `date-wheel-${activity.id}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
