// Images added to a note are saved in the vault's attachment folder and
// linked from the note with ordinary Markdown.
import { showToast, state } from "./core.js";
import { api } from "./api.js";

const imageTypes = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml";

// imageFiles are the images among the files a paste or drop carries.
function imageFiles(transfer: DataTransfer | null | undefined) {
  return [...(transfer?.files || [])].filter((file) => imageTypes.split(",").includes(file.type));
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
    if (file.size > 20 * 1048576) {
      showToast(`“${file.name}” is over the 20 MiB image limit.`, { persistent: true });
      continue;
    }
    try {
      const { path } = await api<{ path: string }>(
        "/api/attachment?name=" + encodeURIComponent(uploadName(file)),
        "POST",
        file,
      );
      const alt = (path.split("/").pop() || "image").replace(/\.\w+$/, "").replace(/-/g, " ");
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

function chooseImages() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = imageTypes;
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
