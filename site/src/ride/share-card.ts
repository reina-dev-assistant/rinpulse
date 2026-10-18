import type { Medal } from "./modes.ts";
import type { RouteDef } from "./routes.ts";
import { Track } from "./track.ts";

export interface CardData {
  title: string;
  route: RouteDef;
  time: string;
  stats: { label: string; value: string }[];
  medal: { medal: Medal; label: string } | null;
  footer: string;
}

const MEDAL_COLORS: Record<Medal, string> = { gold: "#e9b949", silver: "#c7ccd3", bronze: "#c9844f" };

/** A 1080×1350 PNG of the ride (Instagram portrait), drawn on a canvas so nothing leaves the browser. */
export async function renderCard(data: CardData): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  await document.fonts?.ready;
  const font = (weight: number, px: number) => `${weight} ${px}px "Plus Jakarta Sans Variable", system-ui, sans-serif`;

  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#06303d");
  bg.addColorStop(1, "#0a6580");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.fillStyle = "#58c4de";
  g.font = font(700, 34);
  g.fillText(data.title, 80, 120);
  g.fillStyle = "#ffffff";
  g.font = font(800, 96);
  g.fillText(data.route.name, 80, 230);

  // Elevation profile of the route.
  const track = new Track(data.route);
  const px = 80;
  const py = 300;
  const pw = W - 160;
  const ph = 260;
  let lo = Infinity;
  let hi = -Infinity;
  const n = 160;
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const y = track.elevationAt((data.route.lengthM * i) / n);
    ys.push(y);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  const span = Math.max(20, hi - lo);
  g.beginPath();
  g.moveTo(px, py + ph);
  ys.forEach((y, i) => g.lineTo(px + (pw * i) / n, py + ph - ((y - lo) / span) * ph * 0.9));
  g.lineTo(px + pw, py + ph);
  g.closePath();
  g.fillStyle = "rgba(88,196,222,0.28)";
  g.fill();
  g.strokeStyle = "#58c4de";
  g.lineWidth = 5;
  g.beginPath();
  ys.forEach((y, i) => {
    const x = px + (pw * i) / n;
    const yy = py + ph - ((y - lo) / span) * ph * 0.9;
    if (i === 0) g.moveTo(x, yy);
    else g.lineTo(x, yy);
  });
  g.stroke();

  g.fillStyle = "#ffffff";
  g.font = font(800, 190);
  g.fillText(data.time, 72, 790);

  g.font = font(600, 34);
  data.stats.slice(0, 4).forEach((s, i) => {
    const x = 80 + (i % 2) * 470;
    const y = 900 + Math.floor(i / 2) * 150;
    g.fillStyle = "rgba(255,255,255,0.65)";
    g.font = font(600, 32);
    g.fillText(s.label, x, y);
    g.fillStyle = "#ffffff";
    g.font = font(800, 64);
    g.fillText(s.value, x, y + 70);
  });

  if (data.medal) {
    const cx = W - 170;
    const cy = 690;
    g.fillStyle = MEDAL_COLORS[data.medal.medal];
    g.beginPath();
    g.arc(cx, cy, 90, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#06303d";
    g.font = font(800, 34);
    g.textAlign = "center";
    g.fillText(data.medal.label, cx, cy + 12);
    g.textAlign = "left";
  }

  g.fillStyle = "rgba(255,255,255,0.7)";
  g.font = font(600, 30);
  g.fillText(data.footer, 80, H - 80);

  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
