<script lang="ts">
  import { Section, ScrubField, CheckboxRow, ToggleGroup, SelectField, ActionButton, PropRow, StatusIndicator } from '@gestalt/phi';
  import {
    getUnitCellId, setUnitCellId, getUnitCellIds,
    getResolution, setResolution,
    getPadding, setPadding,
    getManualNx, getManualNy, getManualNz, setManualNx, setManualNy, setManualNz,
    getManualCellSize, setManualCellSize,
    getRStar, setRStar,
    getDomainEnabled, setDomainEnabled,
    getDomainShape, setDomainShape,
    getDomainRadius, setDomainRadius,
    getDomainSource, setDomainSource,
    getMeshFileName, getMeshInfo, setMeshFile,
    getSkinEnabled, setSkinEnabled,
    getExportInProgress, getExportMcDensity, setExportMcDensity,
    getExportFilletK, setExportFilletK, getAutoMcDensity, triggerExport,
    getExportProgress, getExportPhase, getExportTierUsed, getExportTierAvailable,
    getExportTierOverride, setExportTierOverride,
    getLastExportStatus, getLastExportSummary,
  } from '$lib/stores/lattice.svelte';

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    setMeshFile(buffer, file.name);
  }
</script>

<div class="panel">

  <Section sectionId="prop-lattice" title="Lattice">
    <SelectField
      options={getUnitCellIds().map(id => ({ value: id, label: id }))}
      value={getUnitCellId()}
      onValueChange={setUnitCellId}
    />
  </Section>

  <Section sectionId="prop-grid" title="Grid">
    {#if getDomainEnabled()}
      <ScrubField label="Resolution" value={getResolution()} min={2} max={60} step={1} decimals={0} onValueChange={setResolution} />
      <ScrubField label="Padding" value={getPadding()} min={0} max={5} step={1} decimals={0} onValueChange={setPadding} />
    {:else}
      <ScrubField label="X" value={getManualNx()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNx} />
      <ScrubField label="Y" value={getManualNy()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNy} />
      <ScrubField label="Z" value={getManualNz()} min={1} max={100} step={1} decimals={0} onValueChange={setManualNz} />
      <ScrubField label="Cell Size" value={getManualCellSize()} min={0.01} max={10} step={0.05} decimals={3} onValueChange={setManualCellSize} />
    {/if}
  </Section>

  <Section sectionId="prop-strut" title="Strut">
    <ScrubField label="r*" value={getRStar()} min={0.01} max={0.45} step={0.005} decimals={3} onValueChange={setRStar} />
  </Section>

  <Section sectionId="prop-domain" title="Domain">
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
          <p class="file-name">{getMeshFileName()}</p>
        {/if}
      {/if}

      <CheckboxRow label="Skin" checked={getSkinEnabled()} onchange={setSkinEnabled} />
    {/if}
  </Section>

  <Section sectionId="prop-export" title="Export">
    <ScrubField
      label="Density"
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
    <ToggleGroup
      label="Pipeline"
      options={[
        { value: 'direct', label: 'Direct' },
        { value: 'auto', label: getExportTierAvailable() === 'gpu' ? 'Auto (GPU)' : 'Auto (JS)' },
        { value: 'gpu', label: 'GPU' },
        { value: 'js', label: 'JS' },
      ]}
      value={getExportTierOverride()}
      onValueChange={(v) => setExportTierOverride(v as 'auto' | 'gpu' | 'js' | 'direct')}
    />

    {#if getExportInProgress()}
      {@const phase = getExportPhase()}
      {@const pct = getExportProgress()}
      {@const phaseLabels = { accel: 'Building accel', sdf: 'SDF evaluation', mc: 'Marching cubes', stl: 'Writing STL', gpu: 'GPU compute', tessellate: 'Tessellating' } as Record<string, string>}
      {@const indeterminate = phase === 'gpu' && pct < 1}
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
      disabled={getExportInProgress()}
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
          label={getExportTierUsed() === 'gpu' ? 'GPU' : getExportTierUsed() === 'direct' ? 'Direct' : 'JS'}
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

  .file-row {
    padding: 4px 0;
  }

  .file-row input[type="file"] {
    font-size: 10px;
    color: var(--text-mid, #ccc);
    width: 100%;
  }

  .file-name {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-faint, #666);
    margin: 2px 0;
    word-break: break-all;
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
