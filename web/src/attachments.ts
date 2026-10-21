// Images, PDFs, audio and video added to a note are saved in the vault's
// attachment folder. Images are linked with ordinary Markdown; the others
// are embedded with ![[…]], which shows their viewer or player.
import { showToast, state } from "./core.js";
import { api } from "./api.js";

const imageTypes = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml";
const mediaExtensions = [".pdf", ".mp3", ".m4a", ".ogg", ".oga", ".wav", ".flac", ".mp4", ".webm", ".mov", ".ogv"];
const isMedia = (file: File) => mediaExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));

// imageFiles are the files a paste or drop carries that a note can hold:
// images, PDFs, audio and video.
function imageFiles(transfer: DataTransfer | null | undefined) {
  return [...(transfer?.files || [])].filter((file) => imageTypes.split(",").includes(file.type) || isMedia(file));
}

// uploadName keeps a file's own name, but names a pasted screenshot, which
// browsers call image.png, after the moment it was pasted.
function uploadName(file: File) {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg" };
  const ext = extensions[file.type] || file.type.split("/")[1];
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `pasted-${stamp}.${ext}`;
}

// addImages saves each image in the vault and inserts it where the cursor
// is, in whichever editor is showing.
async function addImages(files: File[]) {
  if (!state.current || state.pendingDraft || state.busy) return;
  // An upload belongs to the note it started in, even if another opens meanwhile.
  const note = state.current.id;
  for (const file of files) {
    const media = isMedia(file);
    if (file.size > (media ? 100 : 20) * 1048576) {
      showToast(`“${file.name}” is over the ${media ? "100 MiB file" : "20 MiB image"} limit.`, { persistent: true });
      continue;
    }
    try {
      const { path } = await api<{ path: string }>(
        "/api/attachment?name=" + encodeURIComponent(uploadName(file)),
        "POST",
        file,
      );
      const alt = (path.split("/").pop() || "image").replace(/\.\w+$/, "").replace(/-/g, " ");
      if (media) {
        if (state.current?.id !== note) {
          showToast(`“${file.name}” finished uploading after you left “${note.split("/").pop()}”. It is saved as ${path}; paste ![[${path}]] where you want it.`, { persistent: true });
        } else if (state.mode === "write" && state.rich) state.rich.insertEmbed(path);
        else state.source?.insert(`![[${path}]]`);
        continue;
      }
      if (state.current?.id !== note) {
        showToast(`“${file.name}” finished uploading after you left “${note.split("/").pop()}”. It is saved as ${path}; paste ![${alt}](${path}) where you want it.`, { persistent: true });
        continue;
      }
      if (state.mode === "write" && state.rich) state.rich.insertImage(path, alt);
      else state.source?.insert(`![${alt}](${path})`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { persistent: true });
    }
  }
}

function chooseImages(files = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = files ? mediaExtensions.join(",") : imageTypes;
  input.multiple = true;
  input.onchange = () => addImages([...(input.files || [])]);
  input.click();
}

// fileUrl is where the browser shows the image src names in the open note,
// or null for a remote image, which is never fetched.
function fileUrl(src: string) {
  if (/^data:image\//.test(src)) return src;
  if (!src || src.includes(":") || src.startsWith("//")) return null;
  return (
    "/vault-file?from=" +
    encodeURIComponent(state.current?.id || "") +
    "&src=" +
    encodeURIComponent(src)
  );
}

export { addImages, chooseImages, fileUrl, imageFiles };
