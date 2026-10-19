import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { summarize } from '../src/summarize.js';
import { render } from '../src/render.js';

test('pipeline', () => assert.equal(render(summarize(parse('name,amount\nb,2\na,1\nb,3'))), 'a: 1\nb: 5'));
