import { featureGeometry, isPresent, toElevation } from "@maplibre/mlt-wasm";
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
  MercatorCoordinate,
} from "maplibre-gl";
import * as THREE from "three";
import {
  LINE_WIDTH_PX,
  PICK_RADIUS_PX,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
  TILE_SIZE,
  TILE_URL,
} from "./config";
import {
  lineMaterial,
  pickMaterial,
  rampTexture,
  segmentGeometry,
  type Shared,
  styleTexture,
} from "./gpu";
import { decodePickId, MAX_SLOTS } from "./pick-id";
import { lineStyleTexels } from "./style";
import { fetchLineTile, type LineTile, tileUrl } from "./tile";
import { pickMatrix, type TileIndex } from "./transform";

// Pass the 8-bit colours through untouched.
THREE.ColorManagement.enabled = false;

/** Tiles kept in memory, beyond those in view. */
const MAX_CACHED_TILES = 256;

export type ColorMode = "altitude" | "direction";

/** A tile on the GPU: its geometry, style texture, and one pair of meshes per world copy drawn. */
interface ReadyTile {
  readonly tile: LineTile;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly style: THREE.DataTexture;
  readonly draw: THREE.ShaderMaterial;
  readonly pick: THREE.ShaderMaterial;
  readonly meshes: Map<number, { draw: THREE.Mesh; pick: THREE.Mesh }>;
}

type TileEntry =
  | { state: "loading" }
  | { state: "empty" }
  | { state: "error"; error: unknown }
  | ({ state: "ready" } & ReadyTile);

interface Drawn {
  tile: ReadyTile;
  wrap: number;
  /** Local positions to clip space. */
  matrix: THREE.Matrix4;
}

export interface Hit {
  readonly properties: Record<string, number | string | boolean>;
  /** The hovered line's lowest and highest altitude, in metres. */
  readonly altitude: readonly [number, number];
}

interface PendingPick {
  x: number;
  y: number;
  resolve: (hit: Hit | null) => void;
  reject: (error: unknown) => void;
}

export interface Stats {
  tiles: number;
  lines: number;
  vertices: number;
}

function key({ z, x, y }: TileIndex): string {
  return `${z}/${x}/${y}`;
}

/**
 * A MapLibre custom layer drawing a 3D line layer with Three.js on the map's WebGL context.
 *
 * Each tile's decoded vertex buffer is the GPU's vertex buffer; the transform to the map runs
 * in the shader. Picking renders ids into a one-pixel target under the cursor.
 */
export class LinesLayer implements CustomLayerInterface {
  readonly id = "lines";
  readonly type = "custom";
  readonly renderingMode = "3d";

  colorMode: ColorMode = "altitude";

