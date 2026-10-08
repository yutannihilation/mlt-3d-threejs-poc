/** The tiles in `public/tiles`, built separately (see README). */
export const TILE_URL = `${import.meta.env.BASE_URL}tiles/{z}/{x}/{y}.mlt`;
/** The `--min-zoom` / `--max-zoom` the tiles were built with; beyond the max, tiles are overzoomed. */
export const TILE_MIN_ZOOM = 3;
export const TILE_MAX_ZOOM = 10;
/** The `--layer` the tiles were built with. */
export const LAYER = "flights";
/** Tile size in CSS pixels, MapLibre's 512 px convention. */
export const TILE_SIZE = 512;

/** Altitudes beyond this range are clamped to the ends of the colour ramp. */
export const ALTITUDE_RANGE_M: readonly [number, number] = [0, 12000];

/** Width of every line in CSS pixels. */
export const LINE_WIDTH_PX = 1.5;

/** Width of every ribbon in metres; ribbons are tessellated at this width. */
export const RIBBON_WIDTH_M = 1500;

/** How far from a line, in CSS pixels, the cursor still hovers it. */
export const PICK_RADIUS_PX = 4;

export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

export const INITIAL_VIEW = {
  center: [139.78, 35.55] as [number, number],
  zoom: 8,
  pitch: 60,
  bearing: -20,
};

export const DATA_ATTRIBUTION =
  'Flight data: <a href="https://www.adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> ' +
  '(<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>)';
