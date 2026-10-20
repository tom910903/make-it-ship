// mis commands of the always-on layer (M6): style level. Run-independent; state lives in home.mjs.
import { currentStyle, setStyle, normalizeStyle } from './style.mjs';
import { globalConfig, setGlobalConfig } from './home.mjs';

function style([a, b]) {
  if (a === 'default') {
    const lvl = normalizeStyle(b);
    if (!lvl) throw new Error(`usage: mis style default <off|lite|full|ultra>`);
    setGlobalConfig({ style: { ...globalConfig().style, default: lvl } });
    return { default: lvl };
  }
  if (a !== undefined) return { level: setStyle(a) };
  return { level: currentStyle(), default: globalConfig().style.default };
}

export const alwaysCommands = { style };
