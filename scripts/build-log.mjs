#!/usr/bin/env node
/**
 * Print the Gradle errors from an EAS build.
 *
 *   node scripts/build-log.mjs <build-id> [--full]
 *
 * Worth having as a script because the log format is not guessable: EAS serves
 * a *brotli*-compressed file whose payload is newline-delimited JSON, one
 * record per log line. `curl | gunzip` gets you binary noise, and the build
 * page itself shows only "Gradle build failed with unknown error".
 */
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const buildId = process.argv[2];
const full = process.argv.includes('--full');

if (!buildId) {
  console.error('usage: node scripts/build-log.mjs <build-id> [--full]');
  process.exit(1);
}

const raw = execFileSync('npx', ['eas-cli', 'build:view', buildId, '--json'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'ignore'],
});

const build = JSON.parse(raw.slice(raw.indexOf('{')));
console.log(`status: ${build.status}`);
if (build.error) console.log(`error:  ${build.error.message}`);

const url = build.logFiles?.[0];
if (!url) {
  console.log('No log file attached to this build.');
  process.exit(0);
}

// EAS serves the log brotli-compressed. Node's fetch transparently decompresses `content-encoding:
// br`, so the bytes usually arrive as plain text already — only decompress when they genuinely are
// still compressed, or we double-decompress and fail with ERR__ERROR_FORMAT_PADDING_2.
const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
const looksCompressed = bytes[0] !== 0x7b; // a decompressed log starts with '{' (NDJSON)
const text = (looksCompressed ? brotliDecompressSync(bytes) : bytes).toString('utf8');

const messages = text
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line).msg ?? '';
    } catch {
      return '';
    }
  });

const out = join(tmpdir(), `eas-${buildId}.log`);
writeFileSync(out, messages.join('\n'));

if (full) {
  console.log(messages.join('\n'));
} else {
  // Kotlin errors are "e: file:line:col message"; Gradle's own are the
  // FAILURE / What went wrong block.
  const interesting = messages.filter((m) =>
    /^e: |error:|FAILURE|What went wrong|Caused by|Execution failed|> Task .*FAILED/.test(m),
  );
  const start = messages.findIndex((m) => m.includes('FAILURE: Build'));
  if (start >= 0) console.log('\n' + messages.slice(start, start + 40).join('\n'));
  else if (interesting.length) console.log('\n' + interesting.slice(0, 40).join('\n'));
  else console.log('\nNo errors found — build probably succeeded.');
}

console.log(`\nfull log: ${out}`);
