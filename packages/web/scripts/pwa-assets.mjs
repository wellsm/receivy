#!/usr/bin/env node
// Generates what an installed web app needs and the repository keeps in `public/`: the 512 px icon of the
// manifest and the iOS launch images. iOS takes no launch image from the manifest: it wants one
// `apple-touch-startup-image` per screen size, matched exactly, or it opens on a blank screen.
//
// Needs ImageMagick 7 (`magick`) on the machine. Run from `packages/web` after the brand icon or a color changes,
// or when a new iPhone screen size comes out:
//   node scripts/pwa-assets.mjs
// It prints the `<link>` tags of the launch images; they go into `index.html`.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = `${root}public/brand-icon.png`;
const folder = `${root}public/splash`;

// `--color-canvas` of each theme in src/styles.css.
const themes = [
  { name: "light", background: "#f7f6fb" },
  { name: "dark", background: "#121122" },
];

// Portrait screens in CSS pixels and their pixel ratio. One entry covers every iPhone with that screen.
const screens = [
  { width: 320, height: 568, ratio: 2 }, // SE (1st)
  { width: 375, height: 667, ratio: 2 }, // 8, SE (2nd, 3rd)
  { width: 414, height: 736, ratio: 3 }, // 8 Plus
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 16e
  { width: 428, height: 926, ratio: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max
  { width: 420, height: 912, ratio: 3 }, // Air
];

function magick(...args) {
  execFileSync("magick", args, { stdio: ["ignore", "ignore", "inherit"] });
}

magick(source, "-resize", "512x512", "-strip", `${root}public/icon-512.png`);

rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });

const links = [];

for (const { width, height, ratio } of screens) {
  const pixelWidth = width * ratio;
  const pixelHeight = height * ratio;
  // The icon takes a quarter of the screen width, with the corner radius of an iOS app icon.
  const icon = Math.round(pixelWidth / 4);
  const radius = Math.round(icon * 0.225);

  for (const { name, background } of themes) {
    const file = `${pixelWidth}x${pixelHeight}-${name}.png`;

    magick(
      "-size",
      `${pixelWidth}x${pixelHeight}`,
      `xc:${background}`,
      "(",
      source,
      "-resize",
      `${icon}x${icon}`,
      "-alpha",
      "set",
      "(",
      "-size",
      `${icon}x${icon}`,
      "xc:none",
      "-fill",
      "white",
      "-draw",
      `roundrectangle 0,0,${icon - 1},${icon - 1},${radius},${radius}`,
      ")",
      "-compose",
      "DstIn",
      "-composite",
      ")",
      "-gravity",
      "center",
      "-compose",
      "Over",
      "-composite",
      "-strip",
      "-define",
      "png:compression-level=9",
      `${folder}/${file}`,
    );

    const media = `(prefers-color-scheme: ${name}) and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`;

    links.push(`    <link rel="apple-touch-startup-image" media="${media}" href="/splash/${file}" />`);
  }
}

console.log(links.join("\n"));
