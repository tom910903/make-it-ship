// Minimal POSIX-ish shell tokenizer for the guard (Spec §7). Not a full shell: it covers the habitual forms
// (quotes, separators, subshells/groups, $( ) and backticks, heredocs) so the policy sees real commands, and
// heredoc bodies — data such as plans and reviews — are never treated as commands.

// Redirection operator in argv: a value no word can equal, so a quoted '>' stays a literal word (M9 r2 D1).
const REDIR = Symbol('redirect');

/**
 * @returns {{commands: {argv: string[]}[], text: string, functions: Map<string,string>, vars: Map<string,string>}}
 *   text = the source without heredoc bodies (for path-pattern checks)
 */
export function parseShell(src, depth = 0) {
  const commands = [];
  const functions = functionDefs(src);
  let text = '';
  let argv = [];
  let word = null; // null = no word started
  let quoted = false; // the current word has quoted or escaped text (so `'2'>f` is not an fd number)
  const pendingHeredocs = [];
  const endWord = () => { if (word !== null) { argv.push(word); word = null; } quoted = false; };
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
    if (c === '\\') { word = (word ?? '') + (src[i + 1] ?? ''); quoted = true; text += src[i + 1] ?? ''; i++; continue; }
    if (c === '$' && src[i + 1] === '"') continue; // $"…" (locale string) is a double-quoted string
    if (c === '$' && src[i + 1] === "'") { // $'…' (ANSI-C): \' does not end it
      let j = i + 2;
      while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      const esc = { n: '\n', t: '\t', r: '\r', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v' };
      word = (word ?? '') + src.slice(i + 2, j).replace(/\\(.)/g, (_, x) => esc[x] ?? x);
      quoted = true;
      text += src.slice(i + 1, j + 1);
      i = j;
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j < 0 ? src.length : j;
      word = (word ?? '') + src.slice(i + 1, end);
      quoted = true;
      text += src.slice(i + 1, end + 1);
      i = end;
      continue;
    }
    if (c === '"') {
      const end = skipDouble(i);
      const body = src.slice(i + 1, end);
      for (const m of body.matchAll(/\$\(([^]*?)\)|`([^`]*)`/g)) nested(m[1] ?? m[2]);
      word = (word ?? '') + body.replace(/\\(["\\$`])/g, '$1');
      quoted = true;
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
    if (c === '>' || c === '<' || (c === '&' && src[i + 1] === '>')) {
      // redirection operator: > >> >| &> &>> < <> <<< N> N>&M >&- …; the target stays the next word unless it is an fd dup
      if (word !== null && !quoted && /^\d+$/.test(word)) word = null;
      endWord();
      let j = i + 1;
      while (src[j] === '>' || src[j] === '<') j++;
      if (src[j] === '|') j++;
      const dup = src[j] === '&' && /^[0-9-]/.test(src[j + 1] ?? '');
      if (src[j] === '&') j++;
      if (dup) while (/[0-9-]/.test(src[j] ?? '')) j++;
      text += src.slice(i + 1, j);
      i = j - 1;
      if (!dup) argv.push(REDIR);
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      endCmd();
      continue;
    }
    if ((c === '{' || c === '}') && word === null && /[\s;]|^$/.test(src[i + 1] ?? '')) { endCmd(); continue; }
    word = (word ?? '') + c;
  }
  endCmd();
  // REDIR markers separate redirection targets from argv; drop the operator and its target
  for (const cmd of commands) {
    const out = [];
    for (let k = 0; k < cmd.argv.length; k++) {
      if (cmd.argv[k] === REDIR) { cmd.redirects ??= []; if (typeof cmd.argv[k + 1] === 'string') cmd.redirects.push(cmd.argv[++k]); continue; }
      out.push(cmd.argv[k]);
    }
    cmd.argv = out;
  }
  return { commands, text, functions };
}

/** index of the '"' that closes the double quote opened at i */
function skipDq(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '"') return j;
  }
  return src.length;
}

/**
 * Function definitions (`f() {…}`, `f() (…)`, `function f {…}`, `function f() {…}`): name → body. The body ends at the
 * matching brace or paren outside quotes, so `${VAR}` and `$(…)` inside it do not cut it short. A definition-like text
 * inside a string is recorded too: that can only make the guard stricter.
 */
function functionDefs(src) {
  const defs = new Map();
  for (const m of src.matchAll(/(?:^|[\s;&|(){}])(?:function\s+([\w.:-]+)\s*(?:\(\s*\))?|([\w.:-]+)\s*\(\s*\))\s*([{(])/g)) {
    const open = m.index + m[0].length - 1, o = src[open], c = o === '{' ? '}' : ')';
    let d = 0, j = open;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '\\') { j++; continue; }
      if (ch === "'") { const k = src.indexOf("'", j + 1); if (k < 0) { j = src.length; break; } j = k; continue; }
      if (ch === '"') { j = skipDq(src, j); continue; }
      if (ch === o) d++;
      else if (ch === c && --d === 0) break;
    }
    defs.set(m[1] ?? m[2], src.slice(open + 1, j));
  }
  return defs;
}

