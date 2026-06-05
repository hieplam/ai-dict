// Registers the three custom elements in the page's MAIN world so they are available
// to the isolated-world content.js. Chrome MV3 isolated worlds do not expose the page's
// CustomElementRegistry — using world:"MAIN" here (manifest content_scripts.world) fixes
// the null customElements crash without affecting chrome.* API access in content.js.
import { registerContentElements } from '@ai-dict/app';
registerContentElements();
