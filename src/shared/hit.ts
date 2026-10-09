import { columnValue, featureGeometry, toElevation } from "@maplibre/mlt-wasm";
import type { LineTile } from "./tile";

/** What the tooltip shows of a hovered feature. */
export interface Hit {
  readonly properties: Record<string, number | string | boolean>;
  /** The hovered feature's lowest and highest altitude over its pieces in view, in metres. */
  readonly altitude: readonly [number, number];
  /** How many tiles in view hold a piece of it. */
  readonly tiles: number;
}

/**
 * Feature `feature` of `tile`: its properties, and its altitude range over its pieces in the
 * tiles in view, found by its id. A tile listed more than once (world copies) counts once.
 */
export function describeFeature(tile: LineTile, feature: number, inView: Iterable<LineTile>): Hit {
  const { layer } = tile;
  const properties: Record<string, number | string | boolean> = {};
  for (const column of layer.properties) {
    const value = columnValue(column, feature);
    if (value === undefined) continue;
    properties[column.name] = column.type === "bool" ? value === 1 : value;
  }
  const featureId = tile.featureIds.idOfFeature[feature];
  // The feature's piece in each tile in view.
  const pieces = new Map<LineTile, number>();
  for (const t of inView) {
    const f = t.featureIds.featureOfId.get(featureId);
    if (f !== undefined) pieces.set(t, f);
  }
  let [lo, hi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const [t, f] of pieces) {
    // The piece's z are every third value of its vertices; each tile has its own z grid, and
    // metres grow with z, so only the extremes need converting.
    const { vertices } = featureGeometry(t.layer, f);
    let [min, max] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let i = 2; i < vertices.length; i += 3) {
      if (vertices[i] < min) min = vertices[i];
      if (vertices[i] > max) max = vertices[i];
    }
    lo = Math.min(lo, toElevation(min, t.zStep));
    hi = Math.max(hi, toElevation(max, t.zStep));
  }
  return { properties, altitude: [lo, hi], tiles: pieces.size };
}
