// Entry for the vendored vector tile decoder. Pbf also writes, which the tests
// use to build synthetic tiles.
export { default as Pbf } from "pbf";
export { VectorTile, classifyRings } from "@mapbox/vector-tile";
