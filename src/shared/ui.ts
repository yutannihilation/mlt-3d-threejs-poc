import { ALTITUDE_RANGE_M, RIBBON_WIDTH_M } from "./config";
import type { Hit } from "./hit";
import type { LineTile } from "./tile";
import { altitudeGradientCss, DIRECTION_COLORS } from "./style";
import "./style.css";

export type ColorMode = "altitude" | "direction";

export type Shape = "lines" | "ribbons";

export interface Stats {
  tiles: number;
  lines: number;
  vertices: number;
}

/** The tiles, lines and vertices of `tiles`. */
export function tileStats(tiles: readonly LineTile[]): Stats {
  return {
    tiles: tiles.length,
    lines: tiles.reduce((n, t) => n + t.ids.featureOfLine.length, 0),
    vertices: tiles.reduce((n, t) => n + t.ids.lineOfVertex.length, 0),
  };
}

const DIRECTION_LABELS: Record<string, string> = {
  departure: "departing HND",
  arrival: "arriving at HND",
  local: "departing and arriving at HND",
};

/** Tooltip lines for a hovered flight. */
export function describeHit({ properties, altitude, tiles }: Hit): string[] {
  const text = (key: string) => {
    const value = properties[key];
    return typeof value === "string" ? value : undefined;
  };
  const title = text("callsign") ?? text("registration") ?? text("icao") ?? "unknown";
  const aircraft = [text("type"), text("registration")].filter(Boolean).join(" · ");
  const lines = [title];
  if (aircraft) lines.push(aircraft);
  const direction = text("direction");
  if (direction !== undefined) lines.push(DIRECTION_LABELS[direction] ?? direction);
  const metres = (m: number) => Math.round(m).toLocaleString("en-US");
  lines.push(`${metres(altitude[0])} – ${metres(altitude[1])} m`);
  if (tiles > 1) lines.push(`across ${tiles} tiles in view`);
  return lines;
}

export interface Panel {
  setStats(stats: Stats): void;
  /** Show the tooltip at a point in CSS pixels of the map container, or hide it with `null`. */
  setTooltip(at: { x: number; y: number; lines: string[] } | null): void;
}

export interface PanelOptions {
  /** What the ribbons switch says about how this renderer makes ribbons. */
  readonly ribbons: string;
  /** HTML: how this renderer gets the tiles onto the GPU. */
  readonly note: string;
  /** The page of the other renderer, opened at the same camera. */
  readonly other: { readonly label: string; readonly href: string };
  readonly onColorMode: (mode: ColorMode) => void;
  readonly onShape: (shape: Shape) => void;
}

/** The legend, colour mode and shape switches, stats and tooltip overlaid on `container`. */
export function createPanel(container: HTMLElement, options: PanelOptions): Panel {
  const { onColorMode, onShape, other } = options;
  const [lo, hi] = ALTITUDE_RANGE_M;
  const panel = document.createElement("div");
  panel.className = "panel";
  const swatch = (name: string) => {
    const [r, g, b] = DIRECTION_COLORS[name];
    return `<span class="swatch" style="background: rgb(${r} ${g} ${b})"></span>${name}`;
  };
  panel.innerHTML = `
    <h1>MLT columns straight to the GPU</h1>
    <fieldset class="modes">
      <label><input type="radio" name="mode" value="altitude" checked /> colour by altitude</label>
      <label><input type="radio" name="mode" value="direction" /> colour by direction</label>
    </fieldset>
    <label class="toggle"><input type="checkbox" name="ribbons" /> ribbons, ${RIBBON_WIDTH_M.toLocaleString("en-US")} m wide, ${options.ribbons}</label>
    <div class="legend legend-altitude">
      <div class="ramp" style="background: ${altitudeGradientCss()}"></div>
      <div class="ticks"><span>${lo.toLocaleString("en-US")} m</span><span>${hi.toLocaleString("en-US")} m+</span></div>
    </div>
    <div class="legend legend-direction" hidden>${Object.keys(DIRECTION_COLORS).map(swatch).join(" ")}</div>
    <p class="stats">Loading tiles…</p>
    <p class="note">${options.note}</p>
    <p class="note"><a class="other" href="${other.href}">${other.label}</a> · <a href="./">about</a></p>
  `;
  // The map keeps its camera in the URL hash; carry it over.
  const link = panel.querySelector<HTMLAnchorElement>("a.other")!;
  link.addEventListener("click", () => {
    link.href = other.href + location.hash;
  });
  for (const input of panel.querySelectorAll<HTMLInputElement>("input[name=mode]")) {
    input.addEventListener("change", () => {
      const mode = input.value as ColorMode;
      panel.querySelector<HTMLElement>(".legend-altitude")!.hidden = mode !== "altitude";
      panel.querySelector<HTMLElement>(".legend-direction")!.hidden = mode !== "direction";
      onColorMode(mode);
    });
  }
  const ribbons = panel.querySelector<HTMLInputElement>("input[name=ribbons]")!;
  ribbons.addEventListener("change", () => onShape(ribbons.checked ? "ribbons" : "lines"));
  const stats = panel.querySelector<HTMLParagraphElement>(".stats")!;
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.hidden = true;
  container.append(panel, tooltip);
  let shown: readonly string[] | null = null;

  return {
    setStats({ tiles, lines, vertices }) {
      const fmt = (n: number) => n.toLocaleString("en-US");
      stats.textContent = `${fmt(tiles)} tiles · ${fmt(lines)} lines · ${fmt(vertices)} vertices`;
    },
    setTooltip(at) {
      tooltip.hidden = at === null;
      if (!at) return;
      // The same lines as last time only move.
      if (at.lines !== shown) {
        shown = at.lines;
        tooltip.replaceChildren(
          ...at.lines.map((line, i) => {
            const el = document.createElement(i === 0 ? "strong" : "div");
            el.textContent = line;
            return el;
          }),
        );
      }
      tooltip.style.transform = `translate(${at.x + 12}px, ${at.y + 12}px)`;
    },
  };
}
