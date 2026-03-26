# WoodwardFormanLatticeGen

Browser-based lattice structure generator for additive manufacturing. Generates beam lattice geometries from unit cells, applies domain trimming, and exports watertight STL meshes.

Built with Svelte 5, Three.js, Rust/WASM, and WebGPU.

## Quick Start

```bash
pnpm install
pnpm dev
```

Optional WASM build (requires Rust + wasm-pack):

```bash
pnpm build:wasm
```

## References

1. Woodward, I.R. & Fromen, C.A. (2021). Scalable, process-oriented beam lattices: Generation, characterization, and compensation for open cellular structures. *Additive Manufacturing*, 48, 102386. https://doi.org/10.1016/j.addma.2021.102386

2. Inayat, A., Schwerdtfeger, J., Freund, H., Korner, C., Singer, R.F. & Schwieger, W. (2016). Determining the specific surface area of ceramic foams: A new approach. *Chemical Engineering Journal*, 287, 704-719. https://doi.org/10.1016/j.cej.2015.11.012

## License

MIT
