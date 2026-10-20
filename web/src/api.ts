// Requests to the local server, renewing the session token after a restart.
import { state } from "./core.js";
import type { AppError, Note, Session } from "./types.js";

// A restarted server issues a new token. Renew it once, but only when the
// server still serves this tab's vault, so edits never reach another vault.
async function renewToken() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    const session = await response.json() as Session;
    if (!response.ok || session.vaultId !== state.vaultId) return false;
    state.token = session.token;
    return true;
  } catch {
    return false;
  }
}
// api sends data as JSON, or a file (a Blob) as it is.
async function api<T = unknown>(
  path: string,
  method = "GET",
  data?: Blob | Record<string, unknown>,
  retried = false,
): Promise<T> {
  // Saves report the stamps they move between; other writes may rename, move
  // or remove notes, which the change watcher must not mistake for others'.
  const changesNotes = method !== "GET" && !(method === "PUT" && path === "/api/note") &&
    !["/api/render", "/api/settings", "/api/recovery"].includes(path) && !path.startsWith("/api/attachment");
  if (!changesNotes) return request<T>(path, method, data, retried);
  state.changing++;
  try {
    return await request<T>(path, method, data, retried);
  } finally {
    state.changing--;
    state.changes++;
  }
}
async function request<T>(
  path: string,
  method: string,
  data: Blob | Record<string, unknown> | undefined,
  retried: boolean,
): Promise<T> {
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
  let result: unknown;
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
      return api<T>(path, method, data, true);
    const details = result && typeof result === "object"
      ? result as { error?: string; current?: Note }
      : {};
    const error: AppError = new Error(details.error || "Request failed");
    error.status = response.status;
    error.current = details.current;
    throw error;
  }
  // The caller supplies the response contract for this local endpoint.
  return result as T;
}

export { api };
