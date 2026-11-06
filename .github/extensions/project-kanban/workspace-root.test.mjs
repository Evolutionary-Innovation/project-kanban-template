import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { testConfig } from "./test-fixtures.mjs";
import {
  MAX_ANCESTOR_DEPTH,
  resolveWorkspaceContext,
  WorkspaceDiscoveryError,
} from "./workspace-root.mjs";

async function createRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "project-kanban-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeConfig(root, config = testConfig()) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "project-kanban.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

async function nestedDirectory(root, depth) {
  const directory = join(root, ...Array.from({ length: depth }, (_, index) => `nested-${index}`));
  await mkdir(directory, { recursive: true });
  return directory;
}

async function assertDiscoveryError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WorkspaceDiscoveryError);
    assert.equal(error.code, code);
    return true;
  });
}

test("prefers an explicit host workspace root over the extension location", async (t) => {
  const hostRoot = await createRoot(t);
  const extensionRoot = await createRoot(t);
  await writeConfig(hostRoot);
  await writeConfig(extensionRoot);

  const result = await resolveWorkspaceContext({
    hostWorkingDirectory: hostRoot,
    extensionDirectory: extensionRoot,
  });

  assert.equal(result.workspaceRoot, hostRoot);
  assert.equal(result.config.projectName, "Generic Contract Fixture");
});

test("discovers a single config from an extension installed at arbitrary depth", async (t) => {
  const workspaceRoot = await createRoot(t);
  await writeConfig(workspaceRoot);
  const extensionDirectory = await nestedDirectory(workspaceRoot, 16);

  const result = await resolveWorkspaceContext({ extensionDirectory });

  assert.equal(result.workspaceRoot, workspaceRoot);
});

test("discovers a unique ancestor from a host working subdirectory", async (t) => {
  const workspaceRoot = await createRoot(t);
  await writeConfig(workspaceRoot);
  const workingDirectory = await nestedDirectory(workspaceRoot, 4);

  const result = await resolveWorkspaceContext({
    hostWorkingDirectory: workingDirectory,
    extensionDirectory: await createRoot(t),
  });

  assert.equal(result.workspaceRoot, workspaceRoot);
});

test("uses a directly identified nested workspace even when its parent is also configured", async (t) => {
  const outerRoot = await createRoot(t);
  const nestedRoot = join(outerRoot, "nested-project");
  await writeConfig(outerRoot);
  await writeConfig(nestedRoot, { ...testConfig(), projectName: "Nested Project" });

  const result = await resolveWorkspaceContext({
    hostWorkingDirectory: nestedRoot,
    extensionDirectory: outerRoot,
  });

  assert.equal(result.workspaceRoot, nestedRoot);
  assert.equal(result.config.projectName, "Nested Project");
});

test("rejects multiple ancestor configuration roots as ambiguous", async (t) => {
  const outerRoot = await createRoot(t);
  const nestedRoot = join(outerRoot, "nested-project");
  await writeConfig(outerRoot);
  await writeConfig(nestedRoot, { ...testConfig(), projectName: "Nested Project" });
  const extensionDirectory = await nestedDirectory(nestedRoot, 2);

  await assertDiscoveryError(
    resolveWorkspaceContext({ extensionDirectory }),
    "workspace_root_ambiguous",
  );
});

test("does not fall back to the extension location when host context is supplied but has no config", async (t) => {
  const extensionRoot = await createRoot(t);
  const hostRoot = await createRoot(t);
  await writeConfig(extensionRoot);

  await assertDiscoveryError(
    resolveWorkspaceContext({
      hostWorkingDirectory: hostRoot,
      extensionDirectory: extensionRoot,
    }),
    "workspace_root_not_found",
  );
});

test("fails explicitly when no config exists", async (t) => {
  const extensionDirectory = await createRoot(t);

  await assertDiscoveryError(
    resolveWorkspaceContext({ extensionDirectory }),
    "workspace_root_not_found",
  );
});

test("rejects a config outside the bounded search depth", async (t) => {
  const workspaceRoot = await createRoot(t);
  await writeConfig(workspaceRoot);
  const extensionDirectory = await nestedDirectory(workspaceRoot, MAX_ANCESTOR_DEPTH + 1);

  await assertDiscoveryError(
    resolveWorkspaceContext({ extensionDirectory }),
    "workspace_root_not_found",
  );
});

test("reports invalid JSON and invalid configuration explicitly", async (t) => {
  const workspaceRoot = await createRoot(t);
  await writeFile(join(workspaceRoot, "project-kanban.config.json"), "{invalid");
  await assertDiscoveryError(
    resolveWorkspaceContext({ hostWorkingDirectory: workspaceRoot }),
    "board_config_invalid",
  );

  await writeConfig(workspaceRoot, { ...testConfig(), defaultStatus: "Unsupported" });
  await assertDiscoveryError(
    resolveWorkspaceContext({ hostWorkingDirectory: workspaceRoot }),
    "board_config_invalid",
  );
});

test("resolves symlinked extension locations to the canonical workspace path", async (t) => {
  const workspaceRoot = await createRoot(t);
  await writeConfig(workspaceRoot);
  const extensionDirectory = await nestedDirectory(workspaceRoot, 3);
  const alias = join(await createRoot(t), "extension-link");
  await symlink(extensionDirectory, alias, "dir");

  const result = await resolveWorkspaceContext({ extensionDirectory: alias });

  assert.equal(result.workspaceRoot, workspaceRoot);
});

test("rejects relative host paths instead of resolving them against process.cwd()", async (t) => {
  const extensionDirectory = await createRoot(t);

  await assertDiscoveryError(
    resolveWorkspaceContext({
      hostWorkingDirectory: "relative/workspace",
      extensionDirectory,
    }),
    "workspace_root_invalid",
  );
});
