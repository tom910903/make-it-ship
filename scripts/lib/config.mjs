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
  unknownKeys(cfg, ['version', 'checks', 'required', 'limits', 'dependencyManifests', 'interview'], '', errs);
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
  return errs;
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
  };
}

/** Quick → required.quick; Standard/Full → required.standard; default → every defined check. */
export function requiredChecks(config, mode) {
  const key = mode === 'quick' ? 'quick' : 'standard';
  return config.required[key] ?? Object.keys(config.checks);
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
