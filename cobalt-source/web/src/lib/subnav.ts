import { browser } from "$app/environment";

const defaultNavPage = (page: "settings") => {
    if (browser && window.innerWidth <= 750) {
        return `/${page}`;
    }

    return "/settings/appearance";
}

export { defaultNavPage };
