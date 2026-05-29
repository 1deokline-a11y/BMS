'use strict';
const fs = require('fs');
const text = fs.readFileSync(
  'c:/Users/user/.claude/projects/c--Users-user-Desktop-claude-AI-BOM-Management-System/69c71792-0d57-4285-8f89-1bf9d263357f.jsonl',
  'utf8'
);

// Script starts at 10053260, ends after prs.writeFile(...)
const start = 10053260;
const sample = text.substring(start, start + 30000);

const wfIdx = sample.indexOf('prs.writeFile');
const endIdx = sample.indexOf(');', wfIdx) + 2;
const raw = sample.substring(0, endIdx);

// The content has literal backslash-n sequences: char(92) + char(110)
// Replace them with actual newlines
let result = '';
for (let i = 0; i < raw.length; i++) {
  if (raw.charCodeAt(i) === 92 && i + 1 < raw.length && raw.charCodeAt(i+1) === 110) {
    result += '\n';
    i++; // skip 'n'
  } else if (raw.charCodeAt(i) === 92 && i + 1 < raw.length && raw.charCodeAt(i+1) === 116) {
    result += '\t';
    i++; // skip 't'
  } else if (raw.charCodeAt(i) === 92 && i + 1 < raw.length && raw.charCodeAt(i+1) === 114) {
    // skip \r
    i++;
  } else if (raw.charCodeAt(i) === 92 && i + 1 < raw.length && raw.charCodeAt(i+1) === 39) {
    result += "'";
    i++; // skip "'"
  } else if (raw.charCodeAt(i) === 92 && i + 1 < raw.length && raw.charCodeAt(i+1) === 34) {
    result += '"';
    i++; // skip '"'
  } else if (raw.charCodeAt(i) === 92 && i + 1 < raw.length && raw.charCodeAt(i+1) === 92) {
    result += '\\';
    i++; // skip second backslash
  } else {
    result += raw[i];
  }
}

fs.writeFileSync(
  'c:/Users/user/Desktop/claude AI-BOM Management System/make_ppt.js',
  result, 'utf8'
);
console.log('Written! lines:', result.split('\n').length, 'chars:', result.length);
console.log('First 300:\n' + result.substring(0, 300));
