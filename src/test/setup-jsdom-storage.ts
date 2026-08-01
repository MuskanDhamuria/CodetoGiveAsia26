// Node 22+ ships a built-in `globalThis.localStorage` getter that only works
// with `--localstorage-file`. Vitest's jsdom environment sees that getter
// already present on `global` and, per its populateGlobal key filter, skips
// copying over jsdom's real (working) localStorage/sessionStorage — leaving
// both silently `undefined` in every jsdom test. Restore them from the real
// jsdom Window that vitest stashes at `globalThis.jsdom`.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window

if (jsdomWindow) {
  Object.defineProperty(globalThis, "localStorage", {
    get: () => jsdomWindow.localStorage,
    configurable: true,
  })
  Object.defineProperty(globalThis, "sessionStorage", {
    get: () => jsdomWindow.sessionStorage,
    configurable: true,
  })
}
