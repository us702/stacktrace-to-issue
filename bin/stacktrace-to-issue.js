#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

function readInput(args) {
  const fileArg = args.find((a) => !a.startsWith('-'));
  if (fileArg) {
    return fs.readFileSync(fileArg, 'utf8');
  }
  if (!process.stdin.isTTY) {
    return fs.readFileSync(0, 'utf8');
  }
  return '';
}

function detectLanguage(text) {
  if (/^Traceback \(most recent call last\):/m.test(text)) return 'python';
  if (/\s+at .+\(.+\.java(:\d+)?\)/m.test(text) || /Exception in thread/.test(text)) return 'java';
  if (/\s+at .+\(.*:\d+:\d+\)/m.test(text) || /^(TypeError|ReferenceError|RangeError|SyntaxError|Error):/m.test(text)) {
    return 'javascript';
  }
  return 'generic';
}

function parsePython(text) {
  const lines = text.split(/\r?\n/);
  const frameRe = /^\s*File "(.+)", line (\d+), in (.+)$/;
  const frames = [];
  for (const line of lines) {
    const m = line.match(frameRe);
    if (m) frames.push({ file: m[1], line: Number(m[2]), fn: m[3] });
  }
  const last = lines.filter((l) => l.trim().length > 0).pop() || '';
  const errMatch = last.match(/^([\w.]+(?:Error|Exception|Warning))\s*:?\s*(.*)$/);
  return {
    errorType: errMatch ? errMatch[1] : 'Exception',
    message: errMatch ? errMatch[2] : last.trim(),
    frames,
  };
}

function parseJava(text) {
  const lines = text.split(/\r?\n/);
  const frameRe = /^\s*at\s+(\S+)\(([^)]*)\)/;
  const frames = [];
  for (const line of lines) {
    const m = line.match(frameRe);
    if (m) frames.push({ file: m[2], line: null, fn: m[1] });
  }
  const headerLine = lines.find((l) => /Exception|Error/.test(l) && !/^\s*at\s/.test(l)) || lines[0] || '';
  const errMatch = headerLine.match(/([\w.$]+(?:Error|Exception))\s*:?\s*(.*)$/);
  return {
    errorType: errMatch ? errMatch[1] : 'Exception',
    message: errMatch ? errMatch[2] : headerLine.trim(),
    frames,
  };
}

function parseJavascript(text) {
  const lines = text.split(/\r?\n/);
  const frameRe = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  const frames = [];
  for (const line of lines) {
    const m = line.match(frameRe);
    if (m) frames.push({ file: m[2], line: Number(m[3]), fn: m[1] || '<anonymous>' });
  }
  const headerLine = lines.find((l) => /^(\w*Error|TypeError|ReferenceError|RangeError|SyntaxError)/.test(l.trim())) || lines[0] || '';
  const errMatch = headerLine.match(/^(\w*(?:Error))\s*:?\s*(.*)$/);
  return {
    errorType: errMatch ? errMatch[1] : 'Error',
    message: errMatch ? errMatch[2] : headerLine.trim(),
    frames,
  };
}

function parseGeneric(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return {
    errorType: 'Error',
    message: lines[0] || 'Unknown error',
    frames: [],
  };
}

function parse(text) {
  const lang = detectLanguage(text);
  let result;
  if (lang === 'python') result = parsePython(text);
  else if (lang === 'java') result = parseJava(text);
  else if (lang === 'javascript') result = parseJavascript(text);
  else result = parseGeneric(text);
  result.language = lang;
  return result;
}

const CAUSE_HINTS = [
  { re: /null|none|undefined/i, hint: 'Something expected to hold a value was null/None/undefined — check for a missing initialization or an unguarded optional field.' },
  { re: /index out of (bounds|range)|list index/i, hint: 'Code accessed a collection past its bounds — check loop conditions and off-by-one logic.' },
  { re: /key ?error|no such key|not found/i, hint: 'A lookup (dict/map/object key) failed — the key may not exist for this input; add a guard or default.' },
  { re: /timeout|timed out/i, hint: 'An operation exceeded its time budget — check network calls, retries, or increase the timeout if justified.' },
  { re: /permission denied|access denied|forbidden/i, hint: 'A permissions/auth check failed — verify credentials, file permissions, or IAM/ACL settings.' },
  { re: /connection refused|econnrefused|could not connect/i, hint: 'A downstream service was unreachable — check it is running and the host/port/config is correct.' },
  { re: /out of memory|heap/i, hint: 'The process ran out of memory — look for unbounded loops/collections or large payloads.' },
  { re: /type ?error|cannot read propert(y|ies)|is not a function/i, hint: 'A value was of an unexpected type/shape — validate input shape before use, especially from an external source.' },
  { re: /syntax ?error/i, hint: 'Malformed code or data was parsed — check recently edited code or an upstream data format change.' },
];

