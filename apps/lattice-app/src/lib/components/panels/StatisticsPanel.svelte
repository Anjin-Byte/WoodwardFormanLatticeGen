<script lang="ts">
  import {
    Section, PropRow, BarMeter, CounterRow, StatusIndicator, ToggleGroup,
  } from '@gestalt/phi';
  import {
    getPipelineStats, getLatticeProperties,
    getActiveGrid, getAbsoluteRadius,
    getMeshFileName, getMeshInfo,
    getVoxelizerTierOverride, setVoxelizerTierOverride,
  } from '$lib/stores/lattice.svelte';

  let timingHistory: number[] = [];
  $effect(() => {
    const stats = getPipelineStats();
    if (stats) timingHistory = [...timingHistory.slice(-59), stats.pipelineTimeMs];
  });

  function fmt(v: number | undefined, d = 4): string {
    if (v === undefined || !Number.isFinite(v)) return '—';
    return v.toFixed(d);
  }

  function fmtInt(v: number | undefined): string {
    if (v === undefined) return '—';
    return v.toLocaleString();
  }
</script>

<div class="panel">

  {#if getPipelineStats()}
    {@const s = getPipelineStats()!}

    <Section sectionId="stat-pipeline" title="Pipeline">
      <StatusIndicator
        status={s.voxelizerTier === 'js' ? 'warning' : 'ok'}
        label={s.voxelizerTier === 'cpu-wasm' ? 'CPU WASM' : s.voxelizerTier === 'js' ? 'JS BVH' : s.voxelizerTier}
      />
      <CounterRow label="Total" value={`${s.pipelineTimeMs.toFixed(1)} ms`} history={timingHistory} warn={16} danger={33} />

      {#each s.stages as st}
        <div class="stage-row">
          <span class="stage-name">{st.name}</span>
          <span class="stage-method">{st.method}</span>
          <span class="stage-time">{st.timeMs.toFixed(1)} ms</span>
        </div>
        <div class="stage-output">{st.output}</div>
      {/each}
    </Section>

    <Section sectionId="stat-mesh" title="Mesh">
      <PropRow label="Nodes" value={fmtInt(s.nodeCount)} />
      <PropRow label="Beams" value={fmtInt(s.beamCount)} />
      <PropRow label="Visible" value={fmtInt(s.visibleBeamCount)} />
      <PropRow label="Removed" value={fmtInt(s.removedBeamCount)} />
      <PropRow label="Skin" value={fmtInt(s.skinBeamCount)} />
    </Section>

    {#if s.cellsBoundary > 0 || s.cellsExterior > 0}
      <Section sectionId="stat-cells" title="Cells">
        <BarMeter label="Interior" value={s.cellsInterior} max={s.cellsTotal} unit="cells" />
        <BarMeter label="Boundary" value={s.cellsBoundary} max={s.cellsTotal} unit="cells" />
        <BarMeter label="Exterior" value={s.cellsExterior} max={s.cellsTotal} unit="cells" />
      </Section>
    {/if}
  {/if}

  <Section sectionId="stat-grid" title="Grid">
    {@const g = getActiveGrid()}
    <PropRow label="Cells" value={`${g.nx} × ${g.ny} × ${g.nz}`} />
    <PropRow label="Cell Size" value={fmt(g.cellSize[0])} />
    <PropRow label="Origin" value={g.origin.map(v => v.toFixed(2)).join(', ')} />
    <PropRow label="Radius" value={fmt(getAbsoluteRadius())} />
  </Section>

  {#if getLatticeProperties()}
    {@const p = getLatticeProperties()!}
    <Section sectionId="stat-properties" title="Properties">
      <PropRow label="Porosity" value={fmt(p.openPorosity)} />
      <PropRow label="Tortuosity" value={fmt(p.tortuosity)} />
      <PropRow label="S_v-geo" value={`${fmt(p.specificSurfaceArea, 1)} m⁻¹`} />
      <PropRow label="d_h" value={`${fmt(p.hydraulicDiameter)} m`} />
    </Section>
  {/if}

  <Section sectionId="stat-debug" title="Debug">
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

    {#if getPipelineStats()}
      <PropRow label="Classifier" value={getPipelineStats()!.classificationMethod} />
    {/if}

    {#if getMeshFileName()}
      <PropRow label="File" value={getMeshFileName()} />
      {#if getMeshInfo()}
        <PropRow label="Vertices" value={fmtInt(getMeshInfo()!.vertices)} />
        <PropRow label="Triangles" value={fmtInt(getMeshInfo()!.triangles)} />
      {/if}
    {/if}
  </Section>

</div>

<style>
  .panel { height: 100%; overflow-y: auto; padding: 6px 8px; }

  .stage-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 0 0; min-height: 18px;
  }
  .stage-name { font-size: 11px; font-weight: 500; color: var(--text-lo); min-width: 55px; flex-shrink: 0; }
  .stage-method { font-family: var(--font-mono); font-size: 10px; color: var(--interactive); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stage-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-subtle); flex-shrink: 0; }
  .stage-output { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); padding: 0 0 3px 61px; border-bottom: 1px solid var(--stroke-lo); }
</style>
