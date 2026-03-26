<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<div class="rounded-lg border border-white/10 bg-white/5 p-4">
  {#if title}
    <h3 class="mb-2 text-sm font-medium text-white/70">{title}</h3>
  {/if}
  {@render children()}
</div>
