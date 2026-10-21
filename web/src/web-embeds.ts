import { api } from "./api.js";

let enabled = false;
let generation = 0;

function setWebEmbeds(value: boolean) {
  if (enabled === value) return;
  enabled = value;
  generation++;
  // Turning the feature off removes already loaded content in this tab.
  for (const embed of document.querySelectorAll<HTMLElement>(".web-embed")) {
    embed.querySelector("iframe")?.remove();
    hydrateWebEmbeds(embed.parentElement!);
  }
}

function hydrateWebEmbeds(root: HTMLElement) {
  for (const embed of root.querySelectorAll<HTMLElement>(".web-embed")) {
    const button = embed.querySelector<HTMLButtonElement>(".web-embed-load");
    const hint = embed.querySelector<HTMLElement>(".web-embed-hint");
    if (!button || !hint) continue;
    button.disabled = !enabled;
    button.textContent = embed.querySelector("iframe") ? "Unload embed" : "Load embed";
    const youtube = embed.querySelector("a")?.hostname === "www.youtube-nocookie.com";
    const description = enabled
      ? "Loads external content only when you choose Load. Some sites block embedding."
      : "Web embeds are off. Enable them in Settings → Web embeds.";
    hint.textContent = description + (youtube ? " YouTube receives the app’s origin when loaded." : "");
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const frame = embed.querySelector("iframe");
      if (frame) {
        frame.remove();
        button.textContent = "Load embed";
        return;
      }
      const current = generation;
      button.disabled = true;
      button.textContent = "Loading…";
      try {
        // Recheck consent on the server, including settings changed by another
        // tab. The server returns a URL; it never fetches remote content.
        const data = await api<{ source: string; referrer: ReferrerPolicy }>("/api/web-embed", "POST", { body: embed.dataset.webEmbed });
        if (!enabled || current !== generation || !embed.isConnected) return;
        const player = document.createElement("iframe");
        player.title = "Web embed: " + data.source;
        player.referrerPolicy = data.referrer;
        player.setAttribute("sandbox", "allow-scripts allow-presentation" + (data.referrer === "origin" ? " allow-same-origin" : ""));
        player.allow = "fullscreen; encrypted-media; picture-in-picture";
        player.src = data.source;
        embed.append(player);
        button.textContent = "Unload embed";
      } catch (error) {
        hint.textContent = error instanceof Error ? error.message : "Could not load this embed. Try again.";
        button.textContent = "Load embed";
      } finally {
        button.disabled = !enabled;
      }
    };
  }
}

export { hydrateWebEmbeds, setWebEmbeds };
