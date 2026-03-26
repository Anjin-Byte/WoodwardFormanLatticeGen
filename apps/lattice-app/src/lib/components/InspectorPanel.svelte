<script lang="ts">
  import {
    Section, CheckboxRow, ScrubField, PropRow, BarMeter,
    ToggleGroup, ActionButton,
  } from '@gestalt/phi';
  import {
    getUnitCellId, setUnitCellId, getUnitCellIds,
    getResolution, setResolution,
    getPadding, setPadding,
    getManualNx, getManualNy, getManualNz, setManualNx, setManualNy, setManualNz,
    getManualCellSize, setManualCellSize,
    getRStar, setRStar, getAbsoluteRadius,
    getDomainEnabled, setDomainEnabled,
    getDomainShape, setDomainShape,
    getDomainRadius, setDomainRadius,
    getDomainSource, setDomainSource,
    getMeshFileName, getMeshInfo, setMeshFile,
    getSkinEnabled, setSkinEnabled,
    getLatticeProperties, getPipelineStats, getActiveGrid, getDebugLog,
    getVoxelizerTierOverride, setVoxelizerTierOverride,
    getShowBeams, setShowBeams,
    getShowSkin, setShowSkin,
    getShowDomainMesh, setShowDomainMesh,
    getShowGridBounds, setShowGridBounds,
    getShowAxes, setShowAxes,
    getDomainDisplayMode, setDomainDisplayMode,
  } from '$lib/stores/lattice.svelte';

  function fmt(v: number | undefined, decimals = 4): string {
    if (v === undefined || !Number.isFinite(v)) return '—';
    return v.toFixed(decimals);
  }

  function fmtInt(v: number | undefined): string {
    if (v === undefined) return '—';
    return v.toLocaleString();
  }

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    setMeshFile(buffer, file.name);
  }
</script>

