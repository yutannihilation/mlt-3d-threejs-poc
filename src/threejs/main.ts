import { createMap } from "../shared/map";
import { createPanel, describeHit } from "../shared/ui";
import { LinesLayer } from "./layer";

const map = createMap(document.getElementById("map")!);
const panel = createPanel(document.body, {
  ribbons: "tessellated on the CPU",
  note: "Each tile's decoded <code>Int32Array</code> is the vertex buffer; our shader places it on the map. MapLibre + Three.js.",
  other: { label: "deck.gl version", href: "deckgl.html" },
  onColorMode(mode) {
    lines.colorMode = mode;
    map.triggerRepaint();
  },
  onShape(shape) {
    lines.shape = shape;
    map.triggerRepaint();
  },
});
const lines = new LinesLayer((stats) => panel.setStats(stats));
map.on("load", () => map.addLayer(lines));
// For poking at the renderer from the console during development.
if (import.meta.env.DEV) Object.assign(window, { map, lines });

// One pick in flight at a time; the latest cursor position wins.
let pending: { x: number; y: number } | null = null;
let picking = false;
map.on("mousemove", (e) => {
  pending = e.point;
  void pickPending();
});
map.getCanvas().addEventListener("mouseleave", () => {
  pending = null;
  panel.setTooltip(null);
});

async function pickPending(): Promise<void> {
  if (picking || !pending || !map.getLayer(lines.id)) return;
  picking = true;
  try {
    while (pending) {
      const { x, y } = pending;
      pending = null;
      const hit = await lines.pick(x, y);
      panel.setTooltip(hit && { x, y, lines: describeHit(hit) });
    }
  } finally {
    picking = false;
  }
}
