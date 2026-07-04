/** Client-side colormaps. The server sends grayscale PNGs; applying the LUT
 * here means switching colormaps or dragging opacity costs no round-trip.
 *
 * Polynomial fits for matplotlib maps by Matt Zucker (MIT), turbo by Google.
 */

const ZUCKER: Record<string, number[][]> = {
  viridis: [
    [0.2777273272234177, 0.005407344544966578, 0.334099805335306],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
  ],
  magma: [
    [-0.002136485053939582, -0.000749655052795221, -0.005386127855323933],
    [0.2516605407371642, 0.6775232436837668, 2.494026599312351],
    [8.353717279216625, -3.577719514958484, 0.3144679030132573],
    [-27.66873308576866, 14.26473078096533, -13.64921318813922],
    [52.17613981234068, -27.94360607168351, 12.94416944238394],
    [-50.76852536473588, 29.04658282127291, 4.23415299384598],
    [18.65570506591883, -11.48977351997711, -5.601961508734096],
  ],
  inferno: [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872425],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ],
  plasma: [
    [0.05873234392399702, 0.02333670892565664, 0.5433401826748754],
    [2.176514634195958, 0.2383834171260182, 0.7539604599784036],
    [-2.689460476458034, -7.455851135738909, 3.110799939717086],
    [6.130348345893603, 42.3461881477227, -28.51885465332158],
    [-11.10743619062271, -82.66631109428045, 60.13984767418263],
    [10.02306557647065, 71.41361770095349, -54.07218655560067],
    [-3.658713842777788, -22.93153465461149, 18.19190778539828],
  ],
};

function zuckerEval(name: string, t: number): [number, number, number] {
  const c = ZUCKER[name];
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let k = 6; k >= 0; k--) acc = acc * t + c[k][ch];
    out[ch] = acc;
  }
  return out;
}

function turboEval(t: number): [number, number, number] {
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return [r, g, b];
}

function buildLut(fn: (t: number) => [number, number, number]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = fn(i / 255);
    lut[i * 3] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    lut[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    lut[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
  }
  return lut;
}

/** Diverging blue-white-red for difference images (128 = no difference). */
function divergingEval(t: number): [number, number, number] {
  const blue: [number, number, number] = [0.19, 0.42, 0.84];
  const white: [number, number, number] = [0.96, 0.96, 0.96];
  const red: [number, number, number] = [0.84, 0.19, 0.15];
  const x = t * 2 - 1; // -1..1
  const [from, to, a] = x < 0 ? [blue, white, x + 1] : [white, red, x];
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * a) as [number, number, number];
}

export const COLORMAPS: Record<string, Uint8ClampedArray> = {
  gray: buildLut((t) => [t, t, t]),
  viridis: buildLut((t) => zuckerEval("viridis", t)),
  magma: buildLut((t) => zuckerEval("magma", t)),
  inferno: buildLut((t) => zuckerEval("inferno", t)),
  plasma: buildLut((t) => zuckerEval("plasma", t)),
  turbo: buildLut(turboEval),
  diverging: buildLut(divergingEval),
};

export const COLORMAP_NAMES = ["gray", "viridis", "magma", "inferno", "plasma", "turbo"];

/** Colorize a grayscale bitmap through a LUT. Alpha stays opaque; the overlay
 * transparency is applied at draw time via globalAlpha. When `zeroTransparent`
 * is set, near-black pixels become transparent (used for energy overlays so
 * only energetic regions tint the image). */
export async function applyColormap(
  bitmap: ImageBitmap,
  lutName: string,
  zeroTransparent = false,
): Promise<ImageBitmap> {
  const lut = COLORMAPS[lutName] ?? COLORMAPS.gray;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i]; // grayscale: R=G=B
    px[i] = lut[v * 3];
    px[i + 1] = lut[v * 3 + 1];
    px[i + 2] = lut[v * 3 + 2];
    if (zeroTransparent) px[i + 3] = v;
  }
  ctx.putImageData(data, 0, 0);
  return createImageBitmap(canvas);
}

/** CSS gradient string for colormap picker previews. */
export function lutGradient(name: string): string {
  const lut = COLORMAPS[name] ?? COLORMAPS.gray;
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const v = Math.round((i / 8) * 255);
    stops.push(`rgb(${lut[v * 3]},${lut[v * 3 + 1]},${lut[v * 3 + 2]}) ${(i / 8) * 100}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
