<script lang="ts">
  import type { Snippet } from "svelte";
  import DockTabs from "./DockTabs.svelte";

  let {
    groupId,
    panels,
    activePanel,
    panel,
    onactivate,
    onclose,
  }: {
    groupId: string;
    panels: string[];
    activePanel: string;
    /** Snippet that renders panel content for a given panel ID. */
    panel: Snippet<[string]>;
    onactivate: (groupId: string, panelId: string) => void;
    onclose?: (groupId: string, panelId: string) => void;
  } = $props();
</script>

<div class="dock-group" data-group-id={groupId}>
  <DockTabs
    {panels}
    {activePanel}
    onactivate={(panelId) => onactivate(groupId, panelId)}
    onclose={onclose ? (panelId) => onclose?.(groupId, panelId) : undefined}
  />
  <div class="dock-group-content">
    {#key activePanel}
      {@render panel(activePanel)}
    {/key}
  </div>
</div>

<style>
  .dock-group {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface-3, oklch(0.18 0.015 250));
    border: 1px solid var(--stroke-lo, oklch(1 0 0 / 0.06));
    box-sizing: border-box;
  }

  .dock-group-content {
    flex: 1;
    overflow: auto;
    min-width: 0;
    min-height: 0;
  }
</style>
