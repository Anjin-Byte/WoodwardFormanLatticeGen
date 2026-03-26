<script lang="ts" module>
  /** Panel group state — stored per leaf in the Gridview. */
  export interface DockPanelGroup {
    id: string;
    panels: string[];
    activePanel: string;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { Gridview, LeafNode, BranchNode } from "./Gridview";
  import { type Orientation } from "./Splitview";
  import DockGroup from "./DockGroup.svelte";

  let {
    gridview,
    panel,
    groups = $bindable(),
    onchange,
  }: {
    /** The Gridview tree. Created externally, passed in. */
    gridview: Gridview;
    /** Snippet that renders panel content for a given panel ID. */
    panel: Snippet<[string]>;
    /** Map of group ID → panel group state. Bindable so parent can persist. */
    groups: Record<string, DockPanelGroup>;
    /** Called after any mutation (resize, tab switch, split). */
    onchange?: () => void;
  } = $props();

  // ─── Container + ResizeObserver ──────────────────────────────────────

  let containerEl = $state<HTMLElement | null>(null);
  let containerW = $state(0);
  let containerH = $state(0);
  let layoutVersion = $state(0);

  onMount(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        containerW = width;
        containerH = height;
        gridview.layout(width, height);
        layoutVersion++;
      }
    });
    ro.observe(containerEl);
    // Initial layout
    const rect = containerEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      containerW = rect.width;
      containerH = rect.height;
      gridview.layout(rect.width, rect.height);
      layoutVersion++;
    }
    return () => ro.disconnect();
  });

  // Reserved for future split/merge operations that need a full relayout.
  // function relayout() {
  //   if (containerW > 0 && containerH > 0) {
  //     gridview.layout(containerW, containerH);
  //     layoutVersion++;
  //   }
  //   onchange?.();
  // }

  // ─── Tab activation ────────────────────────────────────────────────

  function handleActivate(groupId: string, panelId: string) {
    const group = groups[groupId];
    if (group) {
      group.activePanel = panelId;
      groups = { ...groups };
      onchange?.();
    }
  }

  function handleClose(groupId: string, panelId: string) {
    const group = groups[groupId];
    if (!group || group.panels.length <= 1) return;
    group.panels = group.panels.filter((p) => p !== panelId);
    if (group.activePanel === panelId) {
      group.activePanel = group.panels[0];
    }
    groups = { ...groups };
    onchange?.();
  }

  // ─── Sash dragging ─────────────────────────────────────────────────

  let dragging = $state(false);

  function handleSashDown(branch: BranchNode, sashIndex: number, event: PointerEvent) {
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);
    dragging = true;

    const snapshot = branch.splitview.getSizes();
    const startPos = branch.splitview.orientation === "horizontal"
      ? event.clientX
      : event.clientY;

    const onMove = (e: PointerEvent) => {
      const currentPos = branch.splitview.orientation === "horizontal"
        ? e.clientX
        : e.clientY;
      const delta = currentPos - startPos;
      branch.splitview.resize(sashIndex, delta, snapshot);
      branch.splitview.distributeEmptySpace();
      // Re-layout children with their new sizes
      const sizes = branch.splitview.getSizes();
      for (let i = 0; i < branch.children.length; i++) {
        const child = branch.children[i];
        const childSize = sizes[i];
        const orthSize = branch.splitview.orientation === "horizontal"
          ? containerH : containerW;
        child.layout(childSize, orthSize);
      }
      layoutVersion++;
    };

    const onUp = (e: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      branch.splitview.saveProportions();
      dragging = false;
      onchange?.();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  // ─── Recursive layout computation ──────────────────────────────────
  // Walk the tree and compute absolute pixel positions for every node.

  interface LayoutRect {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  interface LeafLayout {
    kind: "leaf";
    groupId: string;
    rect: LayoutRect;
  }

  interface SashLayout {
    branch: BranchNode;
    sashIndex: number;
    rect: LayoutRect;
    orientation: Orientation;
  }

  function computeLayout(
    node: BranchNode | LeafNode,
    left: number,
    top: number,
    width: number,
    height: number,
  ): { leaves: LeafLayout[]; sashes: SashLayout[] } {
    // Force dependency on layoutVersion for reactivity
    void layoutVersion;

    if (node.kind === "leaf") {
      const group = (node.view as any)?.id ?? "";
      return {
        leaves: [{ kind: "leaf", groupId: group, rect: { left, top, width, height } }],
        sashes: [],
      };
    }

    const branch = node;
    const sizes = branch.splitview.getSizes();
    const isH = branch.splitview.orientation === "horizontal";
    const leaves: LeafLayout[] = [];
    const sashes: SashLayout[] = [];
    let offset = 0;

    for (let i = 0; i < branch.children.length; i++) {
      const childSize = sizes[i] ?? 0;
      const childLeft = isH ? left + offset : left;
      const childTop = isH ? top : top + offset;
      const childWidth = isH ? childSize : width;
      const childHeight = isH ? height : childSize;

      const childResult = computeLayout(
        branch.children[i],
        childLeft, childTop, childWidth, childHeight,
      );
      leaves.push(...childResult.leaves);
      sashes.push(...childResult.sashes);

      // Sash between this child and the next
      if (i < branch.children.length - 1) {
        const sashThickness = 4;
        sashes.push({
          branch,
          sashIndex: i,
          orientation: branch.splitview.orientation,
          rect: isH
            ? { left: left + offset + childSize - sashThickness / 2, top, width: sashThickness, height }
            : { left, top: top + offset + childSize - sashThickness / 2, width, height: sashThickness },
        });
      }

      offset += childSize;
    }

    return { leaves, sashes };
  }

  const layout = $derived((() => {
    void layoutVersion;
    if (containerW === 0 || containerH === 0) return { leaves: [], sashes: [] };
    return computeLayout(gridview.root, 0, 0, containerW, containerH);
  })());
</script>

<div
  class="dock-layout"
  class:resizing={dragging}
  bind:this={containerEl}
>
  <!-- Leaf panels (absolutely positioned) -->
  {#each layout.leaves as leaf (leaf.groupId)}
    {@const group = groups[leaf.groupId]}
    {#if group}
      <div
        class="dock-leaf"
        style="left:{leaf.rect.left}px;top:{leaf.rect.top}px;width:{leaf.rect.width}px;height:{leaf.rect.height}px;"
      >
        <DockGroup
          groupId={group.id}
          panels={group.panels}
          activePanel={group.activePanel}
          {panel}
          onactivate={handleActivate}
          onclose={handleClose}
        />
      </div>
    {/if}
  {/each}

  <!-- Sash handles (absolutely positioned) -->
  {#each layout.sashes as sash, i (i)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="dock-sash"
      class:dock-sash-h={sash.orientation === "horizontal"}
      class:dock-sash-v={sash.orientation === "vertical"}
      style="left:{sash.rect.left}px;top:{sash.rect.top}px;width:{sash.rect.width}px;height:{sash.rect.height}px;"
      onpointerdown={(e) => handleSashDown(sash.branch, sash.sashIndex, e)}
    ></div>
  {/each}
</div>

<style>
  .dock-layout {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .dock-layout.resizing {
    user-select: none;
    cursor: col-resize;
  }

  .dock-leaf {
    position: absolute;
    overflow: hidden;
  }

  /* ── Sash handles ───────────────────────────────────────────────────── */
  .dock-sash {
    position: absolute;
    z-index: 10;
    background: transparent;
    transition: background 0.1s ease;
  }

  .dock-sash-h {
    cursor: ew-resize;
  }

  .dock-sash-v {
    cursor: ns-resize;
  }

  .dock-sash:hover {
    background: var(--interactive, oklch(0.80 0.16 250));
    opacity: 0.4;
  }

  .dock-sash:active {
    background: var(--interactive, oklch(0.80 0.16 250));
    opacity: 0.6;
  }
</style>
