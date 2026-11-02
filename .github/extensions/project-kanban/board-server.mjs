import { readFile } from "node:fs/promises";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function send(response, status, contentType, body) {
  response.writeHead(status, {
    ...securityHeaders,
    "Content-Type": contentType,
  });
  response.end(body);
}

function sendJson(response, status, body) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function statusFor(error) {
  if (error?.code === "board_input_invalid" || error?.code === "board_dependency_cycle") return 400;
  if (error?.code === "board_revision_conflict" || error?.code === "board_write_busy") return 409;
  if (error?.code === "board_task_not_found") return 404;
  return 500;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32768) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body exceeds 32 KB."), { code: "board_input_invalid" }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { code: "board_input_invalid" }));
      }
    });
  });
}

async function readAssets() {
  const files = [
    ["board-page.html", "text/html; charset=utf-8"],
    ["board.css", "text/css; charset=utf-8"],
    ["board-client.js", "text/javascript; charset=utf-8"],
    ["board-view.mjs", "text/javascript; charset=utf-8"],
  ];
  const assets = new Map();

  for (const [file, contentType] of files) {
    const contents = await readFile(new URL(`./${file}`, import.meta.url));
    assets.set(file, { contentType, contents });
  }
  return assets;
}

export async function createBoardRequestHandler({ loadBoard, moveTask, createTask, editTask, deleteTask }) {
  if ([loadBoard, moveTask, createTask, editTask, deleteTask].some((handler) => typeof handler !== "function")) {
    throw new TypeError("Markdown load and task mutation handlers are required.");
  }

  const assets = await readAssets();
  const routes = new Map([
    ["/", "board-page.html"],
    ["/board.css", "board.css"],
    ["/board-client.js", "board-client.js"],
    ["/board-view.mjs", "board-view.mjs"],
  ]);
  const mutationRoutes = new Map([
    ["/api/tasks/move", moveTask],
    ["/api/tasks/create", createTask],
    ["/api/tasks/edit", editTask],
    ["/api/tasks/delete", deleteTask],
  ]);

  return async (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      sendJson(response, 400, { error: "Invalid request URL." });
      return;
    }

    const mutationHandler = mutationRoutes.get(pathname);
    if (mutationHandler) {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: "Only POST requests are supported for task moves." });
        return;
      }
      const expectedOrigin = `http://${request.headers.host}`;
      if (request.headers.origin !== expectedOrigin) {
        sendJson(response, 403, { error: "Task moves must originate from this board." });
        return;
      }
      if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        sendJson(response, 415, { error: "Task moves require an application/json body." });
        return;
      }
      try {
        sendJson(response, 200, await mutationHandler(await readJsonBody(request)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown task update error.";
        sendJson(response, statusFor(error), { error: message, code: error?.code ?? "board_update_failed" });
      }
      return;
    }

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "Only GET requests are supported." });
      return;
    }

    if (pathname === "/api/board") {
      try {
        sendJson(response, 200, await loadBoard());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown board loading error.";
        sendJson(response, 500, { error: message });
      }
      return;
    }

    const assetName = routes.get(pathname);
    if (!assetName) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const asset = assets.get(assetName);
    send(response, 200, asset.contentType, asset.contents);
  };
}
