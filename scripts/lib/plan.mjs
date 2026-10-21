// plan.json schema (Spec §8 `plan set`), hand-rolled.
import { createHash } from 'node:crypto';

export const RISK_FLAGS = ['auth', 'payment', 'pii', 'migration', 'security'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strArr = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim());

export function validatePlan(p) {
  const errs = [];
  if (!isObj(p)) return ['plan must be an object'];
  const keys = ['goal', 'constraints', 'nonGoals', 'acceptance', 'tasks', 'plannedFiles', 'riskFlags', 'howToRun', 'ui'];
  for (const k of Object.keys(p)) if (!keys.includes(k)) errs.push(`unknown key: ${k}`);
  if (typeof p.goal !== 'string' || !p.goal.trim()) errs.push('goal must be a non-empty string');
  for (const k of ['constraints', 'nonGoals', 'acceptance', 'plannedFiles', 'howToRun']) {
    if (p[k] !== undefined && !strArr(p[k])) errs.push(`${k} must be an array of non-empty strings`);
  }
  if (p.ui !== undefined && typeof p.ui !== 'boolean') errs.push('ui must be true or false (UI project: Web or iOS screens)');
  if (p.riskFlags !== undefined && !(strArr(p.riskFlags) && p.riskFlags.every((f) => RISK_FLAGS.includes(f)))) {
    errs.push(`riskFlags must be a subset of ${RISK_FLAGS.join(', ')}`);
  }
  if (!Array.isArray(p.tasks) || !p.tasks.length) errs.push('tasks must be a non-empty array');
  else {
    const seen = new Set();
    for (const [i, t] of p.tasks.entries()) {
      if (!isObj(t)) { errs.push(`tasks[${i}] must be an object`); continue; }
      for (const k of Object.keys(t)) if (!['id', 'title', 'acceptance', 'files', 'dependsOn'].includes(k)) errs.push(`unknown key: tasks[${i}].${k}`);
      if (typeof t.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(t.id)) errs.push(`tasks[${i}].id must be an identifier like T1`);
      else if (seen.has(t.id)) errs.push(`duplicate task id ${t.id}`);
      else seen.add(t.id);
      if (typeof t.title !== 'string' || !t.title.trim()) errs.push(`tasks[${i}].title must be a non-empty string`);
      if (!strArr(t.acceptance) || !t.acceptance.length) errs.push(`tasks[${i}].acceptance must list at least one criterion`);
      for (const k of ['files', 'dependsOn']) if (t[k] !== undefined && !strArr(t[k])) errs.push(`tasks[${i}].${k} must be a string array`);
    }
  }
  return errs;
}

export const hashPlan = (p) => createHash('sha256').update(JSON.stringify(p)).digest('hex');
