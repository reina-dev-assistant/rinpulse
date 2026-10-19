import type { ThemeId } from "./routes.ts";

export type TreeKind = "pine" | "cemara" | "round" | "palm" | "banana" | "bamboo";

export interface Theme {
  skyTop: number;
  skyHorizon: number;
  fog: number;
  sun: number;
  sunDir: readonly [number, number, number];
  hemiSky: number;
  hemiGround: number;
  grass: number;
  dry: number;
  rock: number;
  sand: number;
  seabed: number;
  gravel: number;
  sea: number;
  /** A sea along the right side of the road. */
  hasSea: boolean;
  /** Metres of big rolling hills rising away from the road, and of small bumps beside it. */
  hillAmp: number;
  bumpAmp: number;
  trees: readonly TreeKind[];
  /** Trees per 100 m per side at high quality. */
  treeDensity: number;
  /** Where the forest stops, metres from the road centre. */
  treeReach: number;
  seed: number;
  /** Distant mountain ridges on the horizon. */
  ridge: number;
  /** How tall the distant ridges stand, metres. */
  ridgeHeight: number;
  /** Farmland drawn on the open ground: flooded rice paddies, or the Tengger highlands' terraced vegetable fields. */
  farmland: "paddy" | "terraces" | null;
  /** Bromo, Batok and Semeru on the skyline, with Bromo's ash plume. */
  volcanoes: boolean;
}

export const THEMES: Record<ThemeId, Theme> = {
  pantai: {
    skyTop: 0x3f8fd2,
    skyHorizon: 0xd6ebf2,
    fog: 0xd6ebf2,
    sun: 0xfff1d0,
    sunDir: [-0.5, 0.55, -0.35],
    hemiSky: 0xcfe8ff,
    hemiGround: 0x9a8a5e,
    grass: 0x6f9c4b,
    dry: 0xb5a468,
    rock: 0x8d867a,
    sand: 0xe6d6a6,
    seabed: 0xc8b98a,
    gravel: 0x9d9788,
    sea: 0x2b94b8,
    hasSea: true,
    hillAmp: 14,
    bumpAmp: 0.8,
    trees: ["palm", "palm", "palm", "round", "banana"],
    treeDensity: 7,
    treeReach: 60,
    seed: 11,
    ridge: 0x5f7f8c,
    ridgeHeight: 110,
    farmland: "paddy",
    volcanoes: false,
  },
  bukit: {
    skyTop: 0x4d7fb4,
    skyHorizon: 0xbcccd8,
    fog: 0xbcccd8,
    sun: 0xfff4e0,
    sunDir: [0.45, 0.6, -0.5],
    hemiSky: 0xbfd2e6,
    hemiGround: 0x4a5a3a,
    grass: 0x4f7c3b,
    dry: 0x8a8a52,
    rock: 0x7d7568,
    sand: 0xcdbb8a,
    seabed: 0x6b6a58,
    gravel: 0x8f8a7c,
    sea: 0x000000,
    hasSea: false,
    hillAmp: 90,
    bumpAmp: 2.2,
    trees: ["pine", "pine", "round", "round", "bamboo"],
    treeDensity: 20,
    treeReach: 110,
    seed: 23,
    ridge: 0x4d6670,
    ridgeHeight: 170,
    farmland: null,
    volcanoes: false,
  },
  kebun: {
    skyTop: 0x5f9ccc,
    skyHorizon: 0xece0c4,
    fog: 0xece0c4,
    sun: 0xffe9b8,
    sunDir: [0.3, 0.45, -0.6],
    hemiSky: 0xd8e6f0,
    hemiGround: 0x6a7a3a,
    grass: 0x7fae4c,
    dry: 0xbfae62,
    rock: 0x8d8777,
    sand: 0xd9c897,
    seabed: 0x9a9468,
    gravel: 0xa39d8c,
    sea: 0x000000,
    hasSea: false,
    hillAmp: 34,
    bumpAmp: 1.4,
    trees: ["round", "round", "banana", "bamboo", "palm"],
    treeDensity: 14,
    treeReach: 90,
    seed: 37,
    ridge: 0x5e7a7a,
    ridgeHeight: 130,
    farmland: "paddy",
    volcanoes: false,
  },
  bromo: {
    skyTop: 0x3a74b4,
    skyHorizon: 0xd3dbe2,
    fog: 0xd3dbe2,
    sun: 0xfff0d6,
    sunDir: [-0.35, 0.4, -0.6],
    hemiSky: 0xc8d6e6,
    hemiGround: 0x5a5444,
    grass: 0x80904c,
    dry: 0xa59a62,
    rock: 0x5f5952,
    sand: 0x8c857a,
    seabed: 0x5f5952,
    gravel: 0x77716a,
    sea: 0x000000,
    hasSea: false,
    hillAmp: 140,
    bumpAmp: 3,
    trees: ["cemara", "cemara", "cemara", "pine"],
    treeDensity: 16,
    treeReach: 120,
    seed: 53,
    ridge: 0x56636e,
    ridgeHeight: 190,
    farmland: "terraces",
    volcanoes: true,
  },
};

export type QualityId = "low" | "medium" | "high";

export interface Quality {
  /** Pixel-ratio ceiling; the adaptive loop never exceeds it. */
  dprMax: number;
  dprMin: number;
  antialias: boolean;
  fogFar: number;
  treeScale: number;
  clouds: boolean;
  /** Sun shadow map size in texels; 0 turns shadows off. */
  shadowMap: number;
  /** Trees and buildings cast shadows too, not only the riders. */
  sceneryShadows: boolean;
  /** Grass tufts per 100 m per side of the road. */
  grass: number;
  /** Bots drawn at once (the nearest ones); the rest still ride. */
  botAvatars: number;
  /** Physically based materials (asphalt bump, reflective sea, bike sheen) instead of plain diffuse ones. */
  pbr: boolean;
}

export const QUALITY: Record<QualityId, Quality> = {
  low: { dprMax: 0.75, dprMin: 0.5, antialias: false, fogFar: 520, treeScale: 0.35, clouds: false, shadowMap: 0, sceneryShadows: false, grass: 0, botAvatars: 3, pbr: false },
  medium: { dprMax: 1, dprMin: 0.6, antialias: true, fogFar: 800, treeScale: 0.7, clouds: true, shadowMap: 1024, sceneryShadows: false, grass: 60, botAvatars: 6, pbr: true },
  high: { dprMax: 1.75, dprMin: 0.75, antialias: true, fogFar: 1100, treeScale: 1, clouds: true, shadowMap: 2048, sceneryShadows: true, grass: 140, botAvatars: 10, pbr: true },
};

export const QUALITY_IDS: readonly QualityId[] = ["low", "medium", "high"];
