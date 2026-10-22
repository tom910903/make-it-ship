// .make-it-ship.json: hand-rolled schema validation (Spec §8.1), defaults, hash.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILE = '.make-it-ship.json';
const MODES = ['quick', 'standard', 'full'];
const LEVELS = ['HIGH', 'MED', 'LOW'];
const DEFAULT_MANIFESTS = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'pyproject.toml', 'requirements*.txt', 'Pipfile', 'Pipfile.lock', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'Package.swift'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isStrArr = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

function unknownKeys(obj, allowed, prefix, errs) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errs.push(`unknown key: ${prefix}${k}`);
}

/** @returns {string[]} error messages; empty when valid */
export function validateConfig(cfg) {
  const errs = [];
  if (!isObj(cfg)) return ['config must be an object'];
  unknownKeys(cfg, ['version', 'checks', 'required', 'limits', 'dependencyManifests', 'interview', 'layout'], '', errs);
  if (cfg.version !== 1) errs.push('version must be 1');
  if (!isObj(cfg.checks) || !Object.keys(cfg.checks).length) errs.push('checks must define at least one check');
  else for (const [name, c] of Object.entries(cfg.checks)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) errs.push(`checks.${name}: invalid name`);
    if (!isObj(c)) { errs.push(`checks.${name} must be an object`); continue; }
    unknownKeys(c, ['argv', 'timeoutSec'], `checks.${name}.`, errs);
    if (!isStrArr(c.argv) || c.argv.length === 0) errs.push(`checks.${name}.argv must be a non-empty string array`);
    if (c.timeoutSec !== undefined && !isPosInt(c.timeoutSec)) errs.push(`checks.${name}.timeoutSec must be a positive integer`);
  }
  if (cfg.required !== undefined) {
    if (!isObj(cfg.required)) errs.push('required must be an object');
    else {
      unknownKeys(cfg.required, MODES, 'required.', errs);
      for (const [mode, names] of Object.entries(cfg.required)) {
        if (!isStrArr(names)) { errs.push(`required.${mode} must be a string array`); continue; }
        if (!names.length) errs.push(`required.${mode} must list at least one check`);
        for (const n of names) if (!isObj(cfg.checks) || !cfg.checks[n]) errs.push(`required.${mode}: check "${n}" is not defined`);
      }
    }
  }
  if (cfg.limits !== undefined) {
    if (!isObj(cfg.limits)) errs.push('limits must be an object');
    else {
      unknownKeys(cfg.limits, ['maxAttemptsPerTask', 'maxRuntimeMinutes'], 'limits.', errs);
      for (const [k, v] of Object.entries(cfg.limits)) if (!isPosInt(v)) errs.push(`limits.${k} must be a positive integer`);
    }
  }
  if (cfg.dependencyManifests !== undefined && !isStrArr(cfg.dependencyManifests)) errs.push('dependencyManifests must be a string array');
  if (cfg.interview !== undefined) {
    if (!isObj(cfg.interview)) errs.push('interview must be an object');
    else {
      unknownKeys(cfg.interview, ['threshold'], 'interview.', errs);
      if (cfg.interview.threshold !== undefined && !LEVELS.includes(cfg.interview.threshold)) errs.push('interview.threshold must be HIGH|MED|LOW');
    }
  }
  if (cfg.layout !== undefined) validateLayout(cfg.layout, errs);
  return errs;
}

/** Optional project layout (user decision 2026-10-22): allowed path globs, their purposes, human/AI doc folders. */
function validateLayout(l, errs) {
  if (!isObj(l)) { errs.push('layout must be an object'); return; }
  unknownKeys(l, ['paths', 'purposes', 'docs'], 'layout.', errs);
  if (!isStrArr(l.paths) || !l.paths.length) errs.push('layout.paths must be a non-empty string array of path globs');
  if (l.purposes !== undefined) {
    if (!isObj(l.purposes)) errs.push('layout.purposes must be an object {glob: purpose}');
    else for (const [g, v] of Object.entries(l.purposes)) {
      if (!isStrArr(l.paths) || !l.paths.includes(g)) errs.push(`layout.purposes: "${g}" is not in layout.paths`);
      if (typeof v !== 'string' || !v) errs.push(`layout.purposes["${g}"] must be a non-empty string`);
    }
  }
  if (l.docs !== undefined) {
    if (!isObj(l.docs)) { errs.push('layout.docs must be an object'); return; }
    unknownKeys(l.docs, ['human', 'ai', 'languages'], 'layout.docs.', errs);
    // D1: `mis layout write` writes under docs.ai, so a folder must stay inside the repo: no `..`/`.` segment, absolute path, `~` or `\`.
    const folder = (v) => typeof v === 'string' && /^[^/*?\\~][^/*?\\]*(\/[^/*?\\]+)*$/.test(v) && !v.split('/').some((x) => x === '..' || x === '.');
    for (const k of ['human', 'ai']) if (l.docs[k] !== undefined && !folder(l.docs[k])) errs.push(`layout.docs.${k} must be a repo-relative folder path like "docs" (no globs, no trailing slash, no "..", ".", "~", "\\" or leading "/")`);
    const langs = l.docs.languages;
    if (langs !== undefined) {
      if (!isStrArr(langs) || !langs.every((x) => /^[a-z]{2,3}(-[a-z0-9]+)?$/.test(x))) errs.push('layout.docs.languages must be language codes like ["en", "ko"]');
      else if (!langs.includes('en')) errs.push('layout.docs.languages must include "en" (the file without a language suffix)');
    }
  }
}

export function normalizeConfig(cfg) {
  const checks = {};
  for (const [name, c] of Object.entries(cfg.checks)) checks[name] = { argv: c.argv, timeoutSec: c.timeoutSec ?? 600 };
  return {
    version: 1,
    checks,
    required: cfg.required ?? {},
    limits: { maxAttemptsPerTask: 2, maxRuntimeMinutes: 120, ...cfg.limits },
    dependencyManifests: cfg.dependencyManifests ?? DEFAULT_MANIFESTS,
    interview: { threshold: cfg.interview?.threshold ?? 'HIGH' },
    ...(cfg.layout ? { layout: cfg.layout } : {}),
  };
}

/** Quick → required.quick; Standard/Full → required.standard plus every qa-* check; default → every defined check. */
export function requiredChecks(config, mode) {
  const key = mode === 'quick' ? 'quick' : 'standard';
  const base = config.required[key] ?? Object.keys(config.checks);
  if (mode === 'quick') return base;
  // Standard/Full: real-use QA checks (qa-*) are always required when defined (Spec §14.1 qa).
  return [...base, ...Object.keys(config.checks).filter((n) => n.startsWith('qa-') && !base.includes(n))];
}

export function hashConfigText(text) {
  return text == null ? 'none' : createHash('sha256').update(text).digest('hex');
}

/** @returns {{exists:boolean, config:object|null, configHash:string, errors:string[], path:string}} */
export function loadConfig(repoRoot) {
  const path = join(repoRoot, CONFIG_FILE);
  if (!existsSync(path)) return { exists: false, config: null, configHash: 'none', errors: [], path };
  const text = readFileSync(path, 'utf8');
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { exists: true, config: null, configHash: hashConfigText(text), errors: [`invalid JSON: ${e.message}`], path }; }
  const errors = validateConfig(raw);
  return { exists: true, config: errors.length ? null : normalizeConfig(raw), configHash: hashConfigText(text), errors, path };
}
