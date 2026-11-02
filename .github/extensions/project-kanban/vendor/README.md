# Pinned graph layout dependency

The secondary graph uses Dagre for layout only. Native browser code owns rendering and interaction. No framework, package installation, CDN request, or build step is required to use a copied template.

| Asset | Upstream | SHA-256 |
|---|---|---|
| `dagre-3.1.3.mjs` | [`@dagrejs/dagre@3.1.3/dist/dagre.esm.js`](https://unpkg.com/@dagrejs/dagre@3.1.3/dist/dagre.esm.js) | `b0ddaf4af1417bec9bd89373a3a3987f081727d6cc6d95fc40dbf85a19bdf3b0` |
| `dagre-LICENSE` | [`@dagrejs/dagre@3.1.3/LICENSE`](https://unpkg.com/@dagrejs/dagre@3.1.3/LICENSE) | `6a349742a6cb219d5a2fc8d0844f6d89a6efc62e20c664450d884fc7ff2d6015` |
| `graphlib-LICENSE` | [`@dagrejs/graphlib@4.0.6/LICENSE`](https://unpkg.com/@dagrejs/graphlib@4.0.6/LICENSE) | `6a349742a6cb219d5a2fc8d0844f6d89a6efc62e20c664450d884fc7ff2d6015` |

The unmodified ESM distribution includes graphlib (the pinned Dagre release declares version 4.0.6). Both use the MIT licence; retain both accompanying notices when distributing this extension. The layout module is 48,929 raw bytes (approximately 17.1 kB gzip); the local server currently serves it uncompressed. It is loaded by a same-origin module worker only when Dependencies needs a layout. No external imports or dynamic evaluation are required.

## Updating

1. Select an explicitly reviewed stable release of the maintained scoped package `@dagrejs/dagre`, not the legacy `dagre` package or an upstream prerelease.
2. Obtain its self-contained ESM distribution and both corresponding licence notices from exact version URLs above (substituting reviewed versions).
3. Keep the upstream bytes unchanged, calculate SHA-256 hashes, and update this inventory, the client import, server allowlist, and integrity test together.
4. Verify there are no external imports or dynamic-evaluation requirements. Run graph layout, HTTP asset, full extension, and synthetic-browser tests under the existing CSP with external network access disabled.
5. Record any meaningful footprint, licence, layout, or API changes before accepting the update.
