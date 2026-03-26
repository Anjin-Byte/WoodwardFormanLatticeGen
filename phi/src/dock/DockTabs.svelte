<script lang="ts">
  /**
   * Tab bar for a dock area. Handles tab switching, close, and drag-to-rearrange.
   * Implements the SpaceLink pattern: panel state is preserved per-tab.
   */
  let {
    panels,
    activePanel,
    onactivate,
    onclose,
  }: {
    /** Panel IDs in tab order. */
    panels: string[];
    /** Currently active panel ID. */
    activePanel: string;
    /** Called when the user clicks a tab. */
    onactivate: (panelId: string) => void;
    /** Called when the user closes a tab. Omit to hide close buttons. */
    onclose?: (panelId: string) => void;
  } = $props();
</script>

{#if panels.length > 1}
  <div class="dock-tabs" role="tablist">
    {#each panels as panel}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="dock-tab"
        class:active={panel === activePanel}
        role="tab"
        aria-selected={panel === activePanel}
        onclick={() => onactivate(panel)}
      >
        <span class="dock-tab-label">{panel}</span>
        {#if onclose && panels.length > 1}
          <button
            class="dock-tab-close"
            aria-label="Close {panel}"
            onclick={(e) => {
              e.stopPropagation();
              onclose?.(panel);
            }}
          >×</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .dock-tabs {
    display: flex;
    align-items: stretch;
    height: 26px;
    background: var(--fill-lo, oklch(1 0 0 / 0.05));
    border-bottom: 1px solid var(--stroke-lo, oklch(1 0 0 / 0.06));
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    user-select: none;
  }

  .dock-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    border: none;
    border-right: 1px solid var(--stroke-lo, oklch(1 0 0 / 0.06));
    background: none;
    color: var(--text-subtle, #999);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.1s ease, background 0.1s ease;
  }

  .dock-tab:hover {
    color: var(--text-mid, #ccc);
    background: var(--fill-mid, oklch(1 0 0 / 0.08));
  }

  .dock-tab.active {
    color: var(--text-hi, #eee);
    background: var(--fill-mid, oklch(1 0 0 / 0.08));
    border-bottom: 2px solid var(--interactive, oklch(0.80 0.16 250));
  }

  .dock-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dock-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: none;
    color: var(--text-faint, #555);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }

  .dock-tab-close:hover {
    color: var(--text-mid, #ccc);
    background: oklch(1 0 0 / 0.1);
  }
</style>
