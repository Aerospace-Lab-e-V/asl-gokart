// The look of the headunit's map, as a MapLibre style on the OpenMapTiles schema (OpenFreeMap's
// planet tiles). Monochrome and without labels: ground, water, buildings and roads. Raceways are a
// shade brighter, so a kart track stands out. One structure, two palettes.
// Zooms below are MapLibre's (512 px tiles): MapLibre z15–18 is the pack's z16–19.

export type Theme = "dark" | "light";
export const THEMES: Theme[] = ["dark", "light"];

export const VECTOR_TILES = "https://tiles.openfreemap.org/planet";
export const ATTRIBUTION = "© OpenMapTiles © OpenStreetMap contributors";

const PALETTE = {
    dark: {
        ground: "#0d0e10",
        green: "#111316",
        water: "#151a21",
        building: "#17191c",
        casing: "#0d0e10",
        path: "#25282c",
        minor: "#2c2f34",
        major: "#3a3e44",
        raceway: "#50555d",
        rail: "#202226",
    },
    light: {
        ground: "#f2f2f0",
        green: "#eaeae6",
        water: "#dbe0e6",
        building: "#e4e4e0",
        casing: "#d4d4d0",
        path: "#e0e0dc",
        minor: "#ffffff",
        major: "#ffffff",
        raceway: "#b8b8b4",
        rail: "#d8d8d4",
    },
} satisfies Record<Theme, Record<string, string>>;

/** Line width in px from MapLibre z12 to z18, exponential like real widths. */
const width = (z12: number, z18: number) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, z12, 18, z18];

const roads = (classes: string[]) => ["all", ["==", ["geometry-type"], "LineString"], ["in", ["get", "class"], ["literal", classes]]];

const MAJOR = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const MINOR = ["minor", "service"];
const PATHS = ["track", "path"];

export function mapStyle(theme: Theme): object {
    const c = PALETTE[theme];
    const line = (id: string, filter: unknown, color: string, w: unknown, extra: object = {}) => ({
        id,
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": w, ...extra },
    });
    return {
        version: 8,
        sources: { omt: { type: "vector", url: VECTOR_TILES, attribution: ATTRIBUTION } },
        layers: [
            { id: "ground", type: "background", paint: { "background-color": c.ground } },
            { id: "green", type: "fill", source: "omt", "source-layer": "landcover", paint: { "fill-color": c.green } },
            { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": c.green } },
            { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
            { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": c.water, "line-width": width(0.5, 4) } },
            { id: "building", type: "fill", source: "omt", "source-layer": "building", paint: { "fill-color": c.building } },
            line("rail", ["==", ["get", "class"], "rail"], c.rail, width(0.5, 3)),
            line("path", roads(PATHS), c.path, width(0.5, 4)),
            // Casings only show in light: there they are the edge of the white roads.
            line("minor-casing", roads(MINOR), c.casing, width(1.5, 20)),
            line("major-casing", roads(MAJOR), c.casing, width(2.5, 30)),
            line("raceway", roads(["raceway"]), c.raceway, width(1.5, 22)),
            line("minor", roads(MINOR), c.minor, width(1, 16)),
            line("major", roads(MAJOR), c.major, width(2, 26)),
        ],
    };
}
