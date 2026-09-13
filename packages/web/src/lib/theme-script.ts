/**
 * Runs before first paint so a pinned or system dark theme never flashes light, and re-applies on
 * OS theme changes so Sistema follows the system on every page. It mirrors `resolveTheme` from
 * @receivy/common (an inline script cannot import) and lib/theme.ts keeps it in sync afterwards.
 */
export const THEME_SCRIPT = `(function(){try{function apply(){try{var p=localStorage.getItem("receivy-theme");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";}catch(e){}}apply();window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",apply);}catch(e){}})();`;
