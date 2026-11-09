#!/usr/bin/env node
// Builds a static copy of PasteProof (dist/) that runs on any static host, e.g. GitHub Pages.
// Everything except URL fetching runs in the browser; the site detects the missing server itself.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
await rm(DIST, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), DIST, { recursive: true });
await mkdir(path.join(DIST, 'vendor'), { recursive: true });
await cp(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), path.join(DIST, 'vendor/axe.min.js'));
await cp(path.join(ROOT, 'node_modules/diff/dist/diff.min.js'), path.join(DIST, 'vendor/diff.min.js'));
await writeFile(path.join(DIST, '.nojekyll'), '');
console.log('Static site written to dist/');
