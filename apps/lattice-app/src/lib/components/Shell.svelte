<script lang="ts">
  import { DockLayout, Gridview } from '@gestalt/phi';
  import type { DockPanelGroup, IGridView } from '@gestalt/phi';
  import Viewport from './Viewport.svelte';
  import PropertiesPanel from './panels/PropertiesPanel.svelte';
  import ScenePanel from './panels/ScenePanel.svelte';
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

  // 3-column layout: [Properties | Viewport | Scene+Stats]
  const gridview = new Gridview('horizontal');

  const propertiesView = makeView('properties', { minW: 250 });
  const viewportView = makeView('viewport', { minW: 700 });
  const rightView = makeView('right', { minW: 250 });

  gridview.addView(propertiesView, 25*10, [0]);
  gridview.addView(viewportView, 60*100, [1]);
  gridview.addView(rightView, 25*10, [2]);

  let groups: Record<string, DockPanelGroup> = $state({
    properties: { id: 'properties', panels: ['Properties'], activePanel: 'Properties' },
    viewport: { id: 'viewport', panels: ['Viewport'], activePanel: 'Viewport' },
    right: { id: 'right', panels: ['Scene', 'Statistics'], activePanel: 'Scene' },
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
  {:else if panelId === 'Scene'}
    <ScenePanel />
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
