export interface TileIndex {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/**
 * What the vertex shader needs to place a tile's decoded integers: the tile in Web Mercator
 * units (`0 .. 1` across the world) and the z grid in metres. Five numbers per tile; every
 * vertex is transformed on the GPU.
 */
export interface TileFrame {
  /** The tile's north-west corner. */
  readonly origin: readonly [number, number];
  /** Mercator units per tile coordinate. */
  readonly scale: number;
  /** Metres are `z * zScale + zOffset`, the layer's `-10000 + z * 10 ** zStep`. */
  readonly zScale: number;
  readonly zOffset: number;
}

/**
 * How many times wider a metre is at Mercator `y` than at the equator, `1 / cos(latitude)`: for a
 * Mercator `y`, `cosh(π (1 − 2y))`.
 */
export function metreScale(y: number): number {
  return Math.cosh(Math.PI * (1 - 2 * y));
}

export function tileFrame(tile: TileIndex, extent: number, zStep: number): TileFrame {
  const tiles = 2 ** tile.z;
  return {
    origin: [tile.x / tiles, tile.y / tiles],
    scale: 1 / (extent * tiles),
    zScale: 10 ** zStep,
    zOffset: -10000,
  };
}
