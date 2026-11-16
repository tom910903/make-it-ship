// UI copy that reads as machine-written, in any text file (HTML, JSX, Swift, Kotlin, string resources, Markdown).
// The word and phrase lists are taste-skill's copy-lint rules (MIT, github.com/Leonxlnx/taste-skill), with its literal uses
// kept (seamless knit, bespoke tailoring, a powerful 2,000 W motor); its page-kind rules and scoring are left out.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export const SLOP = ['delve', 'delves', 'tapestry', 'testament to', 'realm', 'embark', 'beacon', 'multifaceted', 'paradigm', 'myriad', 'plethora', 'meticulous', 'meticulously', 'intricate', 'interplay', 'garner',
  'elevate', 'elevates', 'elevated', 'elevating', 'unlock', 'unlocks', 'unleash', 'unleashes', 'empower', 'empowers', 'empowering', 'harness', 'supercharge', 'supercharged', 'turbocharge', 'seamless', 'seamlessly', 'effortless', 'effortlessly',
  'cutting-edge', 'revolutionary', 'revolutionize', 'revolutionise', 'transformative', 'holistic', 'next-level', 'world-class', 'best-in-class', 'game-changer', 'game changer', 'game-changing', 'state-of-the-art', 'bespoke', 'synergy', 'leverage',
  'reimagine', 'reimagined', 'reimagining', 'next-generation', 'next-gen', 'powerful', 'robust', 'nestled', 'boasts', 'unparalleled', 'unrivaled', 'unrivalled'];
const SPEC = String.raw`\d[\d,.]*\s?(w|kw|hp|ps|v|nm|mah|wh|kwh|lumens?|lm|watts?|volts?|pa|bar|cc|l|litres?|liters?|kg|rpm)\b`;
const LITERAL = {
  harness: /^(?!(es|ed|ing)?\s+(the|your|our|its|their|this|that|every|all|ai|data|power)\b)/i,
  unlock: /^s?\s+(the |your |a )?(door|doors|bike|bikes|car|phone|scooter|scooters|locker|lockers|gate|box|room)\b/i,
  unlocks: /^\s+(the |your |a )?(door|doors|bike|car|phone|scooter|locker|gate|box|room)\b/i,
  elevated: /^\s+(train|track|tracks|walkway|platform|terrace|deck|heart rate|heart-rate|position|ground|site|plot|bed|beds|garden|view|views|railway|line)\b/i,
  seamless: /^\s+(knit|knitted|knitting|garments?|socks?|tights|leggings|bras?|tubes?|pipes?|steel|gutters?|flooring|floors?|stockings|underwear)\b/i,
  bespoke: /^\s+(tailoring|tailor|tailors|suits?|shirts?|shoes|boots|jackets?|trousers|joinery|kitchens?|furniture|cabinetry|wardrobes?)\b/i,
  leverage: (a, b) => /^\s+(of\s+\d|up to|ratios?|limits?|\d)/i.test(a) || /^[^.]{0,24}\b\d+:\d+\b/.test(a) || /\b(with|max(imum)?|margin|financial|high|low|no)\s+$/i.test(b),
  tapestry: (a, b) => /^\s+(weaving|weavers?|workshops?|class(es)?|courses?|looms?|museum|studio|restoration|conservation|kits?|wool|yarn|frames?)\b/i.test(a) || /\b(woven|wool|silk|hand-woven|medieval|antique)\s+$/i.test(b),
  intricate: /^\s+(lace|beadwork|embroidery|carvings?|inlays?|marquetry|filigree|knotwork|cutwork|quilting|stitch(ing|es)?|engravings?|joints?|dovetails?|smocking|plasterwork|ironwork|woodwork|tracery)\b/i,
  powerful: new RegExp(String.raw`^\s+(and\s+)?${SPEC}`, 'i'),
  robust: /^\s+(steel|stainless|aluminium|aluminum|alloy|oak|ash|beech|timber|cast[- ]iron|iron|carbon|frames?|chassis|casing|housing|hinges?|axles?|welds?|tyres?|tires?|zips?|stitching|canvas|leather)\b/i,
};
const literal = (w, after, before) => { const l = LITERAL[w.toLowerCase()]; return !!l && (typeof l === 'function' ? l(after, before) : l.test(after)); };
export const STOCK = [/in today'?s (fast-paced|digital|modern|ever-changing|busy)/i, /unlock the (power|potential)/i, /harness the power/i, /the future of [a-z]+ is (here|now)/i, /say goodbye to/i,
  /whether you'?re an? /i, /look no further/i, /join (thousands|millions|hundreds) of/i, /trusted by (teams|businesses|companies|brands|people) (worldwide|everywhere|around the world)/i, /imagine a world/i,
  /ready to (transform|take your|elevate|level up)/i, /ever-evolving/i, /one-stop shop/i, /take (it|your [a-z]+|things) to the next level/i,
  /\b(it'?s|this is|we'?re|we are) not just (a|an|another)\b/i, /\bnot only\b[^.!?]{1,60}\bbut also\b/i, /\bhere'?s the thing\b/i, /\blet that sink in\b/i, /\blet'?s dive in\b/i,
  /\bit'?s (important|worth) (to note|noting)\b/i, /\b(in|with) just a few clicks\b/i, /\bwe'?ve got you covered\b/i, /\bthe possibilities are endless\b/i, /\bat your fingertips\b/i, /\b[a-z]+ made (simple|easy)\b/i];
export const RESIDUE = [/lorem ipsum/i, /\[(your |company |brand |business )?(company|brand|business|product) name\]/i, /\bcertainly!/i, /\bi hope this helps\b/i, /\bas an ai\b/i, /\[insert\b/i, /\bgreat question!/i];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = new RegExp(`(?<![\\w-])(${[...SLOP].sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\w-])`, 'gi');

/** Visible text of an HTML file, line by line (tags, scripts and styles blanked, line numbers kept). */
const htmlText = (s) => s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' ')).replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, ' '));

/** Findings in one text: [{line, kind: residue|stock|slop, match, text}]. */
export function lintText(text, { html = false } = {}) {
  const out = [];
  (html ? htmlText(text) : text).split('\n').forEach((l, i) => {
    const add = (kind, match) => out.push({ line: i + 1, kind, match, text: l.trim().slice(0, 160) });
    for (const re of RESIDUE) { const m = l.match(re); if (m) add('residue', m[0]); }
    for (const re of STOCK) { const m = l.match(re); if (m) add('stock', m[0]); }
    for (const m of l.matchAll(WORD)) if (!literal(m[1], l.slice(m.index + m[0].length), l.slice(0, m.index))) add('slop', m[0]);
  });
  return out;
}

/** mis design copy-lint <file…>: findings per file; the caller exits 1 when there are any. */
export function lintFiles(files) {
  return files.map((f) => ({ file: f, findings: lintText(readFileSync(f, 'utf8'), { html: /^\.(html?|vue|svelte)$/i.test(extname(f)) }) }));
}