function guessCause(parsed) {
  const haystack = `${parsed.errorType} ${parsed.message}`;
  for (const { re, hint } of CAUSE_HINTS) {
    if (re.test(haystack)) return hint;
  }
  return 'No strong pattern match from the error text alone — inspect the top stack frame and recent changes to that file.';
}

function buildChecklist(parsed) {
  const items = [
    'Reproduce the error locally with the same input/environment.',
  ];
  if (parsed.frames.length > 0) {
    items.push(`Inspect ${parsed.frames[0].file}${parsed.frames[0].line ? `:${parsed.frames[0].line}` : ''} — the top frame where the error originated.`);
  }
  items.push('Add/confirm a null-check, type-check, or bounds-check at the failure point if applicable.');
  items.push('Add a regression test that triggers this exact error path.');
  items.push('Confirm the fix against the original repro steps.');
  return items;
}

function toMarkdown(parsed, rawText, opts) {
  const title = `${parsed.errorType}: ${parsed.message}`.slice(0, 120) || 'Unhandled error';
  const cause = opts.aiCause || guessCause(parsed);
  const checklist = opts.aiChecklist || buildChecklist(parsed);
  const framesTable = parsed.frames.length
    ? parsed.frames
        .slice(0, 10)
        .map((f, i) => `${i + 1}. \`${f.fn || '<anonymous>'}\` — ${f.file}${f.line ? `:${f.line}` : ''}`)
        .join('\n')
    : '_No stack frames could be parsed from the input._';

  return `# ${title}

## Summary
A \`${parsed.errorType}\` was raised${parsed.message ? `: ${parsed.message}` : ''}. Detected language/runtime: **${parsed.language}**.

## Environment
- OS:
- Runtime/version:
- Branch/commit:

## Steps to Reproduce
1.
2.
3.

## Stack Trace
<details>
<summary>Full trace</summary>

\`\`\`
${rawText.trim()}
\`\`\`

</details>

## Parsed Frames (top ${Math.min(parsed.frames.length, 10) || 0})
${framesTable}

## Likely Cause
${cause}

## Suggested Fix Checklist
${checklist.map((c) => `- [ ] ${c}`).join('\n')}
`;
}

function callClaude(parsed, rawText) {
  return new Promise((resolve) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      resolve(null);
      return;
    }
    const payload = JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `You are helping write a GitHub issue from a stack trace. Given this error (type: ${parsed.errorType}, message: ${parsed.message}, language: ${parsed.language}) and trace below, respond ONLY with JSON: {"cause": "one paragraph likely root cause", "checklist": ["step1", "step2", ...]} (3-6 checklist items).\n\nTrace:\n${rawText.slice(0, 4000)}`,
        },
      ],
    });
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-length': Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const text = json.content && json.content[0] && json.content[0].text;
            const parsedJson = JSON.parse(text);
            resolve(parsedJson);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`stacktrace-to-issue - turn a raw stack trace into a GitHub issue draft

Usage:
  stacktrace-to-issue <file>        Parse trace from a file
  cat trace.txt | stacktrace-to-issue   Parse trace from stdin
  stacktrace-to-issue <file> --ai   Use ANTHROPIC_API_KEY for a sharper cause/checklist (falls back silently if unset/unreachable)

Output is a Markdown GitHub issue draft printed to stdout.`);
    return;
  }

  const useAi = args.includes('--ai');
  const rawText = readInput(args);
  if (!rawText || !rawText.trim()) {
    console.error('No input provided. Pass a file path or pipe a stack trace via stdin. Use --help for usage.');
    process.exitCode = 1;
    return;
  }

  const parsed = parse(rawText);
  const opts = {};
  if (useAi) {
    const ai = await callClaude(parsed, rawText);
    if (ai) {
      opts.aiCause = ai.cause;
      opts.aiChecklist = ai.checklist;
    }
  }
  const markdown = toMarkdown(parsed, rawText, opts);
  process.stdout.write(markdown + '\n');
}

main();
