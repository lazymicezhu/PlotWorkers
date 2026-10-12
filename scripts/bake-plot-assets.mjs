import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Run from any directory: node scripts/bake-plot-assets.mjs
// Geometry and colours mirror app/globals.css. This intentionally bakes only
// normal static terrain; interaction, disabled, holy and guardian states stay live.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "public");
const SCALE = 2;
const TILE_WIDTH = 104;
const TILE_HEIGHT = 54;
const DEPTH = 38;
const PALETTES = {
  gather: ["#748d68", "#5a7552"],
  process: ["#88785e", "#70624c"],
  synthesis: ["#64528c", "#493b6d"],
  living: ["#6c8584", "#536e6d"],
};

const clamp = (number) => Math.max(0, Math.min(255, number));

// CSS filter colour matrices operate on unpremultiplied sRGB. Preserve alpha,
// clamp each filter stage, and quantize only once when storing the final pixel.
function synthesisFilter(pixels) {
  const radians = 250 * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const hue = [
    [.213 + .787 * c - .213 * s, .715 - .715 * c - .715 * s, .072 - .072 * c + .928 * s],
    [.213 - .213 * c + .143 * s, .715 + .285 * c + .140 * s, .072 - .072 * c - .283 * s],
    [.213 - .213 * c - .787 * s, .715 - .715 * c + .715 * s, .072 + .928 * c + .072 * s],
  ];
  const sat = 1.25;
  const saturation = [
    [.213 + .787 * sat, .715 - .715 * sat, .072 - .072 * sat],
    [.213 - .213 * sat, .715 + .285 * sat, .072 - .072 * sat],
    [.213 - .213 * sat, .715 - .715 * sat, .072 + .928 * sat],
  ];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    const source = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    const rotated = hue.map((row) => clamp(row.reduce((sum, value, index) => sum + value * source[index], 0)));
    for (let channel = 0; channel < 3; channel += 1) {
      const value = saturation[channel].reduce((sum, weight, index) => sum + weight * rotated[index], 0);
      pixels[offset + channel] = Math.round(clamp(value) * .92);
    }
  }
  return pixels;
}

function backingSvg(type, width, topHeight, canvasHeight) {
  const plotHeight = topHeight + DEPTH;
  const shadowLeft = width * .07;
  const shadowTop = plotHeight * .57;
  const shadowWidth = width * .91;
  const shadowHeight = plotHeight * .51;
  const halfWidth = width / 2;
  const halfHeight = topHeight / 2;
  const [leftColour, rightColour] = PALETTES[type];
  // CSS radial-gradient's default size is farthest-corner. For this centered
  // ellipse it has sqrt(2) times the radii of the border-radius clipping ellipse.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${canvasHeight * SCALE}" viewBox="0 0 ${width} ${canvasHeight}">
    <defs>
      <radialGradient id="shadow" cx=".5" cy=".5" r="${Math.SQRT1_2}">
        <stop offset="0" stop-color="#27362a" stop-opacity=".22"/>
        <stop offset=".42" stop-color="#27362a" stop-opacity=".22"/>
        <stop offset=".67" stop-color="#27362a" stop-opacity=".08"/>
        <stop offset=".74" stop-color="#27362a" stop-opacity="0"/>
        <stop offset="1" stop-color="#27362a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="leftLight" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="white" stop-opacity=".05"/>
        <stop offset=".55" stop-color="white" stop-opacity="0"/>
        <stop offset="1" stop-color="white" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="rightShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#19321c" stop-opacity="0"/>
        <stop offset="1" stop-color="#19321c" stop-opacity=".08"/>
      </linearGradient>
      <path id="left" d="M0 ${halfHeight} L${halfWidth} ${topHeight} L${halfWidth} ${plotHeight} L0 ${halfHeight + DEPTH} Z"/>
      <path id="right" d="M${halfWidth} ${topHeight} L${width} ${halfHeight} L${width} ${halfHeight + DEPTH} L${halfWidth} ${plotHeight} Z"/>
    </defs>
    <ellipse cx="${shadowLeft + shadowWidth / 2}" cy="${shadowTop + shadowHeight / 2}" rx="${shadowWidth / 2}" ry="${shadowHeight / 2}" fill="url(#shadow)"/>
    <use href="#left" fill="${leftColour}"/>
    <use href="#left" fill="url(#leftLight)"/>
    <use href="#right" fill="${rightColour}"/>
    <use href="#right" fill="url(#rightShade)"/>
  </svg>`;
}

const manifest = [];
for (const type of Object.keys(PALETTES)) {
  for (const size of [4, 8]) {
    const width = size * TILE_WIDTH;
    const topHeight = size * TILE_HEIGHT;
    const height = Math.ceil((topHeight + DEPTH) * 1.08);
    const sourceType = type === "synthesis" ? "process" : type;
    const { data, info } = await sharp(path.join(output, `plot-${sourceType}-${size}.png`))
      .resize(width * SCALE, topHeight * SCALE, { fit: "fill", kernel: sharp.kernel.linear })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const top = await sharp(type === "synthesis" ? synthesisFilter(data) : data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();
    const file = `plot-baked-${type}-${size}.png`;
    await sharp(Buffer.from(backingSvg(type, width, topHeight, height)))
      .composite([{ input: top, left: 0, top: 0 }])
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(output, file));
    const { size: bytes } = await fs.stat(path.join(output, file));
    manifest.push({ file, type, size, width, height, scale: SCALE, pixels: [width * SCALE, height * SCALE], bytes });
  }
}

console.log(JSON.stringify({
  description: "Static top + two shaded sides + original elliptical shadow; top-left aligned; transparent RGBA at 2x.",
  assets: manifest,
  bytes: manifest.reduce((sum, asset) => sum + asset.bytes, 0),
}, null, 2));
