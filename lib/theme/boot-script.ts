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
 * It also keeps the document at exactly one `theme-color` tag. `app/layout.tsx` renders it for a
 * device with an explicit choice (the cookie), carrying the value this script would write, so React
 * finds nothing to change; for any other device the script writes it. A tag whose `content` the
 * script changed before React hydrates, or Next's `viewport.themeColor`, gets a second, dark, copy
 * inserted beside it. It also copies a choice stored before the cookie existed into the cookie, so
 * the server draws the right theme from the next request on.
 *
 * It is a string, not a function, because it is inlined into the document. It carries the page's
 * CSP nonce and does nothing that needs more than `script-src 'nonce-…'`.
 */
export const DARK_THEME_COLOR = "#0b110d";
export const LIGHT_THEME_COLOR = "#f6f0e4";

export const THEME_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement;
var norm=function(v){return v==="normal"||v==="light"?"normal":v==="dark"||v==="dark-oled"?"dark":v==="system"?"system":null};
var choice=null,stored=null,cookie=null;
try{stored=norm(localStorage.getItem("situs-mode"))||norm(localStorage.getItem("proman-theme"))}catch(e){}
try{var k=document.cookie.match(/(?:^|;\\s*)situs-mode=([^;]+)/);cookie=k?norm(k[1]):null}catch(e){}
choice=stored||cookie;
if(stored&&stored!==cookie){try{document.cookie="situs-mode="+stored+"; Path=/; Max-Age=31536000; SameSite=Lax"}catch(e){}}
var mode="dark";
if(choice==="normal"){mode="normal"}
else if(choice==="system"){mode=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"normal"}
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
