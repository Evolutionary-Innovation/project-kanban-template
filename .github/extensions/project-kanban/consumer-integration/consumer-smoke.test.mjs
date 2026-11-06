import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { readBoardConfig } from "../board-config.mjs";
import { createTaskInDocuments, readBoardSnapshot } from "../board-storage.mjs";

const consumerRoot = process.env.KANBAN_CONSUMER_ROOT
  ? resolve(process.env.KANBAN_CONSUMER_ROOT)
  : undefined;

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

test("loads and writes only a disposable copy of a configured consumer workspace", { skip: !consumerRoot }, async (t) => {
  const consumerConfig = await readBoardConfig(consumerRoot);
  const configPath = join(consumerRoot, "project-kanban.config.json");
  const originalConfig = await readFile(configPath);
  const originalSources = new Map(
    await Promise.all(consumerConfig.sources.map(async (source) => [
      source.path,
      await readFile(join(consumerRoot, source.path)),
    ])),
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "project-kanban-consumer-smoke-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await writeFile(join(temporaryRoot, "project-kanban.config.json"), originalConfig);
  for (const [path, contents] of originalSources) {
    const target = join(temporaryRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  const config = await readBoardConfig(temporaryRoot);
  const initial = await readBoardSnapshot(temporaryRoot, config);
  const source = config.sources[0];
  const task = {
    title: "Disposable consumer smoke record",
    area: "Testing",
    priority: config.priorities[0].name,
    status: config.defaultStatus,
    details: "Created only in the temporary consumer copy.",
  };
  for (const field of source.extraFields) {
    if (field.required) task[field.key] = field.choices?.[0] ?? "Disposable smoke value";
  }
  const updated = await createTaskInDocuments(temporaryRoot, config, {
    sourceType: source.key,
    task,
    revisions: initial.revisions,
  });

  const created = updated.tasks.find(({ title }) => title === task.title);
  assert.ok(created);
  assert.equal(created.source.document, source.path);
  assert.equal((await readBoardSnapshot(temporaryRoot, config)).tasks.length, initial.tasks.length + 1);
  assert.equal(hash(await readFile(configPath)), hash(originalConfig));
  for (const [path, contents] of originalSources) {
    assert.equal(hash(await readFile(join(consumerRoot, path))), hash(contents), `${path} must remain unchanged`);
  }
});
