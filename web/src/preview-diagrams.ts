import mermaid from "mermaid";

let sequence = 0;
// Mermaid uses shared state; serialize renders across preview replacements.
let pending = Promise.resolve();
export function renderDiagrams(root: HTMLElement) {
  const codes = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  pending = pending.catch(() => {}).then(async () => {
    const colour = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
      maxTextSize: 50000, maxEdges: 500, htmlLabels: false,
      theme: "base", fontFamily: "inherit",
      themeVariables: {
        primaryColor: colour("--chrome"), primaryTextColor: colour("--text"),
        primaryBorderColor: colour("--muted"), lineColor: colour("--muted"),
        secondaryColor: colour("--surface"), tertiaryColor: colour("--chrome"),
        textColor: colour("--text"), background: colour("--surface"),
      },
    });
    for (const code of codes) {
      if (!code.isConnected) continue;
      const source = code.textContent || "", pre = code.parentElement!;
      try {
        // Block diagram-level configuration, image shapes, HTML and CSS URLs
        // before rendering: those can fetch resources even in strict mode.
        if (/%%\s*\{|^\s*---|\b(?:img|image|icon)["']?\s*:|<|\burl\s*\(|\\|\b(?:style|classDef|linkStyle)\s|@import|(?:https?|data|file):|\/\//im.test(source))
          throw new Error("Diagram images, URLs and custom configuration are unavailable offline.");
        const { svg } = await mermaid.render(`diagram-${++sequence}`, source);
        if (!code.isConnected) continue;
        const result = document.createElement("div");
        result.className = "mermaid-diagram";
        result.innerHTML = svg;
        // Leave only local SVG references and never bind click callbacks.
        result.querySelectorAll("image, foreignObject, script").forEach(node => node.remove());
        for (const element of result.querySelectorAll("*"))
          for (const attribute of [...element.attributes])
            if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith("#")))
              element.removeAttribute(attribute.name);
        const drawing = result.querySelector("svg");
        if (drawing?.viewBox.baseVal.width) {
          // Keep labels readable on phones; the diagram's container scrolls.
          drawing.style.width = `${drawing.viewBox.baseVal.width}px`;
          drawing.style.maxWidth = "none";
        }
        pre.replaceWith(result);
      } catch (error) {
        if (!code.isConnected) continue;
        const message = document.createElement("p");
        message.className = "render-error";
        message.textContent = error instanceof Error && error.message.includes("offline")
          ? error.message : "Diagram could not be rendered. Check its Mermaid syntax in Markdown.";
        pre.after(message);
      }
    }
  });
  return pending;
}