  private map!: MapLibreMap;
  private renderer!: THREE.WebGLRenderer;
  private shared!: Shared;
  private readonly scene = new THREE.Scene();
  /** Every mesh carries its full model-view-projection matrix, so the camera is the identity. */
  private readonly camera = new THREE.Camera();
  private readonly pickTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
  });
  private readonly pickPixel = new Uint8Array(4);
  private readonly tiles = new Map<string, TileEntry>();
  /** Tile keys by last use, least recent first. */
  private readonly lru = new Set<string>();
  private drawn: Drawn[] = [];
  private pending: PendingPick | null = null;
  private highlighted: { tile: ReadyTile; line: number } | null = null;

  private readonly onStats: (stats: Stats) => void;

  constructor(onStats: (stats: Stats) => void) {
    this.onStats = onStats;
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.matrixWorldAutoUpdate = false;
    this.shared = { ramp: rampTexture(), metre: MercatorCoordinate.fromLngLat([0, 0], 1).z };
    map.on("idle", this.reportStats);
  }

  onRemove(): void {
    this.map.off("idle", this.reportStats);
    for (const entry of this.tiles.values()) if (entry.state === "ready") this.release(entry);
    this.pickTarget.dispose();
    this.shared.ramp.dispose();
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: CustomRenderMethodInput,
  ): void {
    const main = new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix);
    this.drawn = this.tilesToDraw().map(({ tile, wrap }) => ({
      tile,
      wrap,
      matrix: main
        .clone()
        .multiply(
          new THREE.Matrix4().makeTranslation(
            tile.tile.frame.origin[0] + wrap,
            tile.tile.frame.origin[1],
            0,
          ),
        ),
    }));
    this.renderer.resetState();
    // The pick pass goes first, so that MapLibre's state is reset after both by the layer's return.
    if (this.pending) {
      const { x, y, resolve, reject } = this.pending;
      this.pending = null;
      this.renderPick(x, y).then(resolve, reject);
    }
    this.renderDraw();
  }

  /** The line under a point in CSS pixels of the map canvas, read back after the next frame. */
  pick(x: number, y: number): Promise<Hit | null> {
    this.pending?.resolve(null);
    const promise = new Promise<Hit | null>((resolve, reject) => {
      this.pending = { x, y, resolve, reject };
    });
    this.map.triggerRepaint();
    return promise;
  }

  private renderDraw(): void {
    const canvas = this.map.getCanvas();
    const resolution = new THREE.Vector2(canvas.clientWidth, canvas.clientHeight);
    const colorMode = this.colorMode === "altitude" ? 0 : 1;
    this.scene.clear();
    for (const { tile, wrap, matrix } of this.drawn) {
      const { draw } = this.meshesFor(tile, wrap);
      tile.draw.uniforms.uResolution.value = resolution;
      tile.draw.uniforms.uWidth.value = LINE_WIDTH_PX;
      tile.draw.uniforms.uColorMode.value = colorMode;
      tile.draw.uniforms.uHighlight.value =
        this.highlighted?.tile === tile ? this.highlighted.line : -1;
      draw.matrixWorld.copy(matrix);
      this.scene.add(draw);
    }
    this.camera.projectionMatrix.identity();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Draw the ids of every tile into one pixel: the pick matrix maps the cursor's pixel onto
   * the whole 1 x 1 target, and the lines are drawn wide enough to cover the pick radius.
   */
  private async renderPick(x: number, y: number): Promise<Hit | null> {
    const canvas = this.map.getCanvas();
    if (this.drawn.length > MAX_SLOTS)
      throw new Error(`${this.drawn.length} tiles drawn, more than the pick id holds`);
    this.scene.clear();
    this.drawn.forEach(({ tile, wrap, matrix }, slot) => {
      const { pick } = this.meshesFor(tile, wrap);
      // The target's pixel is the cursor's pixel, so a width in pixels is a width in target pixels.
      tile.pick.uniforms.uResolution.value = new THREE.Vector2(1, 1);
      tile.pick.uniforms.uWidth.value = LINE_WIDTH_PX + 2 * PICK_RADIUS_PX;
      tile.pick.uniforms.uSlot.value = slot;
      pick.matrixWorld.copy(matrix);
      this.scene.add(pick);
    });
    this.camera.projectionMatrix.copy(pickMatrix(x, y, canvas.clientWidth, canvas.clientHeight));
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, this.camera);
    // The read is queued into a pixel buffer now and resolves frames later; the draw pass that
    // follows in this frame must go to the canvas, and slots name tiles of this frame's list.
    const read = this.renderer.readRenderTargetPixelsAsync(
      this.pickTarget,
      0,
      0,
      1,
      1,
      this.pickPixel,
    );
    this.renderer.setRenderTarget(null);
    const drawn = this.drawn;
    await read;
    const id = decodePickId(this.pickPixel);
    const hit = id && drawn[id.slot] ? { tile: drawn[id.slot].tile, line: id.line } : null;
    this.setHighlight(hit);
    return hit && this.describe(hit.tile.tile, hit.line);
  }

  private describe(tile: LineTile, line: number): Hit {
    const { layer, ids } = tile;
    const feature = ids.featureOfLine[line];
    const properties: Record<string, number | string | boolean> = {};
    for (const column of layer.properties) {
      if (!isPresent(column, feature)) continue;
      const value = column.values[feature];
      properties[column.name] = column.type === "bool" ? value === 1 : value;
    }
    // The line's vertices, as a view: its z are every third value.
    const g = featureGeometry(layer, feature);
    if (g.kind !== "line") throw new Error(`feature ${feature} is not a line`);
    const { zStep } = layer.geometry;
    if (zStep === undefined) throw new Error("the layer has no z");
    let [lo, hi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const run of g.lines) {
      // Each run of the feature is its own line id, in order.
      if (ids.lineOfVertex[run.firstVertex] !== line) continue;
      for (let i = 2; i < run.vertices.length; i += 3) {
        const z = run.vertices[i];
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
    return { properties, altitude: [toElevation(lo, zStep), toElevation(hi, zStep)] };
  }

  private setHighlight(next: { tile: ReadyTile; line: number } | null): void {
    const same = next?.tile === this.highlighted?.tile && next?.line === this.highlighted?.line;
    if (same) return;
    this.highlighted = next;
    this.map.triggerRepaint();
  }

  private meshesFor(tile: ReadyTile, wrap: number): { draw: THREE.Mesh; pick: THREE.Mesh } {
    let meshes = tile.meshes.get(wrap);
    if (!meshes) {
      const mesh = (material: THREE.ShaderMaterial) => {
        const m = new THREE.Mesh(tile.geometry, material);
        // Its matrixWorld is the full projection, set each frame, so Three.js must neither recompute nor cull it.
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        m.matrixWorldAutoUpdate = false;
        return m;
      };
      meshes = { draw: mesh(tile.draw), pick: mesh(tile.pick) };
      tile.meshes.set(wrap, meshes);
    }
    return meshes;
  }

  private upload(tile: LineTile): ReadyTile {
    const { texels, height } = lineStyleTexels(tile.layer, tile.ids.featureOfLine);
    const style = styleTexture(texels, height);
    return {
      tile,
      geometry: segmentGeometry(tile.layer.geometry.vertices, tile.ids.lineOfVertex),
      style,
      draw: lineMaterial(tile.frame, style, this.shared),
      pick: pickMaterial(tile.frame, this.shared),
      meshes: new Map(),
    };
  }

  private release(tile: ReadyTile): void {
    if (this.highlighted?.tile === tile) this.setHighlight(null);
    tile.geometry.dispose();
    tile.style.dispose();
    tile.draw.dispose();
    tile.pick.dispose();
  }

  /** The covering tiles, each replaced by its nearest loaded ancestor until it loads. */
  private tilesToDraw(): { tile: ReadyTile; wrap: number }[] {
    const covering = this.map.coveringTiles({
      tileSize: TILE_SIZE,
      minzoom: TILE_MIN_ZOOM,
      maxzoom: TILE_MAX_ZOOM,
    });
    const out = new Map<string, { tile: ReadyTile; wrap: number }>();
    for (const id of covering) {
      const index: TileIndex = { z: id.canonical.z, x: id.canonical.x, y: id.canonical.y };
      this.request(index);
      for (let z = index.z; z >= TILE_MIN_ZOOM; z--) {
        const shift = index.z - z;
        const k = key({ z, x: index.x >> shift, y: index.y >> shift });
        const entry = this.tiles.get(k);
        if (entry?.state === "ready") {
          out.set(`${k}@${id.wrap}`, { tile: entry, wrap: id.wrap });
          break;
        }
        // An empty or failed tile has nothing to show, and no ancestor should stand in for it.
        if (entry && entry.state !== "loading") break;
      }
    }
    return [...out.values()];
  }

  private request(index: TileIndex): void {
    const k = key(index);
    this.lru.delete(k);
    this.lru.add(k);
    if (this.tiles.has(k)) return;
    this.tiles.set(k, { state: "loading" });
    fetchLineTile(tileUrl(TILE_URL, index), index)
      .then((tile) => {
        // A tile with fewer than two vertices has no segment to draw.
        const ready = tile && tile.layer.geometry.vertices.length >= 6;
        this.tiles.set(k, ready ? { state: "ready", ...this.upload(tile) } : { state: "empty" });
      })
      .catch((error: unknown) => {
        console.error(`tile ${k}:`, error);
        this.tiles.set(k, { state: "error", error });
      })
      .finally(() => {
        this.evict();
        this.map.triggerRepaint();
      });
  }

  private evict(): void {
    for (const k of this.lru) {
      if (this.tiles.size <= MAX_CACHED_TILES) break;
      const entry = this.tiles.get(k);
      if (entry?.state === "loading") continue;
      if (entry?.state === "ready") this.release(entry);
      this.tiles.delete(k);
      this.lru.delete(k);
    }
  }

  private readonly reportStats = () => {
    const covering = this.map.coveringTiles({
      tileSize: TILE_SIZE,
      minzoom: TILE_MIN_ZOOM,
      maxzoom: TILE_MAX_ZOOM,
    });
    const ready = covering.flatMap((id) => {
      const entry = this.tiles.get(key(id.canonical));
      return entry?.state === "ready" ? [entry.tile] : [];
    });
    this.onStats({
      tiles: ready.length,
      lines: ready.reduce((n, t) => n + t.ids.featureOfLine.length, 0),
      vertices: ready.reduce((n, t) => n + t.ids.lineOfVertex.length, 0),
    });
  };
}
