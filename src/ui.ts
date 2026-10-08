import { ALTITUDE_RANGE_M } from "./config";
import type { ColorMode, Hit, Stats } from "./layer";
import { altitudeGradientCss, DIRECTION_COLORS } from "./style";
import "./style.css";

const DIRECTION_LABELS: Record<string, string> = {
  departure: "departing HND",
  arrival: "arriving at HND",
  local: "departing and arriving at HND",
};

/** Tooltip lines for a hovered flight. */
export function describeHit({ properties, altitude }: Hit): string[] {
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
  return lines;
}

export interface Panel {
  setStats(stats: Stats): void;
  /** Show the tooltip at a point in CSS pixels of the map container, or hide it with `null`. */
  setTooltip(at: { x: number; y: number; lines: string[] } | null): void;
}

/** The legend, colour mode switch, stats and tooltip overlaid on `container`. */
export function createPanel(container: HTMLElement, onColorMode: (mode: ColorMode) => void): Panel {
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
      <label><input type="radio" name="mode" value="altitude" checked /> altitude, from z in the shader</label>
      <label><input type="radio" name="mode" value="direction" /> direction, from a per-line texture</label>
    </fieldset>
    <div class="legend legend-altitude">
      <div class="ramp" style="background: ${altitudeGradientCss()}"></div>
      <div class="ticks"><span>${lo.toLocaleString("en-US")} m</span><span>${hi.toLocaleString("en-US")} m+</span></div>
    </div>
    <div class="legend legend-direction" hidden>${Object.keys(DIRECTION_COLORS).map(swatch).join(" ")}</div>
    <p class="stats">Loading tiles…</p>
    <p class="note">Each tile's decoded <code>Int32Array</code> is the vertex buffer; the shader places it on the map. MapLibre + Three.js.</p>
  `;
  for (const input of panel.querySelectorAll<HTMLInputElement>("input[name=mode]")) {
    input.addEventListener("change", () => {
      const mode = input.value as ColorMode;
      panel.querySelector<HTMLElement>(".legend-altitude")!.hidden = mode !== "altitude";
      panel.querySelector<HTMLElement>(".legend-direction")!.hidden = mode !== "direction";
      onColorMode(mode);
    });
  }
  const stats = panel.querySelector<HTMLParagraphElement>(".stats")!;
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.hidden = true;
  container.append(panel, tooltip);

  return {
    setStats({ tiles, lines, vertices }) {
      const fmt = (n: number) => n.toLocaleString("en-US");
      stats.textContent = `${fmt(tiles)} tiles · ${fmt(lines)} lines · ${fmt(vertices)} vertices`;
    },
    setTooltip(at) {
      tooltip.hidden = at === null;
      if (!at) return;
      tooltip.replaceChildren(
        ...at.lines.map((line, i) => {
          const el = document.createElement(i === 0 ? "strong" : "div");
          el.textContent = line;
          return el;
        }),
      );
      tooltip.style.transform = `translate(${at.x + 12}px, ${at.y + 12}px)`;
    },
  };
}
