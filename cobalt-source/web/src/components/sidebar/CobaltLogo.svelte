<script>
    import IconCobalt from "$components/icons/Cobalt.svelte";
</script>

<div id="cisco-logo" aria-label="Cisco">
    <IconCobalt />
</div>

<style>
    #cisco-logo {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: calc(var(--sidebar-tab-padding) * 2);

        /* accommodate space for scaling animation */
        padding-bottom: calc(var(--sidebar-tab-padding) * 2 - var(--sidebar-inner-padding));
    }

    #cisco-logo :global(path) {
        fill: var(--sidebar-highlight);
    }

    @media screen and (max-width: 535px) {
        #cisco-logo {
            display: none;
        }
    }
</style>
