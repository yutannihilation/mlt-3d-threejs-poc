import type { MltColumnLayer } from "@maplibre/mlt-wasm";
import { metreScale, type TileFrame } from "../shared/transform";

/**
 * A layer's lines tessellated into flat ribbons: horizontal strips of a width in metres along
 * each line, with rounded joins and butt ends, as indexed triangles ready for a stock Three.js
 * mesh. Positions are final, so no shader of our own is needed to draw them.
 */
export interface Ribbons {
  /** `x, y, z` per ribbon vertex, in Web Mercator units relative to the tile's corner. */
  readonly positions: Float32Array;
  /** The altitude of each ribbon vertex in metres, for colouring. */
  readonly metres: Float32Array;
  /** The line id of each ribbon vertex, as `lineIds` numbers the lines. */
  readonly lines: Uint32Array;
  /**
   * Where each line's ribbon vertices start; line `l` has `lineStart[l] .. lineStart[l + 1]`.
   * A line's vertices are contiguous, so one line can be recoloured as a range.
   */
  readonly lineStart: Uint32Array;
  /** Three ribbon vertices per triangle. */
  readonly indices: Uint32Array;
}

/** Turns up to this angle get a miter; sharper ones a round join. */
export const MITER_MAX_TURN = (15 * Math.PI) / 180;
/** The largest angle one triangle of a round join spans. */
export const ARC_STEP = (15 * Math.PI) / 180;

/** A typed array that doubles its capacity as it fills. */
class Growing<A extends Float32Array | Uint32Array> {
  array: A;
  length = 0;
  private readonly make: (n: number) => A;

  constructor(make: (n: number) => A, capacity: number) {
    this.make = make;
    this.array = make(Math.max(16, capacity));
  }

  reserve(n: number): void {
    if (this.length + n <= this.array.length) return;
    const grown = this.make(Math.max(this.array.length * 2, this.length + n));
    grown.set(this.array.subarray(0, this.length));
    this.array = grown;
  }

  done(): A {
    return this.array.slice(0, this.length) as A;
  }
}

/**
 * Tessellate every line of `layer` into ribbons `width` metres wide. Line `l` has the layer's
 * vertices `lineVertices[l] .. lineVertices[l + 1]` (`LineIds.lineStart`). `metre` is one metre in
 * Web Mercator units at the equator; a metre at a point is wider by `cosh(π (1 − 2y))` of its
 * Mercator `y`, so a ribbon keeps its width in metres at every latitude, and its altitude its
 * scale. A line that collapses to a point makes no ribbon.
 */
