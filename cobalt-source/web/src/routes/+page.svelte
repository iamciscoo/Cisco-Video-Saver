<script>
    import { t } from "$lib/i18n/translations";

    import Omnibox from "$components/save/Omnibox.svelte";
    import Meowbalt from "$components/misc/Meowbalt.svelte";
    import SupportedServices from "$components/save/SupportedServices.svelte";
</script>

<svelte:head>
    <title>{$t("general.cobalt")}</title>
    <meta property="og:title" content={$t("general.cobalt")} />
</svelte:head>

<div id="cisco-save-container" class="center-column-container">
    <SupportedServices />
    <main
        id="cisco-save"
        tabindex="-1"
        data-first-focus
    >
        <Meowbalt emotion="smile" />
        <Omnibox />
    </main>
</div>

<style>
    #cisco-save-container {
        padding: var(--padding);
        overflow: hidden;
    }

    #cisco-save {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        gap: 15px;
    }

    @media screen and (max-width: 535px) {
        #cisco-save-container {
            padding-top: calc(var(--padding) / 2);
        }
    }
</style>
