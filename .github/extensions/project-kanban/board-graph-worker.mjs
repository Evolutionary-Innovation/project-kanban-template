import { layoutGraph } from "./board-graph.mjs";
import * as dagre from "./vendor/dagre-3.1.3.mjs";

self.addEventListener("message", ({ data }) => {
  try {
    self.postMessage({ layout: layoutGraph(data, dagre) });
  } catch (error) {
    self.postMessage({
      error: error instanceof RangeError && /call stack/i.test(error.message)
        ? "This graph exceeds the layout engine's current depth limit. Use the relationship list or return to Kanban."
        : error instanceof Error ? error.message : "The dependency layout could not be calculated.",
    });
  }
});
