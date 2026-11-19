// token-radar-01 — the entrypoint, radar-3.
//
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol with the
// radar-3 model in lib/model.ts, and writes the whole hand-in to one output
// directory:
//
//   board.json     the ranked board: 200 rows, watchlist covered
//   data.js        the same board in the shape dashboard/ reads
//   dashboard/     a copy of this repo's static dashboard (no network)
//   screenshots/   a copy of this repo's screenshots
//   dossier.json   buildDossier() over that output, byte for byte
//
// Node 22, standard library only, no install and no build step. The run is
// deterministic: the same snapshot in gives the same five outputs out, so
// two runs write identical bytes. The model decides the ranking; this file
// only moves data between the snapshot, the model and the output directory.
//
// Local run (the grader mounts the snapshot at /input and takes /output):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//   node main.ts --help

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_INPUT = '/input';
const DEFAULT_OUTPUT = '/output';

/** The caps the gate holds the hand-in to (see the kit's reference/gate.json). */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASH_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const USAGE = [
  'token-radar-01: rank pre-token DeFi protocols by expected launch value (radar-3).',
  '',
  'Usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>]',
  '       node main.ts --help',
  '',
  '  --input   snapshot file, or a directory holding snapshot.json (default /input)',
  '  --output  directory to write to (default $MAKEFUN_OUTPUT_DIR, else /output)',
].join('\n');

/** Print a message to stderr and leave with `code`. Never returns. */
function die(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

/** The command line as a map of flag to value, plus whether --help was asked for. */
function readFlags(argv: string[]): { flags: Map<string, string>; help: boolean } {
  const flags = new Map<string, string>();
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(token);
    if (match === null) die(`unknown argument ${JSON.stringify(token)}\n${USAGE}`, 2);
    const name = match[1]!;
    if (match[2] !== undefined) {
      flags.set(name, match[2]);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) die(`--${name} needs a value\n${USAGE}`, 2);
    flags.set(name, next);
    i++;
  }
  return { flags, help };
}

/** A snapshot path: a directory means its snapshot.json, a file means itself. */
function snapshotPath(given: string): string {
  if (existsSync(given) && statSync(given).isDirectory()) return join(given, 'snapshot.json');
  return given;
}

/**
 * Copy one flat directory's regular files into `dest`, skipping dot-names,
 * and return the copied names in order. Refuses a missing source directory.
 */
function copyFlat(source: string, dest: string): string[] {
  let entries;
  try {
    entries = readdirSync(source, { withFileTypes: true });
  } catch {
    die(`no ${source} directory to copy`, 1);
  }
  mkdirSync(dest, { recursive: true });
  const names = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) copyFileSync(join(source, name), join(dest, name));
  return names;
}

/** The whole run: read, score, check, write. Exits non-zero on any refusal. */
function run(): void {
  const { flags, help } = readFlags(process.argv.slice(2));
  if (help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const input = snapshotPath(flags.get('input') ?? DEFAULT_INPUT);
  const out = flags.get('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT;

  if (!existsSync(input)) {
    die(
      `no snapshot at ${input}: pass --input <snapshot.json|directory> or mount the sealed /input`,
      2,
    );
  }
  let snapshot;
  try {
    snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  } catch (err) {
    die(`the snapshot at ${input} cannot be scored: ${(err as Error).message}`, 1);
  }

  const { board, radar } = buildRadar(snapshot);
  const refusal = boardIssue(board, snapshot);
  if (refusal !== null) die(`the model wrote a board the gate refuses: ${refusal}`, 1);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  const dashFiles = copyFlat(join(REPO_ROOT, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFlat(join(REPO_ROOT, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3 || shots.length > SHOT_LIMIT.max) {
    die(`screenshots/ holds ${shots.length} images: hand in 3 or 4`, 1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) die(`screenshots/${name}: not a plain image name`, 1);
  }

  // Written last: the scorer rebuilds the dossier from this output and compares bytes.
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: DOSSIER_TEXT_CAP,
      screenshots: SHOT_LIMIT,
      dashboard: DASH_LIMIT,
    }),
  );

  process.stdout.write(
    `token-radar: scored ${snapshot.protocols.length} protocols (${snapshot.watchlist.length} on the watchlist) into ${board.length} rows (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token-radar: wrote ${out}/board.json, ${out}/data.js, ${out}/dashboard (${dashFiles.length} files), ${out}/screenshots (${shots.length} images) and ${out}/dossier.json\n`,
  );
}

run();
