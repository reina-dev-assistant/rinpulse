// Published posts, newest first. Only what is imported here is built, prerendered, listed in
// /blog and put in the sitemap.
//
// Unpublished drafts live in ./drafts and are NOT imported anywhere in the app, so their text is
// not in the bundle. To publish one when its feature ships in a store build:
//   1. git mv src/blog/drafts/<file>.ts src/blog/posts/<file>.ts
//   2. import it below and add it to POSTS (newest first), set `date` to the ship date
//   3. delete its `verify` list once every item has been checked against the build
//   4. bun run build (rewrites seo-lastmod.json), then deploy.
import type { Post } from "./types.ts";
import { coach } from "./posts/coach.ts";
import { bagikanLatihan } from "./posts/bagikan-latihan-ke-joyorogo.ts";
import { kartuBagikan } from "./posts/kartu-bagikan.ts";
import { panduanAwal } from "./posts/panduan-awal.ts";
import { pembaruan } from "./posts/pembaruan-di-aplikasi.ts";
import { social } from "./posts/social-joyofit.ts";
import { stravaFit } from "./posts/strava-file-fit.ts";
import { tidurHrvCuaca } from "./posts/tidur-hrv-cuaca.ts";

export const POSTS: readonly Post[] = [
  coach,
  social,
  bagikanLatihan,
  panduanAwal,
  stravaFit,
  kartuBagikan,
  tidurHrvCuaca,
  pembaruan,
];

export function postPath(post: Pick<Post, "slug">): string {
  return `/blog/${post.slug}`;
}

export function findPost(path: string): Post | undefined {
  return POSTS.find((post) => postPath(post) === path);
}
