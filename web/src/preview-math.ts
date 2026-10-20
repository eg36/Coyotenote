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
export async function renderMath(root: HTMLElement) {
  const elements = [...root.querySelectorAll<HTMLElement>(".math")];
  await loadStyles();
  for (const element of elements) {
    if (!element.isConnected) continue;
    const tex = element.textContent || "";
    try {
      katex.render(tex, element, {
        displayMode: element.tagName === "DIV", trust: false,
        strict: "error", throwOnError: true, maxExpand: 1000, maxSize: 20,
      });
    } catch {
      element.textContent = tex;
      element.classList.add("render-error");
      element.title = "This formula could not be rendered. Edit its TeX in Markdown.";
    }
  }
}
