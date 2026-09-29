import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine: the router calls this on every navigation, and jsdom logs
// "Not implemented" for it otherwise.
window.scrollTo = () => {};
