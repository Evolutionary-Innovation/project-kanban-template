import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveWorkspaceContext } from "../workspace-root.mjs";

const extensionDirectory = fileURLToPath(new URL("../", import.meta.url));

test("discovers the actual Template workspace without a directory-depth assumption", async () => {
  const result = await resolveWorkspaceContext({ extensionDirectory });
  const expectedRoot = await realpath(fileURLToPath(new URL("../../../../", import.meta.url)));

  assert.equal(result.workspaceRoot, expectedRoot);
  assert.equal(result.config.projectName, "Project Kanban Template");
});

test("uses a host-provided independent project root for a differently configured workspace", async () => {
  const hostWorkingDirectory = fileURLToPath(new URL("../../../../examples/independent-project/", import.meta.url));
  const result = await resolveWorkspaceContext({
    hostWorkingDirectory,
    extensionDirectory,
  });

  assert.equal(result.workspaceRoot, await realpath(hostWorkingDirectory));
  assert.equal(result.config.projectName, "Field Notes");
});
