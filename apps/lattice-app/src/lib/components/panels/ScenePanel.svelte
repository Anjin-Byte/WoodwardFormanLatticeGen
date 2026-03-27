<script lang="ts">
  import { Section, ScrubField, CheckboxRow, ToggleGroup } from '@gestalt/phi';
  import { TreeList } from '@gestalt/phi';
  import type { TreeListDomain, TreeListItem, TreeListColumnDef, CellIcon } from '@gestalt/phi';
  import { Eye, EyeOff } from 'lucide-svelte';

  const eyeOn = Eye as unknown as CellIcon;
  const eyeOff = EyeOff as unknown as CellIcon;
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

  // ─── Visibility state as reactive data for TreeList ──────────────────────

  interface LayerState {
    beams: boolean;
    skin: boolean;
    domain: boolean;
    gridBounds: boolean;
    axes: boolean;
    domainEnabled: boolean;
    skinEnabled: boolean;
  }

  let layerData: LayerState = $derived({
    beams: getShowBeams(),
    skin: getShowSkin(),
    domain: getShowDomainMesh(),
    gridBounds: getShowGridBounds(),
    axes: getShowAxes(),
    domainEnabled: getDomainEnabled(),
    skinEnabled: getSkinEnabled(),
  });

  const sceneColumns: TreeListColumnDef[] = [
    { id: 'visible', width: 22, label: 'Visible' },
  ];

  const sceneDomain: TreeListDomain<LayerState> = {
    domainId: 'lattice-scene',
    columns: sceneColumns,
    rows(data: LayerState): TreeListItem[] {
      const items: TreeListItem[] = [
        { kind: 'group', id: 'grp-lattice', label: 'Lattice' },
        {
          kind: 'row', id: 'beams', groupId: 'grp-lattice', label: 'Beams',
          faded: !data.beams,
          cells: [{ type: 'toggle', value: data.beams, icon: data.beams ? eyeOn : eyeOff }],
        },
      ];
      if (data.skinEnabled) {
        items.push({
          kind: 'row', id: 'skin', groupId: 'grp-lattice', label: 'Skin',
          faded: !data.skin,
          cells: [{ type: 'toggle', value: data.skin, icon: data.skin ? eyeOn : eyeOff }],
        });
      }
      if (data.domainEnabled) {
        items.push(
          { kind: 'group', id: 'grp-domain', label: 'Domain' },
          {
            kind: 'row', id: 'domain-mesh', groupId: 'grp-domain', label: 'Mesh',
            faded: !data.domain,
            cells: [{ type: 'toggle', value: data.domain, icon: data.domain ? eyeOn : eyeOff }],
          },
        );
      }
      items.push(
        { kind: 'group', id: 'grp-helpers', label: 'Helpers' },
        {
          kind: 'row', id: 'grid-bounds', groupId: 'grp-helpers', label: 'Grid Bounds',
          faded: !data.gridBounds,
          cells: [{ type: 'toggle', value: data.gridBounds, icon: data.gridBounds ? eyeOn : eyeOff }],
        },
        {
          kind: 'row', id: 'axes', groupId: 'grp-helpers', label: 'Axes',
          faded: !data.axes,
          cells: [{ type: 'toggle', value: data.axes, icon: data.axes ? eyeOn : eyeOff }],
        },
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
  <Section sectionId="scene-layers" title="Layers" card>
    <div class="treelist-frame">
      <TreeList domain={sceneDomain} data={layerData} />
    </div>
  </Section>

  {#if getDomainEnabled() && getShowDomainMesh()}
    <Section sectionId="scene-domain-display" title="Domain Display" card>
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

  <Section sectionId="scene-quality" title="Quality" card>
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

  .treelist-frame {
    height: 220px;
    border: 1px solid var(--stroke-lo, oklch(1 0 0 / 0.06));
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 6px;
  }
</style>
