import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readBoardConfig } from "../../.github/extensions/project-kanban/board-config.mjs";
import { createBoardRequestHandler } from "../../.github/extensions/project-kanban/board-server.mjs";
import {
  createTaskInDocuments,
  deleteTaskInDocuments,
  editTaskInDocuments,
  moveTaskInDocuments,
  readBoardSnapshot,
} from "../../.github/extensions/project-kanban/board-storage.mjs";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));
const config = await readBoardConfig(workspaceRoot);
const loadBoard = () => readBoardSnapshot(workspaceRoot, config);
const handler = await createBoardRequestHandler({
  loadBoard,
  moveTask: (input) => moveTaskInDocuments(workspaceRoot, config, input),
  createTask: (input) => createTaskInDocuments(workspaceRoot, config, input),
  editTask: (input) => editTaskInDocuments(workspaceRoot, config, input),
  deleteTask: (input) => deleteTaskInDocuments(workspaceRoot, config, input),
});
const server = createServer(handler);
const port = Number(process.env.PORT ?? 0);

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The synthetic browser project did not receive a local address.");
  }
  process.stdout.write(`Synthetic browser project: http://127.0.0.1:${address.port}/\n`);
});

function closeServer() {
  server.close((error) => {
    if (error) {
      process.stderr.write(`Unable to close synthetic browser server: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);
