/**
 * The theme, applied before the first paint.
 *
 * The page used to render light and the provider (`lib/contexts/theme-context.tsx`) switched it
 * once the app had loaded, so a dark-mode user saw a light flash on every launch, and the
 * installed app's status bar and first frame disagreed with the page. This runs from `<head>`,
 * before anything is drawn, and sets the same attributes the provider sets.
 *
 * Dark is the default. A choice stored on this device wins: `normal` / `light` stay light,
 * `system` follows the phone, and anything else (including no choice at all, and the old
 * `dark-oled`) is dark. The names match `normalizeMode` in the provider, which is the other half
 * of this: a change to one has to be a change to both (`lib/theme/boot-script.test.tsx` runs this
 * very string against the provider's rules).
 *
 * It also owns the `theme-color` tag: it writes it, so the document has exactly one. Rendering the
 * tag from React (or Next's `viewport.themeColor`) does not work, because the script has changed its
 * `content` by the time React hydrates, and React then inserts a second, dark, copy beside it.
 *
 * It is a string, not a function, because it is inlined into the document. It carries the page's
 * CSP nonce and does nothing that needs more than `script-src 'nonce-…'`.
 */
export const DARK_THEME_COLOR = "#0b110d";
export const LIGHT_THEME_COLOR = "#f6f0e4";

export const THEME_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement,m=null;
try{m=localStorage.getItem("situs-mode")||localStorage.getItem("proman-theme")}catch(e){}
var mode="dark";
if(m==="normal"||m==="light"){mode="normal"}
else if(m==="system"){mode=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"normal"}
var dark=mode==="dark";
d.setAttribute("data-mode",mode);
d.setAttribute("data-theme",dark?"dark":"light");
d.classList.remove("light","dark","dark-oled");
d.classList.add(dark?"dark":"light");
d.style.colorScheme=dark?"dark":"light";
var paint=function(){var c=dark?"${DARK_THEME_COLOR}":"${LIGHT_THEME_COLOR}";
var t=document.querySelectorAll('meta[name="theme-color"]');
if(!t.length&&document.head){var n=document.createElement("meta");n.name="theme-color";document.head.appendChild(n);t=[n]}
for(var i=0;i<t.length;i++){t[i].setAttribute("content",c);t[i].removeAttribute("media")}};
paint();document.addEventListener("DOMContentLoaded",paint);
}catch(e){}})();`;
