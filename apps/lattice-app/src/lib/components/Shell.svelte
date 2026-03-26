<script lang="ts">
  import { DockLayout, Gridview } from '@gestalt/phi';
  import type { DockPanelGroup, IGridView } from '@gestalt/phi';
  import Viewport from './Viewport.svelte';
  import PropertiesPanel from './panels/PropertiesPanel.svelte';
  import OutlinerPanel from './panels/OutlinerPanel.svelte';
  import StatisticsPanel from './panels/StatisticsPanel.svelte';
  import StatusBar from './shell/StatusBar.svelte';

  function makeView(id: string, opts: { minW?: number; minH?: number } = {}): IGridView & { id: string } {
    return {
      id,
      minimumWidth: opts.minW ?? 100,
      maximumWidth: Number.POSITIVE_INFINITY,
      minimumHeight: opts.minH ?? 100,
      maximumHeight: Number.POSITIVE_INFINITY,
      layout() {},
    };
  }

  // 4-panel layout: [Properties | Viewport | Outliner / Statistics]
  const gridview = new Gridview('horizontal');

  const propertiesView = makeView('properties', { minW: 200 });
  const viewportView = makeView('viewport', { minW: 300 });
  const outlinerView = makeView('outliner', { minW: 180 });
  const statisticsView = makeView('statistics', { minW: 180 });

  // Left: Properties (260px)
  gridview.addView(propertiesView, 260, [0]);
  // Center: Viewport (fills remaining)
  gridview.addView(viewportView, 600, [1]);
  // Right: vertical split — Outliner (top) + Statistics (bottom)
  gridview.addView(outlinerView, 240, [2]);
  // Split the right panel vertically by adding Statistics below Outliner
  gridview.addView(statisticsView, 300, [2, 1]);

  let groups: Record<string, DockPanelGroup> = $state({
    properties: { id: 'properties', panels: ['Properties'], activePanel: 'Properties' },
    viewport: { id: 'viewport', panels: ['Viewport'], activePanel: 'Viewport' },
    outliner: { id: 'outliner', panels: ['Outliner'], activePanel: 'Outliner' },
    statistics: { id: 'statistics', panels: ['Statistics'], activePanel: 'Statistics' },
  });
</script>

<div class="app-shell">
  <div class="dock-area">
    <DockLayout {gridview} {groups} panel={panelSnippet} />
  </div>
  <StatusBar />
</div>

{#snippet panelSnippet(panelId: string)}
  {#if panelId === 'Viewport'}
    <Viewport />
  {:else if panelId === 'Properties'}
    <PropertiesPanel />
  {:else if panelId === 'Outliner'}
    <OutlinerPanel />
  {:else if panelId === 'Statistics'}
    <StatisticsPanel />
  {/if}
{/snippet}

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  .dock-area {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  :global(.dock-group-content) {
    position: relative;
  }
</style>
