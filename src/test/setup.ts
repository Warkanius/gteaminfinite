import "@testing-library/jest-dom";

// Node-environment suites (e.g. the embedded-Postgres integration tests) have no DOM.
if (typeof window === "undefined") {
  // nothing to patch outside the browser environment
} else
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
