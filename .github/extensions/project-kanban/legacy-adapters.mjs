import {
  migrateLegacyMarkdown as migrateTradeMstrMarkdown,
  parseBoardDocuments as parseTradeMstrDocuments,
} from "./adapters/trade-mstr-v1/board-data.mjs";

const TRADE_MSTR_PATHS = new Set([
  "docs/roadmap.md",
  "docs/technical-debt.md",
  "docs/repository-audit.md",
]);

const adapters = new Map([
  [
    "trade-mstr-v1",
    {
      parse(documents, config) {
        const configuredPaths = new Set(config.sources.map(({ path }) => path));
        if (
          configuredPaths.size !== TRADE_MSTR_PATHS.size ||
          [...TRADE_MSTR_PATHS].some((path) => !configuredPaths.has(path))
        ) {
          throw new Error("The Trade-MSTR v1 adapter requires its three original source paths.");
        }
        return parseTradeMstrDocuments({
          roadmap: documents["docs/roadmap.md"],
          technicalDebt: documents["docs/technical-debt.md"],
          repositoryAudit: documents["docs/repository-audit.md"],
        }).tasks;
      },
      migrate(markdown, source, tasks) {
        if (!TRADE_MSTR_PATHS.has(source.path)) {
          throw new Error(`The Trade-MSTR v1 adapter cannot migrate ${source.path}.`);
        }
        return migrateTradeMstrMarkdown(markdown, source.path, tasks);
      },
    },
  ],
]);

export function getLegacyAdapter(name) {
  const adapter = adapters.get(name);
  if (!adapter) throw new Error(`Unsupported legacy adapter "${name}".`);
  return adapter;
}
