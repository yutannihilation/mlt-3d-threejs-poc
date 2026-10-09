import { columnValue, decodeTileColumns, type MltColumnLayer } from "@maplibre/mlt-wasm";
import { LAYER } from "./config";
import { type LineIds, lineIds } from "./lines";
import { type TileFrame, type TileIndex, tileFrame } from "./transform";

/** A decoded tile: the layer as `decodeTileColumns` returns it, plus the line ids and the frame. */
export interface LineTile {
  readonly index: TileIndex;
  readonly layer: MltColumnLayer;
  readonly ids: LineIds;
  /**
   * Each feature's id, and the other way round. A feature crossing several tiles is clipped into
   * a piece per tile, and its id is how the pieces find each other.
   */
  readonly featureIds: FeatureIds;
  readonly frame: TileFrame;
  /** The layer's z grid: metres are `toElevation(z, zStep)`. */
  readonly zStep: number;
}

export interface FeatureIds {
  readonly idOfFeature: Float64Array;
  readonly featureOfId: ReadonlyMap<number, number>;
}

/**
 * Index the layer's feature ids. Throws unless every feature has one, unique in the layer:
 * without them, a flight's pieces in different tiles cannot be found (see
 * scripts/build-tiles.sh, which gives every feature one).
 */
export function featureIds(layer: MltColumnLayer): FeatureIds {
  const { ids, name } = layer;
  if (ids === undefined) {
    throw new Error(
      `layer "${name}" has no feature ids; build the tiles with scripts/build-tiles.sh`,
    );
  }
  const featureOfId = new Map<number, number>();
  for (let f = 0; f < layer.featureCount; f++) {
    const id = columnValue(ids, f);
    if (id === undefined) throw new Error(`feature ${f} of layer "${name}" has no id`);
    const other = featureOfId.get(id);
    if (other !== undefined) {
      throw new Error(`features ${other} and ${f} of layer "${name}" share the id ${id}`);
    }
    featureOfId.set(id, f);
  }
  return { idOfFeature: ids.values, featureOfId };
}

export function tileUrl(template: string, { z, x, y }: TileIndex): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Throws when the layer is missing, repeated, or not 3D, or its feature ids are (see `featureIds`). */
export function lineTile(data: Uint8Array, index: TileIndex): LineTile {
  const { layers } = decodeTileColumns(data, { layers: [LAYER] });
  if (layers.length !== 1) {
    throw new Error(`tile has ${layers.length} layers named "${LAYER}", expected one`);
  }
  const [layer] = layers;
  const { extent, geometry } = layer;
  if (geometry.dimension !== 3) throw new Error(`layer "${LAYER}" has no z coordinates`);
  return {
    index,
    layer,
    ids: lineIds(layer),
    featureIds: featureIds(layer),
    frame: tileFrame(index, extent, geometry.zStep),
    zStep: geometry.zStep,
  };
}

/**
 * `null` for a tile with nothing to draw: one the server has no data for (404 or 204), or with
 * fewer than two vertices, which make no segment.
 */
export async function fetchLineTile(
  url: string,
  index: TileIndex,
  signal?: AbortSignal,
): Promise<LineTile | null> {
  const response = await fetch(url, { signal });
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const tile = lineTile(new Uint8Array(await response.arrayBuffer()), index);
  return tile.ids.lineOfVertex.length >= 2 ? tile : null;
}
