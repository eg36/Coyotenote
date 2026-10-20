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
// readable moves color toward `toward` in small steps until it reaches the
// target contrast (AA for text) on every background, and returns it
// unchanged when it already does.
function readable(color: RGB, toward: RGB, backgrounds: RGB[], target = 4.5) {
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(toward, color, step / 50);
    if (backgrounds.every((b) => contrast(candidate, b) >= target)) return candidate;
  }
  return toward;
}

// readableRoles returns CSS custom properties that override a theme's text
// roles where they would fall below AA, and the text color for highlights:
// search matches on their 30% warn tint, and ==marked== text on 30% tints of
// the red, orange, yellow, green, blue and purple highlight colours.
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
  // Links, list markers and key hints use the accent as text, also on the
  // light accent tints of tags and the chosen quick-open row.
  const accentText = readable(accent, extreme, [surface, chrome, mix(accent, surface, 0.16)]);
  // Focus rings need 3:1 (WCAG non-text contrast), also on selected rows.
  const focus = readable(accent, extreme, [surface, chrome, ...tinted], 3);
  const pill = rgb(colors.onPill || "#000000");
  const onPill = readable(pill, luminance(pill) < luminance(accent) ? black : white, [accent]);
  const [danger, good, blue, pink] = [colors.danger, colors.good, colors.blue, colors.pink].map((c) =>
    rgb(c || colors.warn || "#000000"),
  ) as RGB[];
  const tints = [warn, danger, mix(danger, warn, 0.5), good, blue, pink];
  const marked = [surface, chrome, mix(accent, chrome, 0.16)].flatMap((b) => tints.map((t) => mix(t, b, 0.3)));
  const markText = readable(text, extreme, marked);
  return {
    text: hex(text),
    muted: hex(muted),
    "accent-text": hex(accentText),
    focus: hex(focus),
    onPill: hex(onPill),
    "mark-text": hex(markText),
    "task-question": hex(readable(warn, extreme, plain)),
    "task-important": hex(readable(danger, extreme, plain)),
    "task-deferred": hex(readable(blue, extreme, plain)),
    "task-progress": hex(readable(good, extreme, plain)),
  };
}

export { readableRoles };
