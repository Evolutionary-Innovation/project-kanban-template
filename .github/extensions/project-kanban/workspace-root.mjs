import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, parse } from "node:path";
import { CONFIG_FILE, readBoardConfig } from "./board-config.mjs";

export const MAX_ANCESTOR_DEPTH = 64;

export class WorkspaceDiscoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceDiscoveryError";
    this.code = code;
  }
}

async function canonicalDirectory(candidate, label) {
  if (typeof candidate !== "string" || candidate.trim() === "" || !isAbsolute(candidate)) {
    throw new WorkspaceDiscoveryError(
      "workspace_root_invalid",
      `${label} must be an absolute directory path.`,
    );
  }

  let canonicalPath;
  try {
    canonicalPath = await realpath(candidate);
    const details = await stat(canonicalPath);
    if (!details.isDirectory()) throw new Error("not a directory");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown path error.";
    throw new WorkspaceDiscoveryError(
      "workspace_root_unavailable",
      `${label} "${candidate}" is unavailable: ${message}`,
    );
  }
  return canonicalPath;
}

async function hasCanonicalConfig(root) {
  try {
    const details = await stat(join(root, CONFIG_FILE));
    if (!details.isFile()) {
      throw new WorkspaceDiscoveryError(
        "board_config_invalid",
        `${join(root, CONFIG_FILE)} is not a regular file.`,
      );
    }
    return true;
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryError) throw error;
    if (error && typeof error === "object" && ["ENOENT", "ENOTDIR"].includes(error.code)) return false;
    const message = error instanceof Error ? error.message : "Unknown filesystem error.";
    throw new WorkspaceDiscoveryError(
      "workspace_root_unavailable",
      `Unable to inspect ${join(root, CONFIG_FILE)}: ${message}`,
    );
  }
}

async function readWorkspace(root) {
  try {
    return { workspaceRoot: root, config: await readBoardConfig(root) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown configuration error.";
    throw new WorkspaceDiscoveryError(
      "board_config_invalid",
      `Invalid ${CONFIG_FILE} at "${root}": ${message}`,
    );
  }
}

async function ancestorCandidates(anchor) {
  const candidates = [];
  let current = anchor;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (await hasCanonicalConfig(current)) candidates.push(current);
    const parent = dirname(current);
    if (parent === current || parent === parse(current).root) {
      if (parent !== current && await hasCanonicalConfig(parent)) candidates.push(parent);
      break;
    }
    current = parent;
  }

  return candidates;
}

export async function resolveWorkspaceContext({ hostWorkingDirectory, extensionDirectory }) {
  const hasHostWorkingDirectory = hostWorkingDirectory !== undefined;
  const anchor = await canonicalDirectory(
    hasHostWorkingDirectory ? hostWorkingDirectory : extensionDirectory,
    hasHostWorkingDirectory ? "Host working directory" : "Extension directory",
  );

  if (hasHostWorkingDirectory && await hasCanonicalConfig(anchor)) {
    return readWorkspace(anchor);
  }

  const candidates = await ancestorCandidates(anchor);
  if (candidates.length === 0) {
    throw new WorkspaceDiscoveryError(
      "workspace_root_not_found",
      `No ${CONFIG_FILE} was found within ${MAX_ANCESTOR_DEPTH} ancestor directories of "${anchor}".`,
    );
  }
  if (candidates.length > 1) {
    throw new WorkspaceDiscoveryError(
      "workspace_root_ambiguous",
      `Multiple ${CONFIG_FILE} files were found while searching from "${anchor}": ${candidates.join(", ")}.`,
    );
  }

  return readWorkspace(candidates[0]);
}
