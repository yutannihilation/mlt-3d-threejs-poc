import { decodeTileColumns, type MltColumnLayer } from "@maplibre/mlt-wasm";
import { LAYER } from "./config";
import { type LineIds, lineIds } from "./lines";
import { type TileFrame, type TileIndex, tileFrame } from "./transform";

/** A decoded tile: the layer as `decodeTileColumns` returns it, plus the line ids and the frame. */
export interface LineTile {
  readonly index: TileIndex;
  readonly layer: MltColumnLayer;
  readonly ids: LineIds;
  readonly frame: TileFrame;
}

export function tileUrl(template: string, { z, x, y }: TileIndex): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Throws when the layer is missing, repeated, or not 3D. */
export function lineTile(data: Uint8Array, index: TileIndex): LineTile {
  const { layers } = decodeTileColumns(data, { layers: [LAYER] });
  if (layers.length !== 1) {
    throw new Error(`tile has ${layers.length} layers named "${LAYER}", expected one`);
  }
  const [layer] = layers;
  const { extent, geometry } = layer;
  if (geometry.dimension !== 3) throw new Error(`layer "${LAYER}" has no z coordinates`);
  return { index, layer, ids: lineIds(layer), frame: tileFrame(index, extent, geometry.zStep) };
}

/** `null` for a tile the server has no data for (404 or 204). */
export async function fetchLineTile(url: string, index: TileIndex): Promise<LineTile | null> {
  const response = await fetch(url);
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return lineTile(new Uint8Array(await response.arrayBuffer()), index);
}
