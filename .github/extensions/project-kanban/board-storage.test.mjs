import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createTaskInDocuments,
  deleteTaskInDocuments,
  editTaskInDocuments,
  moveTaskInDocuments,
  readBoardSnapshot,
  BoardStorageError,
} from "./board-storage.mjs";
import { updateTaskRecord } from "./board-data.mjs";
import { createTestWorkspace, independentTestConfig } from "./test-fixtures.mjs";

function todayDateOnly() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function createWorkspace(t, config = undefined) {
  return createTestWorkspace(t, config);
}

test("persists Roadmap, Technical Debt, and Audit mutations to their configured Markdown sources", async (t) => {
  const { root, config } = await createWorkspace(t);
  const roadmapPath = join(root, config.sources.find(({ key }) => key === "roadmap").path);
  const debtPath = join(root, config.sources.find(({ key }) => key === "technicalDebt").path);
  const auditPath = join(root, config.sources.find(({ key }) => key === "repositoryAudit").path);
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
  const generatedRoadmapTask = createdRoadmap.tasks.find(({ title }) => title === "Test a generated starter");
  assert.match(generatedRoadmapTask.id, /^RM-\d{3}$/);

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

  const roadmapText = await readFile(roadmapPath, "utf8");
  assert.match(roadmapText, new RegExp(`\\| ${generatedRoadmapTask.id} \\| Test a generated starter \\|`));
  const debtText = await readFile(debtPath, "utf8");
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
  const auditText = await readFile(auditPath, "utf8");
  assert.match(auditText, /The fixture narrative is preserved outside the task table/);
  assert.doesNotMatch(auditText, /\| RA-002 \|/);
});

test("keeps source task IDs monotonic when the highest ID is deleted", async (t) => {
  const { root, config } = await createWorkspace(t);
  const roadmapPath = join(root, config.sources.find(({ key }) => key === "roadmap").path);
  let board = await readBoardSnapshot(root, config);
  board = await deleteTaskInDocuments(root, config, {
    taskId: "RM-003",
    confirmed: true,
    revisions: board.revisions,
  });

  let roadmapText = await readFile(roadmapPath, "utf8");
  assert.match(roadmapText, /<!-- project-kanban-id-sequence:RM:4 -->/);
  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Avoid reusing deleted IDs",
      area: "Testing",
      priority: "High",
      status: "Planned",
      details: "",
    },
    revisions: board.revisions,
  });
  assert.ok(board.tasks.some(({ id }) => id === "RM-004"));

  board = await deleteTaskInDocuments(root, config, {
    taskId: "RM-004",
    confirmed: true,
    revisions: board.revisions,
  });
  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Continue the monotonic sequence",
      area: "Testing",
      priority: "Medium",
      status: "Planned",
      details: "",
    },
    revisions: board.revisions,
  });
  assert.ok(board.tasks.some(({ id }) => id === "RM-005"));
  roadmapText = await readFile(roadmapPath, "utf8");
  assert.match(roadmapText, /<!-- project-kanban-id-sequence:RM:6 -->/);
});

