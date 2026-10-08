import { featureGeometry, type MltColumnLayer } from "@maplibre/mlt-wasm";

/**
 * The lines of a layer, numbered in vertex order, as the two side buffers the GPU needs next
 * to the layer's own vertex buffer.
 *
 * `lineOfVertex` is read at element offsets 0 and 1 by consecutive instances: a segment whose
 * ends name different lines straddles two lines and is not drawn. The same number indexes
 * the per-line style texture and is what picking reads back. `featureOfLine` maps it to the
 * feature whose properties it carries.
 */
export interface LineIds {
  readonly lineOfVertex: Uint32Array;
  readonly featureOfLine: Uint32Array;
}

/** Throws when a feature is not a line: this renderer draws nothing else. */
export function lineIds(layer: MltColumnLayer): LineIds {
  const { dimension, vertices } = layer.geometry;
  const lineOfVertex = new Uint32Array(vertices.length / dimension);
  const featureOfLine: number[] = [];
  for (let f = 0; f < layer.featureCount; f++) {
    const g = featureGeometry(layer, f);
    if (g.kind !== "line") {
      throw new Error(`feature ${f} of layer "${layer.name}" is a ${g.kind}, expected a line`);
    }
    for (const line of g.lines) {
      const id = featureOfLine.length;
      featureOfLine.push(f);
      lineOfVertex.fill(id, line.firstVertex, line.firstVertex + line.vertices.length / dimension);
    }
  }
  return { lineOfVertex, featureOfLine: Uint32Array.from(featureOfLine) };
}
