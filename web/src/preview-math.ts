import katex from "katex";

let styles: Promise<void> | undefined;
function loadStyles() {
  return styles ||= new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "/assets/katex.css";
    link.onload = () => resolve();
    link.onerror = () => { link.remove(); styles = undefined; reject(new Error("Math styles unavailable")); };
    document.head.append(link);
  });
}
// Write and Preview share these settings: no links, styles or macros that
// could load anything, and bounded expansion for hostile input.
export async function renderFormula(element: HTMLElement, tex: string, display: boolean) {
  await loadStyles();
  if (!element.isConnected) return;
  try {
    katex.render(tex, element, {
      displayMode: display, trust: false,
      strict: "error", throwOnError: true, maxExpand: 1000, maxSize: 20,
    });
    element.classList.remove("render-error");
  } catch {
    element.textContent = tex;
    element.classList.add("render-error");
    element.title = "This formula could not be rendered. Check its TeX.";
  }
}
export async function renderMath(root: HTMLElement) {
  const elements = [...root.querySelectorAll<HTMLElement>(".math")];
  await loadStyles();
  for (const element of elements)
    if (element.isConnected) await renderFormula(element, element.textContent || "", element.tagName === "DIV");
}
