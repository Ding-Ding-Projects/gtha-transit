import { execFileSync } from 'node:child_process';

/**
 * The line count a release publishes.
 *
 * Two things went wrong here and both are worth naming, because the failure mode
 * was a red release rather than a wrong number.
 *
 * The binary exclusion list named the extensions the repository happened to hold
 * when it was written. The first committed video was not on it, so the counter
 * tried to read a WebM as UTF-8 text and count its lines.
 *
 * Worse, every file is read through `git show` with the default one megabyte
 * output buffer, so any tracked file larger than that fails the whole run with
 * ENOBUFS and a megabyte of binary in the log. That is not a property of videos;
 * it is a ceiling this repository was always going to reach.
 *
 * So the exclusion is decided by looking at the bytes rather than by a list
 * somebody has to remember to extend, and the buffer is bounded explicitly.
 */

export const MAX_BUFFER = 64 * 1024 * 1024;

/* Extensions are a hint, not the decision. A file is excluded when it matches one
   of these or when its bytes contain a NUL, which text does not. */
export const BINARY_EXTENSION = /\.(png|jpe?g|gif|webp|ico|svgz|woff2?|ttf|otf|eot|zip|gz|tgz|7z|pbf|webm|mp4|mov|avi|mp3|wav|pdf|wasm|jar|exe|dll)$/i;

export const trackedFiles = () => execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: MAX_BUFFER })
  .split('\0')
  .filter(Boolean);

export const isExcludedByName = (file) => file === 'package-lock.json'
  || file.startsWith('components/ui/')
  || BINARY_EXTENSION.test(file);

export function count() {
  const rows = {
    Source: { total: 0, nonblank: 0 },
    Tests: { total: 0, nonblank: 0 },
    Styles: { total: 0, nonblank: 0 },
    Documentation: { total: 0, nonblank: 0 },
    Configuration: { total: 0, nonblank: 0 },
  };
  let excluded = 0;

  for (const file of trackedFiles()) {
    if (isExcludedByName(file)) { excluded += 1; continue; }

    /*
     * Read from the index, not from HEAD.
     *
     * `git ls-files` lists the index, so pairing it with `HEAD:` asks for a blob
     * that a newly staged file does not have yet, and the whole run dies with
     * "path does not exist in HEAD". On a clean tree the two are identical, which
     * is why the release is unaffected and why nobody noticed: it only bites
     * somebody running the suite with a new file staged, and it reddens the suite
     * for a reason that has nothing to do with their change.
     */
    const bytes = execFileSync('git', ['show', ':' + file], { maxBuffer: MAX_BUFFER });
    if (bytes.includes(0)) { excluded += 1; continue; }

    const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    const category = /test|fixture/.test(file) ? 'Tests'
      : /\.css$/.test(file) ? 'Styles'
        : /\.md$/.test(file) ? 'Documentation'
          : /\.(tsx?|mjs|py|ps1|bat)$/.test(file) ? 'Source'
            : 'Configuration';
    rows[category].total += lines.length;
    rows[category].nonblank += lines.filter((line) => line.trim()).length;
  }

  return { rows, excluded };
}

if (process.argv[1] && process.argv[1].endsWith('count-lines.mjs')) {
  const { rows, excluded } = count();
  console.log('| Category | Total lines | Nonblank lines |\n|---|---:|---:|');
  for (const [name, counts] of Object.entries(rows)) {
    console.log(`| ${name} | ${counts.total} | ${counts.nonblank} |`);
  }
  console.log(`\nExcluded ${excluded} lockfile, generated scaffold-component or binary files. Counts use tracked files as staged, which on a clean tree is HEAD. Command: node scripts/count-lines.mjs.`);
}