// Wrapper programs and which of their options take a value.
const WRAPPERS = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-T', '-D', '-R', '--user', '--group', '--chdir'],
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
  const env = []; // leading assignments (`K=V cmd`, `env K=V cmd`): the command's environment, shown in asks
  let chdir = false; // `env -C dir`, `sudo -D dir`: the command runs in another directory (M9 r3)
  for (;;) {
    while (a.length && /^[A-Za-z_]\w*=/.test(a[0])) { env.push(a[0]); const [k, ...v] = a.shift().split('='); vars.set(k, v.join('=')); }
    if (!a.length) return { argv: [], env };
    if (KEYWORDS.includes(a[0])) { a.shift(); continue; }
    const name = a[0].split('/').pop();
    if (name in WRAPPERS) {
      a.shift();
      while (a[0]?.startsWith('-')) {
        const f = a.shift();
        if (name === 'env' && f === '-S') { return { argv: [], env, chdir, script: a.join(' ') }; }
        if ((name === 'env' && /^(-C|--chdir(=|$))/.test(f)) || (name === 'sudo' && /^(-D|--chdir(=|$))/.test(f))) chdir = true;
        if (WRAPPERS[name].includes(f)) { a.shift(); continue; }
        // clustered short options (`env -vC dir`, `env -iS 'cmd'`): the first value-taking letter takes the rest or the next word
        const cl = /^-([A-Za-z0-9]{2,})$/.exec(f);
        if (cl && (name === 'env' || name === 'sudo')) {
          for (let i = 0; i < cl[1].length; i++) {
            const opt = `-${cl[1][i]}`, last = i === cl[1].length - 1;
            if ((name === 'env' && opt === '-C') || (name === 'sudo' && opt === '-D')) chdir = true;
            if (name === 'env' && opt === '-S') return { argv: [], env, chdir, script: (last ? '' : cl[1].slice(i + 1) + ' ') + a.join(' ') };
            if (WRAPPERS[name].includes(opt)) { if (last) a.shift(); break; }
          }
        }
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
    if (hasC && a[k] !== undefined) return { argv: a, env, chdir, script: a[k] };
    if (!hasC && a[k] === undefined && heredoc !== undefined) return { argv: a, env, chdir, script: heredoc }; // bash <<EOF
  }
  if (a[0] === 'eval') return { argv: a, env, chdir, script: a.slice(1).join(' ') };
  return { argv: a, env, chdir };
}

/** `$@`, `$*`, `$1`… of a function body → the call's arguments */
const POSITIONAL = /^\$\{?([@*]|\d)\}?$/;
const substitute = (argv, args) => argv.flatMap((w) => {
  const m = POSITIONAL.exec(w);
  return !m ? [w] : '@*'.includes(m[1]) ? args : m[1] === '0' ? [w] : args[m[1] - 1] === undefined ? [] : [args[m[1] - 1]];
});

/**
 * All simple commands, recursively expanded through `sh -c` / `eval` and through calls of shell functions and aliases
 * defined in the command (the body's commands with the call's arguments, as the shell runs them), normalized.
 */
export function commandsOf(src, depth = 0, known = new Map()) {
  const p = parseShell(src);
  const vars = new Map();
  const out = [];
  let text = p.text;
  const functions = new Map([...known, ...p.functions]);
  for (const c of p.commands) {
    if (c.argv[0] !== 'alias') continue;
    for (const def of c.argv.slice(1)) { const m = /^([^=\s]+)=([^]*)$/.exec(def); if (m) functions.set(m[1], `${m[2]} "$@"`); }
  }
  for (const c of p.commands) {
    const n = normalize(c.argv, vars, c.heredoc);
    if (n.script !== undefined && depth < 5) {
      const inner = commandsOf(n.script, depth + 1, functions);
      out.push(...inner.commands.map((ic) => (n.chdir ? { ...ic, chdir: true } : ic)));
      text += ` ${inner.text} `;
      for (const [k, v] of inner.functions) functions.set(k, v);
    }
    // `exec 3> f` and a bare `> f` still write f, and a bare `K=V` sets a variable (exported under `set -a`): keep them as a no-op command (`:`)
    if (!n.argv.length) { if (c.redirects?.length || n.env?.length) out.push({ argv: [':'], redirects: c.redirects ?? [], env: n.env ?? [] }); continue; }
    out.push({ argv: n.argv, redirects: c.redirects ?? [], env: n.env ?? [], chdir: n.chdir });
    if (functions.has(n.argv[0]) && depth < 5) {
      for (const ic of commandsOf(functions.get(n.argv[0]), depth + 1, functions).commands) {
        const argv = normalize(substitute(ic.argv, n.argv.slice(1)), new Map()).argv;
        if (argv.length) out.push({ argv, redirects: ic.redirects, env: ic.env ?? [] });
      }
    }
  }
  return { commands: out, text, functions };
}