test("keeps creation and latest completion dates independent across the task lifecycle", async (t) => {
  const { root, config } = await createWorkspace(t);
  let board = await readBoardSnapshot(root, config);
  assert.equal(board.tasks.find(({ id }) => id === "RM-001").createdDate, "");
  assert.equal(board.tasks.find(({ id }) => id === "RM-001").completionDate, "");

  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Track independent lifecycle dates",
      area: "Testing",
      priority: "High",
      status: "Planned",
      details: "",
    },
    revisions: board.revisions,
  });
  let task = board.tasks.find(({ title }) => title === "Track independent lifecycle dates");
  assert.equal(task.createdDate, todayDateOnly());
  assert.equal(task.completionDate, "");

  board = await moveTaskInDocuments(root, config, {
    taskId: task.id,
    status: "Complete",
    order: 300,
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.createdDate, todayDateOnly());
  assert.equal(task.completionDate, todayDateOnly());

  board = await moveTaskInDocuments(root, config, {
    taskId: task.id,
    status: "Planned",
    order: 400,
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.createdDate, todayDateOnly());
  assert.equal(task.completionDate, todayDateOnly());

  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Record direct completion",
      area: "Testing",
      priority: "Medium",
      status: "Complete",
      details: "",
    },
    revisions: board.revisions,
  });
  const directlyCompleted = board.tasks.find(({ title }) => title === "Record direct completion");
  assert.equal(directlyCompleted.createdDate, todayDateOnly());
  assert.equal(directlyCompleted.completionDate, todayDateOnly());

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { completionDate: "2020-01-01" },
    revisions: board.revisions,
  });
  assert.equal(board.tasks.find(({ id }) => id === task.id).completionDate, "2020-01-01");

  board = await moveTaskInDocuments(root, config, {
    taskId: task.id,
    status: "Complete",
    order: 400,
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.createdDate, todayDateOnly());
  assert.equal(task.completionDate, todayDateOnly());

  await assert.rejects(
    editTaskInDocuments(root, config, {
      taskId: task.id,
      updates: { createdDate: "2025-02-30" },
      revisions: board.revisions,
    }),
    (error) => error instanceof BoardStorageError && error.code === "board_input_invalid",
  );
});

test("enforces completion dates on edit transitions when completionDate is supplied", async (t) => {
  const { root, config } = await createWorkspace(t);
  let board = await readBoardSnapshot(root, config);
  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Complete through edit transitions",
      area: "Testing",
      priority: "Medium",
      status: "Planned",
      details: "",
    },
    revisions: board.revisions,
  });
  let task = board.tasks.find(({ title }) => title === "Complete through edit transitions");

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { status: "Complete", completionDate: "" },
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.completionDate, todayDateOnly());

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { status: "In Progress", completionDate: "" },
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.completionDate, todayDateOnly());

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { completionDate: "2020-01-01" },
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.completionDate, "2020-01-01");

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { status: "Complete", completionDate: "" },
    revisions: board.revisions,
  });
  assert.equal(board.tasks.find(({ id }) => id === task.id).completionDate, todayDateOnly());
});

test("preserves historical blank completion dates on reopen and sets a date on recommpletion", async (t) => {
  const { root, config } = await createWorkspace(t);
  let board = await readBoardSnapshot(root, config);
  board = await createTaskInDocuments(root, config, {
    sourceType: "roadmap",
    task: {
      title: "Preserve an unknown historical completion date",
      area: "Testing",
      priority: "Medium",
      status: "Planned",
      details: "",
    },
    revisions: board.revisions,
  });
  let task = board.tasks.find(({ title }) => title === "Preserve an unknown historical completion date");
  const source = config.sources.find(({ path }) => path === task.source.document);
  const sourcePath = join(root, source.path);
  const sourceMarkdown = await readFile(sourcePath, "utf8");
  await writeFile(
    sourcePath,
    updateTaskRecord(
      sourceMarkdown,
      task.id,
      { status: "Complete", completionDate: "" },
      source,
      config,
    ),
  );

  board = await readBoardSnapshot(root, config);
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.status, "Complete");
  assert.equal(task.completionDate, "");

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { status: "In Progress", completionDate: "" },
    revisions: board.revisions,
  });
  task = board.tasks.find(({ id }) => id === task.id);
  assert.equal(task.completionDate, "");

  board = await editTaskInDocuments(root, config, {
    taskId: task.id,
    updates: { status: "Complete", completionDate: "" },
    revisions: board.revisions,
  });
  assert.equal(board.tasks.find(({ id }) => id === task.id).completionDate, todayDateOnly());
});

