<script lang="ts">
  import { Section, ScrubField, CheckboxRow, ToggleGroup } from '@gestalt/phi';
  import { TreeList } from '@gestalt/phi';
  import type { TreeListDomain, TreeListItem, TreeListCellData } from '@gestalt/phi';
  import {
    getShowBeams, setShowBeams,
    getShowSkin, setShowSkin,
    getShowDomainMesh, setShowDomainMesh,
    getShowGridBounds, setShowGridBounds,
    getShowAxes, setShowAxes,
    getDomainDisplayMode, setDomainDisplayMode,
    getDomainEnabled, getSkinEnabled,
    getRenderCylinderSegments, setRenderCylinderSegments,
    getRenderFlatShading, setRenderFlatShading,
  } from '$lib/stores/lattice.svelte';

  // ─── Visibility state as a reactive object for TreeList ──────────────────

  interface SceneData {
    beams: boolean;
    skin: boolean;
    domain: boolean;
    gridBounds: boolean;
    axes: boolean;
    domainEnabled: boolean;
    skinEnabled: boolean;
  }

  const sceneData: SceneData = $derived({
    beams: getShowBeams(),
    skin: getShowSkin(),
    domain: getShowDomainMesh(),
    gridBounds: getShowGridBounds(),
    axes: getShowAxes(),
    domainEnabled: getDomainEnabled(),
    skinEnabled: getSkinEnabled(),
  });

  const visToggle = (v: boolean): TreeListCellData => ({
    type: 'toggle', value: v, icon: v ? 'eye' : 'eye-off', propagatable: false,
  });

  const sceneDomain: TreeListDomain<SceneData> = {
    domainId: 'scene-layers',
    columns: [{ id: 'vis', width: 28, label: 'Visibility' }],
    rows(data: SceneData): TreeListItem[] {
      const items: TreeListItem[] = [
        { kind: 'group', id: 'grp-lattice', label: 'Lattice' },
        { kind: 'row', id: 'beams', groupId: 'grp-lattice', label: 'Beams', icon: 'cylinder', cells: [visToggle(data.beams)] },
      ];
      if (data.skinEnabled) {
        items.push({ kind: 'row', id: 'skin', groupId: 'grp-lattice', label: 'Skin', icon: 'shell', cells: [visToggle(data.skin)], faded: !data.skin });
      }
      if (data.domainEnabled) {
        items.push(
          { kind: 'group', id: 'grp-domain', label: 'Domain' },
          { kind: 'row', id: 'domain-mesh', groupId: 'grp-domain', label: 'Mesh', icon: 'box', cells: [visToggle(data.domain)], faded: !data.domain },
        );
      }
      items.push(
        { kind: 'group', id: 'grp-helpers', label: 'Helpers' },
        { kind: 'row', id: 'grid-bounds', groupId: 'grp-helpers', label: 'Grid Bounds', icon: 'grid-3x3', cells: [visToggle(data.gridBounds)], faded: !data.gridBounds },
        { kind: 'row', id: 'axes', groupId: 'grp-helpers', label: 'Axes', icon: 'move-3d', cells: [visToggle(data.axes)], faded: !data.axes },
      );
      return items;
    },
    onToggle(rowId: string, _columnId: string, value: boolean) {
      const setters: Record<string, (v: boolean) => void> = {
        'beams': setShowBeams,
        'skin': setShowSkin,
        'domain-mesh': setShowDomainMesh,
        'grid-bounds': setShowGridBounds,
        'axes': setShowAxes,
      };
      setters[rowId]?.(value);
    },
  };
</script>

<div class="panel">
  <div class="tree-container">
    <TreeList domain={sceneDomain} data={sceneData} />
  </div>

  {#if getDomainEnabled() && getShowDomainMesh()}
    <Section sectionId="scene-domain-display" title="Domain Display">
      <ToggleGroup
        label="Mode"
        options={[
          { value: 'transparent', label: 'Trans' },
          { value: 'wireframe', label: 'Wire' },
          { value: 'solid', label: 'Solid' },
        ]}
        value={getDomainDisplayMode()}
        onValueChange={(v) => setDomainDisplayMode(v as 'solid' | 'wireframe' | 'transparent')}
      />
    </Section>
  {/if}

  <Section sectionId="scene-quality" title="Quality">
    <ScrubField label="Segments" value={getRenderCylinderSegments()} min={3} max={32} step={1} decimals={0} onValueChange={setRenderCylinderSegments} />
    <CheckboxRow label="Flat Shading" checked={getRenderFlatShading()} onchange={setRenderFlatShading} />
  </Section>
</div>

<style>
  .panel {
    height: 100%;
    overflow-y: auto;
    padding: 6px 8px;
  }

  .tree-container {
    height: 200px;
    min-height: 120px;
  }
</style>
