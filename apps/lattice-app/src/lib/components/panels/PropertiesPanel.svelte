<script lang="ts">
  import { Section, ScrubField, CheckboxRow, ToggleGroup, SelectField, ActionButton, PropRow, StatusIndicator } from '@gestalt/phi';
  import {
    getUnitCellId, setUnitCellId, getUnitCellIds,
    getCellWidth, setCellWidth, getCellWidthRange,
    getPadding, setPadding,
    getManualNx, getManualNy, getManualNz, setManualNx, setManualNy, setManualNz,
    getRStar, setRStar,
    getDomainEnabled, setDomainEnabled,
    getDomainShape, setDomainShape,
    getDomainRadius, setDomainRadius,
    getDomainSize, setDomainSize,
    getDomainSource, setDomainSource,
    getMeshFileName, getMeshInfo, setMeshFile,
    getSkinEnabled, setSkinEnabled,
    getRenderCylinderSegments, setRenderCylinderSegments,
    getExportInProgress, getExportMcDensity, setExportMcDensity,
    getExportFilletK, setExportFilletK, getAutoMcDensity, triggerExport,
    getExportProgress, getExportPhase, getExportTierUsed, getExportTierAvailable,
    getExportTierOverride, setExportTierOverride,
    getExportCylinderSegments, setExportCylinderSegments,
    getLastExportStatus, getLastExportSummary,
    commitAndGenerate, isParamsDirty,
  } from '$lib/stores/lattice.svelte';

  interface SampleModel { id: string; label: string; file: string }
  let sampleModels = $state<SampleModel[]>([]);
  let sampleLoading = $state(false);
  let fileInput: HTMLInputElement;

  (async () => {
    try {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}models/index.json`);
      sampleModels = await res.json();
    } catch { /* no samples available */ }
  })();

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    setMeshFile(buffer, file.name);
  }

  async function loadSampleModel(id: string) {
    const model = sampleModels.find(m => m.id === id);
    if (!model) return;
    sampleLoading = true;
    try {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}${model.file}`);
      const buffer = await res.arrayBuffer();
      const fileName = model.file.split('/').pop() ?? model.file;
      setMeshFile(buffer, fileName);
    } catch (e) {
      console.error('[sample] Failed to load model:', e);
    } finally {
      sampleLoading = false;
    }
  }

  const exportPipelineOptions = $derived([
    { value: 'auto', label: getExportTierAvailable() === 'gpu' ? 'Auto (GPU)' : 'Auto (JS)' },
    { value: 'direct', label: 'Direct' },
    { value: 'csg', label: 'CSG' },
    { value: 'gpu', label: 'SDF - GPU' },
    { value: 'js', label: 'SDF - JS' },
  ]);

  const isSdfPipeline = $derived(
    getExportTierOverride() === 'auto' || getExportTierOverride() === 'gpu' || getExportTierOverride() === 'js'
  );
  const isMeshPipeline = $derived(
    getExportTierOverride() === 'direct' || getExportTierOverride() === 'csg'
  );
</script>

