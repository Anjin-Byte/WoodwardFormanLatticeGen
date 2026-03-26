<script lang="ts">
  import { getHint } from '$lib/stores/status';
  import { StatusIndicator } from '@gestalt/phi';
  import { getPipelineStats, getExportTierAvailable } from '$lib/stores/lattice.svelte';

  const tierLabel: Record<string, string> = {
    gpu: 'GPU',
    'cpu-wasm': 'CPU',
    js: 'JS',
  };
</script>

<div class="status-bar">
  <span class="hint">{getHint() || ''}</span>
  <div class="right">
    {#if getPipelineStats()}
      {@const s = getPipelineStats()!}
      <StatusIndicator
        status={s.voxelizerTier === 'gpu' ? 'ok' : s.voxelizerTier === 'cpu-wasm' ? 'ok' : 'idle'}
        label={`Vox ${tierLabel[s.voxelizerTier] ?? 'JS'}`}
      />
      <StatusIndicator
        status={getExportTierAvailable() === 'gpu' ? 'ok' : 'idle'}
        label={`SDF ${getExportTierAvailable() === 'gpu' ? 'GPU' : 'JS'}`}
      />
      <span class="timing">{s.pipelineTimeMs.toFixed(1)} ms</span>
    {/if}
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    padding: 0 10px;
    background: var(--surface-2, oklch(0.15 0.01 250));
    border-top: 1px solid var(--stroke-lo, oklch(1 0 0 / 0.06));
    flex-shrink: 0;
  }

  .hint {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--text-subtle, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .timing {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-faint, #666);
  }
</style>
