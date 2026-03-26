<script lang="ts">
  import { Section, CheckboxRow, ToggleGroup } from '@gestalt/phi';
  import {
    getShowBeams, setShowBeams,
    getShowSkin, setShowSkin,
    getShowDomainMesh, setShowDomainMesh,
    getShowGridBounds, setShowGridBounds,
    getShowAxes, setShowAxes,
    getDomainDisplayMode, setDomainDisplayMode,
    getDomainEnabled,
    getPipelineStats,
  } from '$lib/stores/lattice.svelte';
</script>

<div class="panel">

  <Section sectionId="outline-lattice" title="Lattice">
    <CheckboxRow label="Beams" checked={getShowBeams()} onchange={setShowBeams} />
    <CheckboxRow label="Skin" checked={getShowSkin()} onchange={setShowSkin} />
  </Section>

  {#if getDomainEnabled()}
    <Section sectionId="outline-domain" title="Domain">
      <CheckboxRow label="Mesh" checked={getShowDomainMesh()} onchange={setShowDomainMesh} />
      {#if getShowDomainMesh()}
        <ToggleGroup
          label="Display"
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
  {/if}

  <Section sectionId="outline-helpers" title="Helpers">
    <CheckboxRow label="Grid Bounds" checked={getShowGridBounds()} onchange={setShowGridBounds} />
    <CheckboxRow label="Axes" checked={getShowAxes()} onchange={setShowAxes} />
  </Section>

</div>

<style>
  .panel {
    height: 100%;
    overflow-y: auto;
    padding: 6px 8px;
  }
</style>
