import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectPackage } from './lib.mjs';
import { collectGitHub } from './github.mjs';
import { githubRepository } from './github-repository.mjs';
import semver from 'semver';
import { readWithdrawn } from './withdrawn.mjs';

/** Keep package checks, source activity and author CI as separate evidence. */
export async function reviewCandidates(candidates, {
  concurrency = 8, now = Date.now(), maxInactiveDays = 90,
  targetDsh, checkpointDirectory, resume = false, withdrawn = new Set(), onProgress = () => {}
} = {}) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error('Provide a nonempty candidate list');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Concurrency must be between 1 and 8');
  let inputs = [...new Map(candidates.map(value => {
    const input = typeof value === 'string' ? {name: value} : value;
    return [input.name, input];
  })).values()];
  const packages = [], rejected = [];
  // Authors who asked to leave stay out of every scan, before any package is fetched.
  for (const input of inputs.filter(value => withdrawn.has(value.name))) rejected.push({name: input.name, stage: 'withdrawn', reason: 'Withdrawn at author request'});
  inputs = inputs.filter(value => !withdrawn.has(value.name));
  if (checkpointDirectory) await mkdir(checkpointDirectory, {recursive: true});
  let next = 0, completed = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, inputs.length)}, async () => {
    while (next < inputs.length) {
      const input = inputs[next++];
      const checkpoint = checkpointDirectory && resolve(checkpointDirectory, encodeURIComponent(input.name) + '.json');
      let result;
      if (resume && checkpoint) {
        try {
          const cached = JSON.parse(await readFile(checkpoint, 'utf8'));
          const age = now - Date.parse(cached.checkedAt);
          if (cached.input.name === input.name && cached.input.version === input.version && age >= 0 && age < 24 * 60 * 60 * 1000) result = cached.result;
        } catch {}
      }
      if (!result) {
        try {
          const {entry, evidence} = await collectPackage({name: input.name, ...(input.version ? {version: input.version} : {})}, {now});
          const collected = {entry, evidence};
          if (!collected.evidence.repository || !collected.evidence.license?.trim() || collected.evidence.license === 'UNLICENSED') throw new Error('Public source and a declared license are required');
          result = {ok: true, ...collected};
        } catch (error) { result = {ok: false, error: error.message}; }
        if (checkpoint) await writeFile(checkpoint, JSON.stringify({input, checkedAt: new Date(now).toISOString(), result}));
      }
      if (result.ok) packages.push({discovery: input, ...result});
      else rejected.push({name: input.name, stage: 'package-validation', reason: result.error});
      completed++;
      onProgress({completed, total: inputs.length, passed: packages.length, rejected: rejected.length});
    }
  }));
  const github = await collectGitHub({plugins: packages.map(value => value.entry)}, {now, concurrency});
  const accepted = [];
  for (const item of packages) {
    const key = githubRepository(item.entry.repository?.url)?.key;
    const source = key && github.repositories[key];
    const expected = item.discovery.discoveryRepo?.toLowerCase();
    let reason;
    if (!source || source.status !== 'ok') reason = 'GitHub source could not be verified';
    else if (expected && key !== expected) reason = 'Published repository differs from the discovery record';
    else if (source.archived) reason = 'Source repository is archived';
    else if (!source.pushedAt || now - Date.parse(source.pushedAt) > maxInactiveDays * 86400000) reason = 'No repository push in the activity window';
    else if (targetDsh && !semver.satisfies(targetDsh, item.entry.versions[0].engines.dsh ?? '*', {includePrerelease: true})) reason = 'Declared compatibility excludes ' + targetDsh;
    if (reason) rejected.push({name: item.entry.name, stage: 'source-validation', reason});
    else accepted.push({...item, github: source});
  }
  accepted.sort((a, b) => b.github.stars - a.github.stars || a.entry.name.localeCompare(b.entry.name));
  return {
    generatedAt: new Date(now).toISOString(),
    criteria: {maxInactiveDays, ...(targetDsh ? {targetDsh} : {}), publicSource: true, declaredLicense: true, publishedBundleChecked: true},
    evidenceScope: {packageValidation: 'Executed by this script', sourceActivity: 'GitHub API snapshot', authorCI: 'Not checked by this script', localPluginTests: 'Not executed', dshIntegration: 'Not executed'},
    accepted, rejected
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputFile, outputFile, ...flags] = process.argv.slice(2);
  if (!inputFile || !outputFile) throw new Error('Usage: node scripts/review-candidates.mjs candidates.json report.json [--resume]');
  const input = JSON.parse(await readFile(inputFile, 'utf8'));
  await mkdir(dirname(resolve(outputFile)), {recursive: true});
  const report = await reviewCandidates(Array.isArray(input) ? input : input.packages, {
    ...(!Array.isArray(input) ? {targetDsh: input.targetDsh, maxInactiveDays: input.maxInactiveDays ?? 90} : {}),
    checkpointDirectory: resolve(dirname(outputFile), 'checks'),
    resume: flags.includes('--resume'),
    withdrawn: await readWithdrawn(),
    onProgress: progress => { if (progress.completed % 20 === 0 || progress.completed === progress.total) console.log(JSON.stringify(progress)); }
  });
  await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({accepted: report.accepted.length, rejected: report.rejected.length, stars: report.accepted.length ? [report.accepted[0].github.stars, report.accepted.at(-1).github.stars] : [], report: outputFile}));
}