test("persists cross-source dependencies and rejects edits that introduce cycles", async (t) => {
  const { root, config } = await createWorkspace(t);
  let board = await readBoardSnapshot(root, config);
  const roadmapTask = board.tasks.find(({ id }) => id.startsWith("RM-"));
  const debtTask = board.tasks.find(({ id }) => id.startsWith("TD-"));

  board = await editTaskInDocuments(root, config, {
    taskId: roadmapTask.id,
    updates: { dependsOn: debtTask.id },
    revisions: board.revisions,
  });
  let dependent = board.tasks.find(({ id }) => id === roadmapTask.id);
  assert.deepEqual(dependent.dependencyView.dependsOn, [debtTask.id]);
  assert.deepEqual(dependent.dependencyView.blockedBy, [debtTask.id]);

  await assert.rejects(
    editTaskInDocuments(root, config, {
      taskId: debtTask.id,
      updates: { dependsOn: roadmapTask.id },
      revisions: board.revisions,
    }),
    (error) => error instanceof BoardStorageError && error.code === "board_dependency_cycle",
  );

  board = await editTaskInDocuments(root, config, {
    taskId: roadmapTask.id,
    updates: { dependsOn: "RA-999" },
    revisions: board.revisions,
  });
  dependent = board.tasks.find(({ id }) => id === roadmapTask.id);
  assert.deepEqual(dependent.dependencyView.unresolved, ["RA-999"]);
  assert.equal(dependent.dependencyView.isBlocked, true);
});

test("rejects malformed, duplicate, and self-referential dependencies on task creation", async (t) => {
  const { root, config } = await createWorkspace(t);
  const board = await readBoardSnapshot(root, config);
  const baseTask = {
    title: "Validate a new dependency",
    area: "Testing",
    priority: "High",
    status: "Planned",
    details: "",
  };

  for (const dependsOn of ["XX-001", "RM-001, RM-001", "RM-004"]) {
    await assert.rejects(
      createTaskInDocuments(root, config, {
        sourceType: "roadmap",
        task: { ...baseTask, dependsOn },
        revisions: board.revisions,
      }),
      (error) => error instanceof BoardStorageError && error.code === "board_input_invalid",
    );
  }
});

test("uses the independent project's configured IDs, statuses, and required extra fields", async (t) => {
  const { root, config } = await createWorkspace(t, independentTestConfig());
  const board = await readBoardSnapshot(root, config);
  assert.equal(board.tasks.find(({ id }) => id === "EXP-001").createdDate, "");
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
  const createdTask = created.tasks.find(({ id }) => id === "EXP-002");
  assert.equal(createdTask.status, "Open");
  assert.equal(createdTask.createdDate, todayDateOnly());
  assert.equal(createdTask.completionDate, "");

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
  const roadmapPath = join(root, config.sources.find(({ key }) => key === "roadmap").path);
  const snapshot = await readBoardSnapshot(root, config);
  const moved = await moveTaskInDocuments(root, config, {
    taskId: "RM-001",
    status: "Complete",
    order: 300,
    revisions: snapshot.revisions,
  });
  assert.equal(moved.tasks.find(({ id }) => id === "RM-001").order, 300);

  await writeFile(roadmapPath, `${await readFile(roadmapPath, "utf8")}\nExternal edit.\n`);
  const current = await readFile(roadmapPath, "utf8");
  await assert.rejects(
    moveTaskInDocuments(root, config, {
      taskId: "RM-002",
      status: "Complete",
      order: 400,
      revisions: moved.revisions,
    }),
    (error) => error instanceof BoardStorageError && error.code === "board_revision_conflict",
  );
  assert.equal(await readFile(roadmapPath, "utf8"), current);
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
  const roadmapPath = join(root, config.sources.find(({ key }) => key === "roadmap").path);
  const outsideRoot = await mkdtemp(join(tmpdir(), "project-kanban-outside-test-"));
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  const outsideFile = join(outsideRoot, "roadmap.md");
  await writeFile(outsideFile, "# External roadmap\n");
  await rm(roadmapPath);
  await symlink(outsideFile, roadmapPath);

  await assert.rejects(
    readBoardSnapshot(root, config),
    (error) => error instanceof BoardStorageError && error.code === "board_source_invalid",
  );
});