<div class="panel">

  <!-- Generate button — always visible at top -->
  <div class="generate-row">
    <ActionButton
      onclick={commitAndGenerate}
      disabled={getExportInProgress()}
      fullWidth
    >
      {#if !isParamsDirty()}
        Generate Lattice
      {:else}
        <StatusIndicator status="ok" pulse={true} />
        Generate Lattice
      {/if}
    </ActionButton>
  </div>

  <Section sectionId="prop-lattice" title="Lattice">
    <SelectField
      options={getUnitCellIds().map(id => ({ value: id, label: id }))}
      value={getUnitCellId()}
      onValueChange={setUnitCellId}
    />
    <ScrubField label="r*" value={getRStar()} min={0.01} max={0.45} step={0.005} decimals={3} onValueChange={setRStar} />
    <ScrubField label="Segments" value={getRenderCylinderSegments()} min={3} max={32} step={1} decimals={0} onValueChange={setRenderCylinderSegments} />
  </Section>

  <Section sectionId="prop-grid" title="Grid">
    {@const lcRange = getCellWidthRange()}
    <ScrubField label="l_c (mm)" value={getCellWidth()} min={lcRange.min} max={lcRange.max} step={lcRange.step} decimals={3} onValueChange={setCellWidth} />
    {#if getDomainEnabled()}
      <ScrubField label="Padding" value={getPadding()} min={0} max={5} step={1} decimals={0} onValueChange={setPadding} />
    {:else}
      <ScrubField label="Nx" value={getManualNx()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNx} />
      <ScrubField label="Ny" value={getManualNy()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNy} />
      <ScrubField label="Nz" value={getManualNz()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNz} />
    {/if}
  </Section>

  <Section sectionId="prop-domain" title="Domain">
    <CheckboxRow label="Enabled" checked={getDomainEnabled()} onchange={setDomainEnabled} />

    {#if getDomainEnabled()}
      <ToggleGroup
        label="Source"
        options={[{ value: 'generated', label: 'Generated' }, { value: 'file', label: 'Mesh File' }]}
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
        <ScrubField label="Radius (mm)" value={getDomainRadius()} min={0.1} max={20} step={0.1} decimals={2} onValueChange={setDomainRadius} />
      {:else}
        <input bind:this={fileInput} type="file" accept=".stl,.obj" onchange={handleFileUpload} class="hidden-input" />
        <ActionButton onclick={() => fileInput?.click()} fullWidth>
          {getMeshFileName() || 'Browse...'}
        </ActionButton>
        {#if sampleModels.length > 0}
          <SelectField
            options={[
              { value: '', label: sampleLoading ? 'Loading...' : 'Load sample...' },
              ...sampleModels.map(m => ({ value: m.id, label: m.label })),
            ]}
            value=""
            onValueChange={(v) => { if (v) loadSampleModel(v); }}
          />
        {/if}
        {#if getMeshInfo()}
          {@const info = getMeshInfo()!}
          <PropRow label="Mesh" value={`${info.vertices.toLocaleString()}v / ${info.triangles.toLocaleString()}t`} />
          <ScrubField label="Size (mm)" value={getDomainSize()} min={1} max={500} step={1} decimals={1} onValueChange={setDomainSize} />
        {/if}
      {/if}

      <div class="separator"></div>
      <CheckboxRow label="Skin" checked={getSkinEnabled()} onchange={setSkinEnabled} />
    {/if}
  </Section>

  <Section sectionId="prop-export" title="Export">
    <SelectField
      options={exportPipelineOptions}
      value={getExportTierOverride()}
      onValueChange={(v) => setExportTierOverride(v as 'auto' | 'gpu' | 'js' | 'direct' | 'csg')}
    />

    {#if isSdfPipeline}
      <ScrubField
        label="MC Density"
        value={getExportMcDensity() ?? getAutoMcDensity()}
        min={4} max={60} step={1} decimals={0}
        onValueChange={setExportMcDensity}
      />
      <ScrubField
        label="Fillet"
        value={getExportFilletK() ?? 0.5}
        min={0} max={2} step={0.05} decimals={2}
        onValueChange={setExportFilletK}
      />
    {/if}

    {#if isMeshPipeline}
      <ScrubField
        label="Segments"
        value={getExportCylinderSegments()}
        min={6} max={64} step={1} decimals={0}
        onValueChange={setExportCylinderSegments}
      />
    {/if}

    {#if getExportInProgress()}
      {@const phase = getExportPhase()}
      {@const pct = getExportProgress()}
      {@const phaseLabels = {
        accel: 'Building accel', sdf: 'SDF evaluation', mc: 'Marching cubes',
        stl: 'Writing STL', gpu: 'GPU compute', tessellate: 'Tessellating',
        init: 'Loading CSG engine', union: 'Boolean union',
      } as Record<string, string>}
      {@const indeterminate = (phase === 'gpu' || phase === 'union') && pct < 1}
      <div class="export-progress">
        <div class="progress-header">
          <span class="progress-label">{phaseLabels[phase] || phase || 'Starting...'}</span>
          <span class="progress-pct">{indeterminate ? '' : `${Math.round(pct * 100)}%`}</span>
        </div>
        <div class="progress-track">
          {#if indeterminate}
            <div class="progress-fill indeterminate"></div>
          {:else}
            <div class="progress-fill" style="width: {pct * 100}%"></div>
          {/if}
        </div>
      </div>
    {/if}

    <ActionButton
      onclick={triggerExport}
      disabled={getExportInProgress() || isParamsDirty()}
      fullWidth
    >
      {#if getExportInProgress()}
        <StatusIndicator status="ok" pulse={true} />
        Exporting...
      {:else}
        Export STL
      {/if}
    </ActionButton>

    {#if !getExportInProgress() && getLastExportStatus()}
      <div class="export-result">
        <StatusIndicator
          status={getLastExportStatus() === 'ok' ? 'ok' : 'error'}
          pulse={false}
          label={getExportTierUsed() === 'gpu' ? 'GPU' : getExportTierUsed() === 'csg' ? 'CSG' : getExportTierUsed() === 'direct' ? 'Direct' : 'JS'}
        />
        <span class="export-summary">{getLastExportSummary()}</span>
      </div>
    {/if}
  </Section>

</div>

<style>
  .panel {
    height: 100%;
    overflow-y: auto;
    padding: 6px 8px;
  }

  .generate-row {
    padding: 4px 0 8px;
  }

  .generate-row :global(button) {
    font-weight: 600;
  }

  .hidden-input {
    display: none;
  }

  .separator {
    height: 1px;
    background: var(--stroke-lo, oklch(1 0 0 / 0.06));
    margin: 6px 0;
  }

  .export-progress {
    padding: 4px 0;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .progress-label {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-subtle, #888);
    text-transform: uppercase;
  }

  .progress-pct {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-mid, #ccc);
  }

  .progress-track {
    height: 4px;
    background: var(--fill-lo, oklch(1 0 0 / 0.05));
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: oklch(0.80 0.16 250 / 55%);
    border-radius: 2px;
    transition: width 0.15s ease;
  }

  .progress-fill.indeterminate {
    width: 30%;
    animation: indeterminate 1.2s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { margin-left: 0%; }
    50% { margin-left: 70%; }
    100% { margin-left: 0%; }
  }

  .export-result {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }

  .export-summary {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-faint, #666);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
