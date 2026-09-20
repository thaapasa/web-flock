/// <reference types="vite/client" />

// Brings in Vite's module declarations, of which the one that matters here is
// `*?raw`: importing a file with that suffix yields its contents as a string.
// That is how the shaders in `render/` are loaded — as `.vert` and `.frag`
// files an editor can highlight, rather than as template literals.
