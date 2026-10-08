#!/usr/bin/env node
'use strict';
// node scripts/render-plist.js <template> KEY=value ... > out.plist
// Values are XML-escaped; unknown {{KEYS}} are an error.
const fs = require('fs');
const [tpl, ...pairs] = process.argv.slice(2);
const vars = Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const out = fs.readFileSync(tpl, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
  if (!(k in vars)) {
    process.stderr.write(`render-plist: missing ${k}\n`);
    process.exit(1);
  }
  return esc(vars[k]);
});
process.stdout.write(out);
