// Minimal POSIX-ish shell tokenizer for the guard (Spec §7). Not a full shell: it covers the habitual forms
// (quotes, separators, subshells/groups, $( ) and backticks, heredocs) so the policy sees real commands, and
// heredoc bodies — data such as plans and reviews — are never treated as commands.

/**
 * @returns {{commands: {argv: string[]}[], text: string, functions: Map<string,string>, vars: Map<string,string>}}
 *   text = the source without heredoc bodies (for path-pattern checks)
 */
export function parseShell(src, depth = 0) {
  const commands = [];
  const functions = new Map();
  let text = '';
  let argv = [];
  let word = null; // null = no word started
  const pendingHeredocs = [];
  const endWord = () => { if (word !== null) { argv.push(word); word = null; } };
  const endCmd = () => { endWord(); if (argv.length) commands.push({ argv }); argv = []; };
  const nested = (inner) => {
    if (depth > 8) return;
    const p = parseShell(inner, depth + 1);
    commands.push(...p.commands);
    text += ` ${p.text} `;
    for (const [k, v] of p.functions) functions.set(k, v);
  };
  /** index just past the ')' matching the '(' at i (respects quotes and nesting) */
  const matchParen = (i) => {
    let d = 0;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === "'") { j = src.indexOf("'", j + 1); if (j < 0) return src.length; continue; }
      if (c === '"') { j = skipDouble(j); continue; }
      if (c === '(') d++;
      else if (c === ')' && --d === 0) return j + 1;
    }
    return src.length;
  };
  const skipDouble = (i) => {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === '"') return j;
    }
    return src.length;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    // heredoc bodies start after the newline that ends the command line
    if (c === '\n') {
      text += c;
      endCmd();
      while (pendingHeredocs.length) {
        const { delim, strip, argvRef } = pendingHeredocs.shift();
        let j = i + 1;
        const body = [];
        for (;;) {
          const nl = src.indexOf('\n', j);
          const line = src.slice(j, nl < 0 ? src.length : nl);
          if ((strip ? line.replace(/^\t+/, '') : line) === delim || nl < 0) { i = nl < 0 ? src.length : nl; break; }
          body.push(strip ? line.replace(/^\t+/, '') : line);
          j = nl + 1;
        }
        const owner = commands.find((cmd) => cmd.argv === argvRef);
        if (owner) owner.heredoc = body.join('\n');
      }
      continue;
    }
    if (c === '#' && word === null) { // comment to end of line
      const nl = src.indexOf('\n', i);
      i = (nl < 0 ? src.length : nl) - 1;
      continue;
    }
    text += c;
    if (c === ' ' || c === '\t') { endWord(); continue; }
    if (c === '\\') { word = (word ?? '') + (src[i + 1] ?? ''); text += src[i + 1] ?? ''; i++; continue; }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j < 0 ? src.length : j;
      word = (word ?? '') + src.slice(i + 1, end);
      text += src.slice(i + 1, end + 1);
      i = end;
      continue;
    }
    if (c === '"') {
      const end = skipDouble(i);
      const body = src.slice(i + 1, end);
      for (const m of body.matchAll(/\$\(([^]*?)\)|`([^`]*)`/g)) nested(m[1] ?? m[2]);
      word = (word ?? '') + body.replace(/\\(["\\$`])/g, '$1');
      text += src.slice(i + 1, end + 1);
      i = end;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      const end = matchParen(i + 1);
      nested(src.slice(i + 2, end - 1));
      word = (word ?? '') + '$(…)';
      text += src.slice(i + 1, end);
      i = end - 1;
      continue;
    }
    if (c === '`') {
      const j = src.indexOf('`', i + 1);
      const end = j < 0 ? src.length : j;
      nested(src.slice(i + 1, end));
      word = (word ?? '') + '`…`';
      text += src.slice(i + 1, end + 1);
      i = end;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      endWord();
      let j = i + 2;
      const strip = src[j] === '-';
      if (strip) j++;
      while (src[j] === ' ') j++;
      const m = src.slice(j).match(/^(['"]?)([^\s'";|&<>()]+)\1/);
      if (m) { pendingHeredocs.push({ delim: m[2], strip, argvRef: argv }); text += src.slice(i + 1, j + m[0].length); i = j + m[0].length - 1; }
      continue;
    }
    if (c === '>' || c === '<') {
      // redirection operator (with optional fd dup like 2>&1); the target stays a word
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      let j = i + 1;
      while (src[j] === '>' || src[j] === '&') j++;
      while (/[0-9-]/.test(src[j] ?? '') && src[j - 1] === '&') j++;
      text += src.slice(i + 1, j);
      i = j - 1;
      argv.push('>');
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      // `name()` starts a function definition: record its body for `mis` wrappers
      if (c === '(' && src[i + 1] === ')' && word !== null && !argv.length) {
        const name = word;
        const open = src.indexOf('{', i);
        const close = open < 0 ? -1 : src.indexOf('}', open);
        if (open >= 0 && close >= 0) functions.set(name, src.slice(open + 1, close));
      }
      endCmd();
      continue;
    }
    if ((c === '{' || c === '}') && word === null && /[\s;]|^$/.test(src[i + 1] ?? '')) { endCmd(); continue; }
    word = (word ?? '') + c;
  }
  endCmd();
  // `>` placeholders separate redirection targets from argv; drop the operator and its target
  for (const cmd of commands) {
    const out = [];
    for (let k = 0; k < cmd.argv.length; k++) {
      if (cmd.argv[k] === '>') { cmd.redirects ??= []; if (cmd.argv[k + 1] !== undefined) cmd.redirects.push(cmd.argv[++k]); continue; }
      out.push(cmd.argv[k]);
    }
    cmd.argv = out;
  }
  return { commands, text, functions };
}

// Wrapper programs and which of their options take a value.
const WRAPPERS = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-T', '-D', '-R', '--user', '--group'],
  env: ['-u', '-C', '--unset', '--chdir'],
  nice: ['-n', '--adjustment'],
  time: ['-f', '-o', '--format', '--output'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  nohup: [], command: [], exec: ['-a'], stdbuf: ['-i', '-o', '-e'], caffeinate: ['-t', '-w'],
  xargs: ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '--max-args', '--replace', '--delimiter', '--arg-file'],
};
const KEYWORDS = ['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'fi', 'done'];
const SHELLS = /^(ba|z|da|k)?sh$/;

/**
 * Strip assignments, keywords and wrappers; resolve `$VAR` from earlier assignments.
 * @returns {{argv: string[], script?: string}} script = inline code of `sh -c` / `eval`, to be parsed recursively
 */
export function normalize(argv, vars, heredoc) {
  let a = argv.map((w) => {
    const m = w.match(/^\$\{?(\w+)\}?$/);
    return m && vars.has(m[1]) ? vars.get(m[1]) : w;
  });
  for (;;) {
    while (a.length && /^[A-Za-z_]\w*=/.test(a[0])) { const [k, ...v] = a.shift().split('='); vars.set(k, v.join('=')); }
    if (!a.length) return { argv: [] };
    if (KEYWORDS.includes(a[0])) { a.shift(); continue; }
    const name = a[0].split('/').pop();
    if (name in WRAPPERS) {
      a.shift();
      while (a[0]?.startsWith('-')) {
        const f = a.shift();
        if (name === 'env' && f === '-S') { return { argv: [], script: a.join(' ') }; }
        if (WRAPPERS[name].includes(f)) a.shift();
        if (name === 'nice' && /^-\d+$/.test(f)) continue;
      }
      if (name === 'timeout' && a.length) a.shift(); // DURATION
      continue;
    }
    break;
  }
  if (a[0]?.includes('/') && !a[0].endsWith('.mjs')) a[0] = a[0].split('/').pop();
  if (SHELLS.test(a[0])) {
    let k = 1;
    let hasC = false;
    while (/^[-+]/.test(a[k] ?? '')) {
      if (/^[-+][oO]$/.test(a[k])) { k += 2; continue; } // -o pipefail
      if (/^-[a-z]*c[a-z]*$/i.test(a[k])) hasC = true;
      k++;
    }
    if (hasC && a[k] !== undefined) return { argv: a, script: a[k] };
    if (!hasC && a[k] === undefined && heredoc !== undefined) return { argv: a, script: heredoc }; // bash <<EOF
  }
  if (a[0] === 'eval') return { argv: a, script: a.slice(1).join(' ') };
  return { argv: a };
}

/** All simple commands, recursively expanded through `sh -c` / `eval`, normalized. */
export function commandsOf(src, depth = 0) {
  const p = parseShell(src);
  const vars = new Map();
  const out = [];
  let text = p.text;
  const functions = new Map(p.functions);
  for (const c of p.commands) {
    const n = normalize(c.argv, vars, c.heredoc);
    if (n.script !== undefined && depth < 5) {
      const inner = commandsOf(n.script, depth + 1);
      out.push(...inner.commands);
      text += ` ${inner.text} `;
      for (const [k, v] of inner.functions) functions.set(k, v);
    }
    if (n.argv.length) out.push({ argv: n.argv, redirects: c.redirects ?? [] });
  }
  return { commands: out, text, functions };
}
