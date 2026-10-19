// Theme palettes stay as published. The roles the app draws text with are
// moved only as far as WCAG AA (4.5:1) needs on the backgrounds they meet,
// so soft palettes such as Ayu Light stay readable without being redrawn.
type RGB = [number, number, number];

const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const hex = (c: RGB) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
// mix gives t of a over b, like CSS color-mix in sRGB.
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] * t + b[0] * (1 - t),
  a[1] * t + b[1] * (1 - t),
  a[2] * t + b[2] * (1 - t),
];
function luminance([r, g, b]: RGB) {
  const linear = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: RGB, b: RGB) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
// readable moves color toward `toward` in small steps until it reaches AA
// on every background, and returns it unchanged when it already does.
function readable(color: RGB, toward: RGB, backgrounds: RGB[]) {
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(toward, color, step / 50);
    if (backgrounds.every((b) => contrast(candidate, b) >= 4.5)) return candidate;
  }
  return toward;
}

// readableRoles returns CSS custom properties that override a theme's text
// roles where they would fall below AA, and the text color for search
// highlights on their 30% warn tint.
function readableRoles(colors: Record<string, string>) {
  const [surface, chrome, accent, warn] = [
    colors.surface,
    colors.chrome,
    colors.accent,
    colors.warn,
  ].map((c) => rgb(c || "#000000")) as RGB[];
  const black: RGB = [0, 0, 0],
    white: RGB = [255, 255, 255];
  const extreme = luminance(surface) > 0.5 ? black : white;
  // Selected rows and pressed buttons tint the background with the accent
  // by up to 24%.
  const tinted = [mix(accent, surface, 0.24), mix(accent, chrome, 0.24)];
  const text = readable(rgb(colors.text || "#000000"), extreme, [surface, chrome, ...tinted]);
  const plain = [surface, chrome, mix(text, surface, 0.08), mix(text, chrome, 0.08)];
  const muted = readable(rgb(colors.muted || "#000000"), text, plain);
  // Links, list markers, key hints and focus rings use the accent on
  // plain and accent-tinted backgrounds alike.
  const accentText = readable(accent, extreme, [surface, chrome, ...tinted]);
  const pill = rgb(colors.onPill || "#000000");
  const onPill = readable(pill, luminance(pill) < luminance(accent) ? black : white, [accent]);
  const marked = [surface, chrome, mix(accent, chrome, 0.16)].map((b) => mix(warn, b, 0.3));
  const markText = readable(text, extreme, marked);
  return {
    text: hex(text),
    muted: hex(muted),
    "accent-text": hex(accentText),
    onPill: hex(onPill),
    "mark-text": hex(markText),
  };
}

export { readableRoles };
