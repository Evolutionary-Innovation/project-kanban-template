import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createTaskInDocuments,
  deleteTaskInDocuments,
  editTaskInDocuments,
  moveTaskInDocuments,
  readBoardSnapshot,
  BoardStorageError,
} from "./board-storage.mjs";
import { readBoardConfig } from "./board-config.mjs";

const templateRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function createWorkspace(t, sourceRoot = templateRoot) {
  const root = await mkdtemp(join(tmpdir(), "project-kanban-template-test-"));
  await cp(join(sourceRoot, "project-kanban.config.json"), join(root, "project-kanban.config.json"));
  await cp(join(sourceRoot, "docs"), join(root, "docs"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, config: await readBoardConfig(root) };
}

test("persists Roadmap, Technical Debt, and Audit mutations to their configured Markdown sources", async (t) => {
  const { root, config } = await createWorkspace(t);
  let board = await readBoardSnapshot(root, config);
  const createdRoadmap = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Test a generated starter",
      area: "Testing",
      priority: "High",
      status: "Planned",
      details: "Created through the generic storage API.",
    },
    revisions: board.revisions,
  });
  assert.ok(createdRoadmap.tasks.some(({ id, title }) => id === "RM-003" && title === "Test a generated starter"));

  board = createdRoadmap;
  const createdDebt = await createTaskInDocuments(root, config, {
    sourceType: "technicalDebt",
    task: {
      title: "Reduce repeated configuration",
      area: "Architecture",
      priority: "Low",
      status: "Research",
      details: "",
      limitation: "Some settings have no evidence of use.",
      recommendedFix: "Keep only values needed by real projects.",
      rationale: "Avoid framework-like configuration.",
    },
    revisions: board.revisions,
  });
  assert.ok(createdDebt.tasks.some(({ id }) => id === "TD-02"));

  board = createdDebt;
  const createdAudit = await createTaskInDocuments(root, config, {
    sourceType: "repositoryAudit",
    task: {
      title: "Review a new audit finding",
      area: "Documentation",
      priority: "Medium",
      status: "Research",
      details: "Keep the evidence in prose.",
    },
    revisions: board.revisions,
  });
  assert.ok(createdAudit.tasks.some(({ id }) => id === "RA-002"));

  const roadmapText = await readFile(join(root, "docs/roadmap.md"), "utf8");
  assert.match(roadmapText, /\| RM-003 \| Test a generated starter \|/);
  const debtText = await readFile(join(root, "docs/technical-debt.md"), "utf8");
  assert.match(debtText, /\| TD-02 \| Reduce repeated configuration \|/);
  assert.match(debtText, /Keep only values needed by real projects/);

  const edited = await editTaskInDocuments(root, config, {
    taskId: "TD-02",
    updates: { status: "Complete", limitation: "Resolved.", rationale: "Config is now narrow." },
    revisions: createdAudit.revisions,
  });
  assert.equal(edited.tasks.find(({ id }) => id === "TD-02").status, "Complete");

  const deleted = await deleteTaskInDocuments(root, config, {
    taskId: "RA-002",
    confirmed: true,
    revisions: edited.revisions,
  });
  assert.ok(!deleted.tasks.some(({ id }) => id === "RA-002"));
  const auditText = await readFile(join(root, "docs/repository-audit.md"), "utf8");
  assert.match(auditText, /This starter audit demonstrates preserving evidence/);
  assert.doesNotMatch(auditText, /\| RA-002 \|/);
});

test("uses the independent project's configured IDs, statuses, and required extra fields", async (t) => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/independent-project/", import.meta.url));
  const { root, config } = await createWorkspace(t, exampleRoot);
  const board = await readBoardSnapshot(root, config);
  const created = await createTaskInDocuments(root, config, {
    sourceType: "experiments",
    task: {
      title: "Review a new workflow",
      area: "Research",
      priority: "Urgent",
      status: "Open",
      details: "Run the second session.",
      hypothesis: "Reviewing weekly will reduce missed notes.",
    },
    revisions: board.revisions,
  });
  assert.ok(created.tasks.some(({ id, status }) => id === "EXP-002" && status === "Open"));

  await assert.rejects(
    createTaskInDocuments(root, config, {
      sourceType: "experiments",
      task: {
        title: "Missing hypothesis",
        area: "Research",
        priority: "Urgent",
        status: "Open",
        details: "",
        hypothesis: "",
      },
      revisions: created.revisions,
    }),
    (error) => error instanceof BoardStorageError && error.code === "board_input_invalid",
  );
});

test("moves tasks and rejects stale revisions without overwriting newer Markdown", async (t) => {
  const { root, config } = await createWorkspace(t);
  const snapshot = await readBoardSnapshot(root, config);
  const moved = await moveTaskInDocuments(root, config, {
    taskId: "RM-001",
    status: "Complete",
    order: 300,
    revisions: snapshot.revisions,
  });
  assert.equal(moved.tasks.find(({ id }) => id === "RM-001").order, 300);

  await writeFile(join(root, "docs/roadmap.md"), `${await readFile(join(root, "docs/roadmap.md"), "utf8")}\nExternal edit.\n`);
  const current = await readFile(join(root, "docs/roadmap.md"), "utf8");
  await assert.rejects(
    moveTaskInDocuments(root, config, {
      taskId: "RM-002",
      status: "Complete",
      order: 400,
      revisions: moved.revisions,
    }),
    (error) => error instanceof BoardStorageError && error.code === "board_revision_conflict",
  );
  assert.equal(await readFile(join(root, "docs/roadmap.md"), "utf8"), current);
});

test("serializes writes with the exclusive workspace lock", async (t) => {
  const { root, config } = await createWorkspace(t);
  const board = await readBoardSnapshot(root, config);
  const lockPath = join(root, ".github/extensions/project-kanban/.kanban-write.lock");
  await mkdir(join(root, ".github/extensions/project-kanban"), { recursive: true });
  await writeFile(lockPath, "held\n");

  await assert.rejects(
    createTaskInDocuments(root, config, {
      sourceType: "roadmap",
      task: {
        title: "Blocked write",
        area: "Testing",
        priority: "Low",
        status: "Planned",
        details: "",
      },
      revisions: board.revisions,
    }),
    (error) => error instanceof BoardStorageError && error.code === "board_write_busy",
  );
  assert.equal((await readBoardSnapshot(root, config)).tasks.length, board.tasks.length);
});

test("rejects configured source symlinks that resolve outside the workspace", async (t) => {
  const { root, config } = await createWorkspace(t);
  const outsideRoot = await mkdtemp(join(tmpdir(), "project-kanban-outside-test-"));
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  const outsideFile = join(outsideRoot, "roadmap.md");
  await writeFile(outsideFile, "# External roadmap\n");
  await rm(join(root, "docs/roadmap.md"));
  await symlink(outsideFile, join(root, "docs/roadmap.md"));

  await assert.rejects(
    readBoardSnapshot(root, config),
    (error) => error instanceof BoardStorageError && error.code === "board_source_invalid",
  );
});
