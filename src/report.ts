// The exportable district review: a before-and-after sheet drawn on canvas in
// the same plan-sheet style as the game, using the page's loaded fonts.
import type { Scores } from "./types";
import { fmtMoney } from "./types";
import { grade } from "./score";
import { THEME } from "./theme";

export interface ReportData {
  placeName: string;
  dateText: string;
  before: Scores;
  after: Scores;
  parkingRemovedM2: number;
  parkingRemovedPct: number;
  railKmBuilt: number;
  stationsAdded: number;
  buildingsAdded: number;
  greenAddedM2: number;
  streetsImproved: number;
  spent?: number;
  budget?: number;
}

const W = 1000;
const H = 1240;

export function renderReport(d: ReportData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // Sheet and title-block frame
  ctx.fillStyle = "#F4F4EF";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.lineWidth = 0.75;
  ctx.strokeRect(32, 32, W - 64, H - 64);

  const left = 72;
  ctx.fillStyle = THEME.ink;
  ctx.font = "700 20px Overpass, sans-serif";
  ctx.fillText("UPZONE", left, 92);
  ctx.font = "700 46px Overpass, sans-serif";
  ctx.fillText("DISTRICT REVIEW", left, 148);
  ctx.font = "500 17px 'Overpass Mono', monospace";
  ctx.fillStyle = "rgba(34,48,60,0.65)";
  ctx.fillText(`${d.placeName} · ${d.dateText}`, left, 180);

  // Approval stamp, upper right
  const sx = W - 190;
  const sy = 150;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.14);
  ctx.strokeStyle = THEME.brick;
  ctx.fillStyle = THEME.brick;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, 66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "600 13px 'Overpass Mono', monospace";
  ctx.fillText("DISTRICT", 0, -40);
  ctx.font = "700 64px Overpass, sans-serif";
  ctx.fillText(grade(d.after.overall), 0, 24);
  ctx.font = "600 13px 'Overpass Mono', monospace";
  ctx.fillText(`SCORE ${d.after.overall}`, 0, 52);
  ctx.restore();
  ctx.textAlign = "left";

  // Rule under the header
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, 250);
  ctx.lineTo(W - left, 250);
  ctx.stroke();

  // Before-and-after bars
  const rows: [string, number, number][] = [
    ["WALKABILITY", d.before.walk, d.after.walk],
    ["TRANSIT", d.before.transit, d.after.transit],
    ["DENSITY", d.before.density, d.after.density],
    ["GREEN VS. ASPHALT", d.before.green, d.after.green],
    ["OVERALL", d.before.overall, d.after.overall],
  ];
  let y = 300;
  const barX = left;
  const barW = W - left * 2 - 130;
  for (const [name, before, after] of rows) {
    ctx.fillStyle = THEME.ink;
    ctx.font = "600 15px Overpass, sans-serif";
    ctx.fillText(name, barX, y);

    // before, a faint witness mark; after, the committed line
    ctx.fillStyle = "rgba(34,48,60,0.18)";
    ctx.fillRect(barX, y + 12, barW * (before / 100), 9);
    ctx.fillStyle = name === "OVERALL" ? THEME.brick : THEME.ink;
    ctx.fillRect(barX, y + 26, barW * (after / 100), 9);

    ctx.font = "600 20px 'Overpass Mono', monospace";
    ctx.fillStyle = THEME.ink;
    ctx.fillText(String(after), barX + barW + 24, y + 32);
    const delta = after - before;
    if (delta !== 0) {
      ctx.font = "600 15px 'Overpass Mono', monospace";
      ctx.fillStyle = delta > 0 ? THEME.green : THEME.brick;
      ctx.fillText(`${delta > 0 ? "+" : ""}${delta}`, barX + barW + 76, y + 32);
    }
    y += 84;
  }

  // Interventions
  y += 10;
  ctx.strokeStyle = THEME.ink;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(W - left, y);
  ctx.stroke();
  y += 44;
  ctx.fillStyle = THEME.ink;
  ctx.font = "700 22px Overpass, sans-serif";
  ctx.fillText("WHAT CHANGED", left, y);
  y += 40;

  const lines: string[] = [];
  if (d.parkingRemovedM2 > 0) {
    lines.push(
      `Surface parking removed: ${Math.round(d.parkingRemovedM2).toLocaleString()} m² (${Math.round(d.parkingRemovedPct * 100)}% of the original asphalt)`,
    );
  }
  if (d.railKmBuilt > 0) {
    lines.push(
      `New light rail: ${d.railKmBuilt.toFixed(1)} km with ${d.stationsAdded} ${d.stationsAdded === 1 ? "station" : "stations"}`,
    );
  }
  if (d.buildingsAdded > 0) {
    lines.push(`Buildings built or redeveloped: ${d.buildingsAdded}`);
  }
  if (d.greenAddedM2 > 0) {
    lines.push(`New parks and plazas: ${Math.round(d.greenAddedM2).toLocaleString()} m²`);
  }
  if (d.streetsImproved > 0) {
    lines.push(
      `Streets improved: ${d.streetsImproved} (trees, road diets, or pedestrianized)`,
    );
  }
  if (d.spent !== undefined && d.budget !== undefined) {
    lines.push(`Project spending: ${fmtMoney(d.spent)} of the ${fmtMoney(d.budget)} budget`);
  }
  if (!lines.length) {
    lines.push("No changes yet. The existing conditions are the baseline.");
  }
  ctx.font = "400 17px 'Public Sans', sans-serif";
  for (const line of lines) {
    ctx.fillStyle = THEME.ink;
    ctx.fillText("■", left, y);
    ctx.fillText(line, left + 26, y);
    y += 34;
  }

  // Footer
  ctx.strokeStyle = THEME.ink;
  ctx.beginPath();
  ctx.moveTo(left, H - 92);
  ctx.lineTo(W - left, H - 92);
  ctx.stroke();
  ctx.font = "500 13px 'Overpass Mono', monospace";
  ctx.fillStyle = "rgba(34,48,60,0.65)";
  ctx.fillText("Drafted with Upzone · Map data © OpenStreetMap contributors", left, H - 64);

  return canvas;
}
