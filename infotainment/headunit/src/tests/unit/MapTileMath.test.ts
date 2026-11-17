import { angleDelta, coverRadius, levelFor, project, tilesFor, wrapX, zoomForSpeed } from "@/components/drive/map/tile-math";
import { tileUrl } from "@/components/drive/map/tile-layer";
import { MAP_TILE_URL, MAP_ZOOM_FAST, MAP_ZOOM_STILL, TILE_SIZE } from "@/data/map-config";

test("projects to the slippy-map tile grid", () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    // Brandenburg Gate, checked against the asinh(tan(lat)) form of the formula.
    const p = project(52.5163, 13.3777, 16);
    expect(p.x).toBeCloseTo(9012054.007, 2);
    expect(p.y).toBeCloseTo(5502457.94, 2);
    expect([Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)]).toEqual([35203, 21493]);
});

test("the tile set covers every corner of the panel at any rotation, nearest first", () => {
    const [width, height] = [450, 520];
    const pivot = { x: width / 2, y: height * 0.65 };
    const radius = coverRadius(width, height, pivot);
    const center = project(48.5941, 8.866, 18);
    const tiles = tilesFor(center, 18, radius);
    const have = new Set(tiles.filter((t) => t.inView).map((t) => `${t.x}/${t.y}`));

    for (let deg = 0; deg < 360; deg += 15) {
        const a = (deg * Math.PI) / 180;
        for (const [cx, cy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
            const [dx, dy] = [cx - pivot.x, cy - pivot.y];
            const x = center.x + dx * Math.cos(a) - dy * Math.sin(a);
            const y = center.y + dx * Math.sin(a) + dy * Math.cos(a);
            expect(have).toContain(`${Math.floor(x / TILE_SIZE)}/${Math.floor(y / TILE_SIZE)}`);
        }
    }
    expect(tiles[0]).toMatchObject({ x: Math.floor(center.x / TILE_SIZE), y: Math.floor(center.y / TILE_SIZE), inView: true });
    // A buffer ring around the view loads ahead.
    expect(tiles.some((t) => !t.inView)).toBe(true);
});

test("tiles wrap at the antimeridian for the request but keep their place", () => {
    const tiles = tilesFor(project(0, 179.9999, 2), 2, 10);
    expect(tiles.map((t) => t.x)).toContain(4);
    expect(wrapX(4, 2)).toBe(0);
    expect(wrapX(-1, 2)).toBe(3);
    expect(tileUrl(MAP_TILE_URL.dark, { x: 4, y: 1, z: 2 })).toBe("maptiles://dark/2/0/1");
});

test("zoom goes out with speed and stays in bounds", () => {
    expect(zoomForSpeed(null)).toBe(MAP_ZOOM_STILL);
    expect(zoomForSpeed(0)).toBe(MAP_ZOOM_STILL);
    expect(zoomForSpeed(40)).toBeLessThan(MAP_ZOOM_STILL);
    expect(zoomForSpeed(40)).toBeGreaterThan(MAP_ZOOM_FAST);
    expect(zoomForSpeed(200)).toBe(MAP_ZOOM_FAST);
    expect(zoomForSpeed(-5)).toBe(MAP_ZOOM_STILL);
});

test("the tile level only changes past a hysteresis band", () => {
    expect(levelFor(17.4, null)).toBe(17);
    expect(levelFor(17.6, 17)).toBe(17);
    expect(levelFor(17.66, 17)).toBe(18);
    expect(levelFor(17.4, 18)).toBe(18);
    expect(levelFor(17.3, 18)).toBe(17);
});

test("angles turn the short way round", () => {
    expect(angleDelta(359, 1)).toBe(2);
    expect(angleDelta(1, 359)).toBe(-2);
    expect(angleDelta(90, 270)).toBe(180);
    expect(angleDelta(720, 10)).toBe(10);
});
