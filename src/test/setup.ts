// Server-side tests run in the node environment (`// @vitest-environment node`)
// and have no window; only the jsdom tests need the DOM shims.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom");

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
}
