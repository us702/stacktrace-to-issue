# stacktrace-to-issue

Turn a raw stack trace into a ready-to-paste GitHub issue draft — no more pasting errors into ChatGPT by hand and asking it to "write a bug report."

## Why

Every dev has done this: hit an error, copy the stack trace, paste it into an AI chat, type "can you turn this into a bug report," wait, copy the answer back out. It's a 100% mechanical task that doesn't need a chat window — it needs a parser. `stacktrace-to-issue` reads the trace directly, extracts the error type, message, and stack frames, applies a small set of heuristics to guess the likely root cause, and prints a Markdown issue draft (summary, repro template, collapsible trace, parsed frames, likely cause, fix checklist) ready to paste into GitHub, Linear, or Jira.

Supports Node.js/JavaScript, Python, and Java traces out of the box, with a generic fallback for anything else. Zero runtime dependencies.

## Quick start

```bash
# from a file
node bin/stacktrace-to-issue.js path/to/trace.txt

# from stdin (e.g. piped straight from your terminal or CI logs)
cat error.log | node bin/stacktrace-to-issue.js

# install globally for a short command
npm install -g .
stacktrace-to-issue path/to/trace.txt
```

## Usage

```
stacktrace-to-issue <file>              Parse trace from a file
cat trace.txt | stacktrace-to-issue     Parse trace from stdin
stacktrace-to-issue <file> --ai         Use ANTHROPIC_API_KEY for a sharper cause/checklist
```

The `--ai` flag is optional. If `ANTHROPIC_API_KEY` is not set, or the API call fails for any reason, the tool silently falls back to its built-in heuristics — it never requires an API key for basic usage.

## Example

Input (`examples/node.txt`):

```
TypeError: Cannot read properties of undefined (reading 'name')
    at formatUser (/app/src/users.js:42:18)
    at processRequest (/app/src/handlers/userHandler.js:17:22)
    at /app/src/server.js:88:5
```

Output:

```markdown
# TypeError: Cannot read properties of undefined (reading 'name')

## Summary
A `TypeError` was raised: Cannot read properties of undefined (reading 'name'). Detected language/runtime: **javascript**.

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

...

</details>

## Parsed Frames (top 3)
1. `formatUser` — /app/src/users.js:42
2. `processRequest` — /app/src/handlers/userHandler.js:17
3. `<anonymous>` — /app/src/server.js:88

## Likely Cause
Something expected to hold a value was null/None/undefined — check for a missing initialization or an unguarded optional field.

## Suggested Fix Checklist
- [ ] Reproduce the error locally with the same input/environment.
- [ ] Inspect /app/src/users.js:42 — the top frame where the error originated.
- [ ] Add/confirm a null-check, type-check, or bounds-check at the failure point if applicable.
- [ ] Add a regression test that triggers this exact error path.
- [ ] Confirm the fix against the original repro steps.
```

More example traces (Python, Java) are in `examples/`.

## License

MIT
