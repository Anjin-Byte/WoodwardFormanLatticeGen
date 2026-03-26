# Lattice

GPU-accelerated 3D web application built with Three.js, Svelte 5, and TypeScript.

## Architecture

```
├── apps/lattice-app     Vite + Svelte 5 app — UI shell and Three.js viewport
├── packages/viewer      Three.js integration layer (renderer, scene, camera, controls)
├── packages/ui          Reusable Svelte component library
├── packages/lattice-core Shared TypeScript domain logic and math utilities
└── crates/lattice-wasm  Optional Rust → WASM compute utilities
```

**Rendering**: Three.js owns the rendering pipeline, scene graph, camera, materials, and draw loop. Svelte manages the UI shell and mounts the Three.js canvas.

**WASM**: Rust/WASM is scoped to bounded compute tasks (geometry generation, data transforms). The app runs without it.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Rust + wasm-pack (only for `build:wasm`)

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Build all packages and the app |
| `pnpm preview` | Preview the production build |
| `pnpm check` | Run svelte-check |
| `pnpm test` | Run unit tests across all packages |
| `pnpm test:e2e` | Run Playwright e2e tests |
| `pnpm build:wasm` | Build the Rust/WASM crate |

## Building WASM (optional)

```bash
pnpm build:wasm
```

This compiles `crates/lattice-wasm` and outputs the package to `packages/lattice-wasm-pkg/`. Import it in app code behind a dynamic `import()` so the app works without it.

## Package overview

### `@lattice/viewer`
Three.js integration layer. Exposes a `Viewer` class that manages the WebGL renderer, scene, camera, orbit controls, resize handling, and animation loop. Mount/unmount lifecycle is designed for Svelte component integration.

### `@lattice/ui`
Shared Svelte 5 components (panels, buttons, layout primitives). Uses Tailwind CSS for styling.

### `@lattice/core`
Pure TypeScript utilities — math helpers, types, domain logic. No framework dependencies.

### `crates/lattice-wasm`
Optional Rust crate compiled to WASM via `wasm-pack`. Contains compute utilities like grid generation. Not required for the app to run.

## Design decisions

- **No SvelteKit**: Plain Vite app — no SSR or routing framework needed for a GPU/3D tool.
- **Three.js separated from Svelte**: The viewer module is framework-agnostic. Svelte components mount/unmount it but don't reach into the scene graph directly.
- **Tailwind v4**: Utility-first CSS with the Vite plugin for zero-config setup.
- **WASM is optional**: The app boots and renders without any WASM modules. Rust compute is opt-in for performance-critical paths.
