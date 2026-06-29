// Browser stub for Node-only `undici`.
//
// `@mendable/firecrawl-js` v4 dynamically `import("undici")` solely for its
// websocket-based job watcher (crawl/extract monitoring). The client-side
// `search()` path in `useWebSearch.ts` never reaches that code, but Rollup
// still tries to resolve `undici` when bundling the SDK for the browser and
// fails (undici is Node-only). This stub is aliased in for the *client* build
// only (see `nuxt.config.ts`); the server uses the real undici via Nitro.
export const WebSocket = undefined
export default {}
