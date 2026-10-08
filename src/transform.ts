import { Matrix4 } from "three";

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

export function tileFrame(tile: TileIndex, extent: number, zStep: number): TileFrame {
  const tiles = 2 ** tile.z;
  return {
    origin: [tile.x / tiles, tile.y / tiles],
    scale: 1 / (extent * tiles),
    zScale: 10 ** zStep,
    zOffset: -10000,
  };
}

/**
 * The clip-space transform that maps the CSS pixel at `(px, py)` of a `width x height`
 * canvas onto the whole viewport, so a 1 x 1 render target sees exactly that pixel.
 * Linear in homogeneous coordinates, so it composes with any projection.
 */
export function pickMatrix(px: number, py: number, width: number, height: number): Matrix4 {
  const nx = (2 * (px + 0.5)) / width - 1;
  const ny = 1 - (2 * (py + 0.5)) / height;
  // Move the pixel's centre to the origin, then scale a pixel up to the viewport.
  return new Matrix4().makeScale(width, height, 1).setPosition(-width * nx, -height * ny, 0);
}