export function tessellateRibbons(
  layer: MltColumnLayer,
  lineVertices: Uint32Array,
  frame: TileFrame,
  metre: number,
  width: number,
): Ribbons {
  const { dimension, vertices } = layer.geometry;
  if (dimension !== 3) throw new Error(`layer "${layer.name}" has no z coordinates`);
  const { origin, scale, zScale, zOffset } = frame;
  // Mostly two ribbon vertices per source vertex, more at round joins.
  const estimate = (vertices.length / 3) * 2;
  const positions = new Growing((n) => new Float32Array(n), estimate * 3);
  const metres = new Growing((n) => new Float32Array(n), estimate);
  const lines = new Growing((n) => new Uint32Array(n), estimate);
  const indices = new Growing((n) => new Uint32Array(n), estimate * 3);
  const lineCount = lineVertices.length - 1;
  const lineStart = new Uint32Array(lineCount + 1);

  // The current point: its line, position and altitude in Mercator units relative to the tile,
  // and half the ribbon's width there.
  let line = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let pm = 0;
  let half = 0;
  /** A ribbon vertex at the current point, offset by `(ox, oy)` times the half width. */
  const vertex = (ox: number, oy: number): number => {
    const index = lines.length;
    positions.reserve(3);
    positions.array[positions.length++] = px + ox * half;
    positions.array[positions.length++] = py + oy * half;
    positions.array[positions.length++] = pz;
    metres.reserve(1);
    metres.array[metres.length++] = pm;
    lines.reserve(1);
    lines.array[lines.length++] = line;
    return index;
  };
  const triangle = (a: number, b: number, c: number) => {
    indices.reserve(3);
    indices.array[indices.length++] = a;
    indices.array[indices.length++] = b;
    indices.array[indices.length++] = c;
  };

  for (line = 0; line < lineCount; line++) {
    lineStart[line] = lines.length;
    const v = vertices.subarray(lineVertices[line] * 3, lineVertices[line + 1] * 3);
    const n = v.length / 3;
    // The points of the line, skipping repeats of the previous x, y: a segment of no
    // length has no direction to extrude across.
    const points: number[] = [];
    for (let k = 0; k < n; k++) {
      const last = points.at(-1);
      if (last === undefined || v[k * 3] !== v[last * 3] || v[k * 3 + 1] !== v[last * 3 + 1]) {
        points.push(k);
      }
    }
    const m = points.length;
    if (m < 2) continue;
    // Each segment's unit direction; tile coordinates and Mercator units share their axes.
    const dx = new Float64Array(m - 1);
    const dy = new Float64Array(m - 1);
    for (let i = 0; i + 1 < m; i++) {
      const [a, b] = [points[i] * 3, points[i + 1] * 3];
      const [ex, ey] = [v[b] - v[a], v[b + 1] - v[a + 1]];
      const len = Math.hypot(ex, ey);
      dx[i] = ex / len;
      dy[i] = ey / len;
    }

    // The pair (left, right) the previous segment starts from.
    let fromLeft = 0;
    let fromRight = 0;
    for (let i = 0; i < m; i++) {
      const k = points[i] * 3;
      px = v[k] * scale;
      py = v[k + 1] * scale;
      pm = v[k + 2] * zScale + zOffset;
      // A metre at this latitude, in Mercator units.
      const local = metre * metreScale(origin[1] + py);
      pz = pm * local;
      half = 0.5 * width * local;
      // The pairs this point ends the incoming segment with, and starts the outgoing one from.
      let toLeft: number;
      let toRight: number;
      let nextLeft: number;
      let nextRight: number;
      if (i === 0 || i === m - 1) {
        const s = i === 0 ? 0 : m - 2;
        // The normal, to the left of the direction.
        const [nx, ny] = [-dy[s], dx[s]];
        toLeft = nextLeft = vertex(nx, ny);
        toRight = nextRight = vertex(-nx, -ny);
      } else {
        const [ax, ay, bx, by] = [dx[i - 1], dy[i - 1], dx[i], dy[i]];
        const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by); // signed, left positive
        const [n0x, n0y, n1x, n1y] = [-ay, ax, -by, bx];
        if (Math.abs(turn) <= MITER_MAX_TURN) {
          // One pair on the bisector, pushed out so that both edges keep their width.
          const [mx, my] = [n0x + n1x, n0y + n1y];
          const stretch = 1 / (mx * n0x + my * n0y);
          toLeft = nextLeft = vertex(mx * stretch, my * stretch);
          toRight = nextRight = vertex(-mx * stretch, -my * stretch);
        } else {
          toLeft = vertex(n0x, n0y);
          toRight = vertex(-n0x, -n0y);
          nextLeft = vertex(n1x, n1y);
          nextRight = vertex(-n1x, -n1y);
          // A fan around the point on the outer side, which is the right of a left turn.
          const centre = vertex(0, 0);
          const side = turn > 0 ? -1 : 1;
          const steps = Math.ceil(Math.abs(turn) / ARC_STEP);
          let previous = side > 0 ? toLeft : toRight;
          for (let j = 1; j < steps; j++) {
            const angle = (turn * j) / steps;
            const [c, s] = [Math.cos(angle), Math.sin(angle)];
            const arc = vertex(side * (n0x * c - n0y * s), side * (n0x * s + n0y * c));
            triangle(centre, previous, arc);
            previous = arc;
          }
          triangle(centre, previous, side > 0 ? nextLeft : nextRight);
        }
      }
      if (i > 0) {
        triangle(fromLeft, fromRight, toLeft);
        triangle(fromRight, toRight, toLeft);
      }
      fromLeft = nextLeft;
      fromRight = nextRight;
    }
  }
  lineStart[lineCount] = lines.length;
  return {
    positions: positions.done(),
    metres: metres.done(),
    lines: lines.done(),
    lineStart,
    indices: indices.done(),
  };
}