<div class="inspector">

  <Section sectionId="lattice-cell" title="Unit Cell">
    <div class="field">
      <label>Type</label>
      <select
        value={getUnitCellId()}
        onchange={(e) => setUnitCellId((e.target as HTMLSelectElement).value)}
      >
        {#each getUnitCellIds() as id}
          <option value={id}>{id}</option>
        {/each}
      </select>
    </div>
  </Section>

  <Section sectionId="lattice-grid" title="Grid">
    {#if getDomainEnabled()}
      <ScrubField label="Resolution" value={getResolution()} min={2} max={50} step={1} decimals={0} onValueChange={setResolution} />
      <ScrubField label="Padding" value={getPadding()} min={0} max={5} step={1} decimals={0} onValueChange={setPadding} />
      {@const g = getActiveGrid()}
      <PropRow label="Cells" value={`${g.nx} × ${g.ny} × ${g.nz}`} />
      <PropRow label="Cell Size" value={fmt(g.cellSize[0], 4)} />
    {:else}
      <ScrubField label="X" value={getManualNx()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNx} />
      <ScrubField label="Y" value={getManualNy()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNy} />
      <ScrubField label="Z" value={getManualNz()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNz} />
      <ScrubField label="Cell Size" value={getManualCellSize()} min={0.01} max={10} step={0.05} decimals={3} onValueChange={setManualCellSize} />
    {/if}
  </Section>

  <Section sectionId="lattice-strut" title="Strut">
    <ScrubField label="r*" value={getRStar()} min={0.01} max={0.45} step={0.005} decimals={3} onValueChange={setRStar} />
    <PropRow label="Radius" value={fmt(getAbsoluteRadius(), 4)} />
  </Section>

  <Section sectionId="lattice-domain" title="Domain">
    <CheckboxRow label="Enabled" checked={getDomainEnabled()} onchange={setDomainEnabled} />

    {#if getDomainEnabled()}
      <ToggleGroup
        label="Source"
        options={[{ value: 'generated', label: 'Generated' }, { value: 'file', label: 'File' }]}
        value={getDomainSource()}
        onValueChange={(v) => setDomainSource(v as 'generated' | 'file')}
      />

      {#if getDomainSource() === 'generated'}
        <ToggleGroup
          label="Shape"
          options={[{ value: 'sphere', label: 'Sphere' }, { value: 'box', label: 'Box' }]}
          value={getDomainShape()}
          onValueChange={(v) => setDomainShape(v as 'box' | 'sphere')}
        />
        <ScrubField label="Radius" value={getDomainRadius()} min={0.1} max={20} step={0.1} decimals={2} onValueChange={setDomainRadius} />
      {:else}
        <div class="file-row">
          <input type="file" accept=".stl,.obj" onchange={handleFileUpload} />
        </div>
        {#if getMeshFileName()}
          <PropRow label="File" value={getMeshFileName()} />
          {#if getMeshInfo()}
            <PropRow label="Vertices" value={fmtInt(getMeshInfo()!.vertices)} />
            <PropRow label="Triangles" value={fmtInt(getMeshInfo()!.triangles)} />
          {/if}
        {/if}
      {/if}

      <CheckboxRow label="Skin" checked={getSkinEnabled()} onchange={setSkinEnabled} />
    {/if}
  </Section>

  <Section sectionId="render-layers" title="Layers">
    <CheckboxRow label="Beams" checked={getShowBeams()} onchange={setShowBeams} />
    <CheckboxRow label="Skin" checked={getShowSkin()} onchange={setShowSkin} />
    <CheckboxRow label="Domain Mesh" checked={getShowDomainMesh()} onchange={setShowDomainMesh} />
    <CheckboxRow label="Grid Bounds" checked={getShowGridBounds()} onchange={setShowGridBounds} />
    <CheckboxRow label="Axes" checked={getShowAxes()} onchange={setShowAxes} />

    {#if getShowDomainMesh()}
      <ToggleGroup
        label="Domain display"
        options={[
          { value: 'transparent', label: 'Trans' },
          { value: 'wireframe', label: 'Wire' },
          { value: 'solid', label: 'Solid' },
        ]}
        value={getDomainDisplayMode()}
        onValueChange={(v) => setDomainDisplayMode(v as 'solid' | 'wireframe' | 'transparent')}
      />
    {/if}
  </Section>

  {#if getPipelineStats()}
    {@const s = getPipelineStats()!}
    <Section sectionId="pipeline-stats" title="Stats">
      <PropRow label="Nodes" value={fmtInt(s.nodeCount)} />
      <PropRow label="Beams" value={fmtInt(s.beamCount)} />
      <PropRow label="Visible" value={fmtInt(s.visibleBeamCount)} />
      <PropRow label="Removed" value={fmtInt(s.removedBeamCount)} />
      <PropRow label="Skin" value={fmtInt(s.skinBeamCount)} />

      {#if s.cellsBoundary > 0 || s.cellsExterior > 0}
        <BarMeter label="Interior" value={s.cellsInterior} max={s.cellsTotal} unit="cells" />
        <BarMeter label="Boundary" value={s.cellsBoundary} max={s.cellsTotal} unit="cells" />
      {/if}

      <PropRow label="Pipeline" value={`${s.pipelineTimeMs.toFixed(1)} ms`} />
      <PropRow label="Voxelizer" value={s.voxelizerTier} />
    </Section>
  {/if}

  {#if getLatticeProperties()}
    {@const p = getLatticeProperties()!}
    <Section sectionId="lattice-props" title="Properties">
      <PropRow label="Porosity" value={fmt(p.openPorosity)} />
      <PropRow label="Tortuosity" value={fmt(p.tortuosity)} />
      <PropRow label="S_v-geo" value={`${fmt(p.specificSurfaceArea, 1)} m⁻¹`} />
      <PropRow label="d_h" value={`${fmt(p.hydraulicDiameter)} m`} />
    </Section>
  {/if}

  <Section sectionId="debug" title="Debug">
    <ToggleGroup
      label="Voxelizer"
      options={[
        { value: 'auto', label: 'Auto' },
        { value: 'gpu', label: 'GPU' },
        { value: 'cpu-wasm', label: 'CPU' },
        { value: 'js', label: 'JS' },
      ]}
      value={getVoxelizerTierOverride()}
      onValueChange={(v) => setVoxelizerTierOverride(v as 'auto' | 'gpu' | 'cpu-wasm' | 'js')}
    />

    {#if getDebugLog()}
      {@const d = getDebugLog()!}
      <PropRow label="Grid" value={`${d.gridDims[0]}×${d.gridDims[1]}×${d.gridDims[2]}`} />
      <PropRow label="Origin" value={d.gridOrigin.map(v => v.toFixed(3)).join(', ')} />
      <PropRow label="Cell Size" value={fmt(d.cellSize)} />
      <PropRow label="Radius" value={fmt(d.absoluteRadius)} />
      <PropRow label="Nodes" value={fmtInt(d.nodeCount)} />
      <PropRow label="Beams" value={fmtInt(d.beamCount)} />
      <PropRow label="Classifier" value={d.classificationMethod} />
      <PropRow label="Interior" value={fmtInt(d.cellsInterior)} />
      <PropRow label="Boundary" value={fmtInt(d.cellsBoundary)} />
      <PropRow label="Exterior" value={fmtInt(d.cellsExterior)} />
      <PropRow label="Trimmed" value={fmtInt(d.trimmedCount)} />
      <PropRow label="Removed" value={fmtInt(d.removedCount)} />
      <PropRow label="Visible" value={fmtInt(d.visibleCount)} />
    {/if}
  </Section>

</div>

<style>
  .inspector {
    padding: 4px 0;
    height: 100%;
    overflow-y: auto;
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
  }

  label {
    font-size: 11px;
    color: var(--text-lo, #888);
    min-width: 50px;
  }

  select {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-size: 11px;
    background: var(--fill-lo, oklch(1 0 0 / 0.05));
    border: 1px solid var(--stroke-lo, oklch(1 0 0 / 0.06));
    border-radius: 4px;
    color: var(--text-hi, #eee);
    outline: none;
    appearance: none;
    cursor: pointer;
  }

  select:focus {
    border-color: var(--interactive, oklch(0.80 0.16 250));
  }

  .file-row {
    padding: 4px 0;
  }

  .file-row input[type="file"] {
    font-size: 10px;
    color: var(--text-mid, #ccc);
  }
</style>
