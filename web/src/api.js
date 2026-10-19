// Requests to the local server, renewing the session token after a restart.
import { state } from "./core.js";

// A restarted server issues a new token. Renew it once, but only when the
// server still serves this tab's vault, so edits never reach another vault.
async function renewToken() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    const session = await response.json();
    if (!response.ok || session.vaultId !== state.vaultId) return false;
    state.token = session.token;
    return true;
  } catch {
    return false;
  }
}
// api sends data as JSON, or a file (a Blob) as it is.
async function api(path, method = "GET", data, retried = false) {
  const file = data instanceof Blob;
  let response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      headers:
        method === "GET"
          ? {}
          : {
              "Content-Type": file
                ? data.type || "application/octet-stream"
                : "application/json",
              "X-Labradorite-Token": state.token,
            },
      body: data === undefined || file ? data : JSON.stringify(data),
    });
  } catch {
    throw new Error(
      "Cannot reach the local app. Keep this tab open, restart Labradorite, then retry.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The local app returned an unreadable response. Your draft is still kept in this tab.",
    );
  }
  if (!response.ok) {
    if (
      response.status === 403 &&
      method !== "GET" &&
      !retried &&
      (await renewToken())
    )
      return api(path, method, data, true);
    const error = new Error(result.error || "Request failed");
    error.status = response.status;
    error.current = result.current;
    throw error;
  }
  return result;
}

export { api };
