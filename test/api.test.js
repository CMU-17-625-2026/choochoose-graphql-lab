import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { getIntrospectionQuery } from 'graphql';
import { runQuery, MAX_SEAT_CALLS, schemaSource } from '../api.js';
import { createApp } from '../server.js';

const starter = readFileSync(new URL('../public/starter.graphql', import.meta.url), 'utf8');
const related = starter.replace('service { id disruptions { summary updatedAt } }', `service {
  id disruptions { summary updatedAt }
  journeys(date: "2026-11-12") { id legs { seats { class available observedAt } } }
}`);
const search = 'journeys(from:"PIT", to:"PHL", date:"2026-11-12")';

test('schema and starter remain identical to the worksheet', t => {
  const path = new URL('../../../slides/07-choochoose-exercise.md', import.meta.url);
  if (!existsSync(path)) return t.skip('Course checkout integration check; worksheet is outside this standalone repository.');
  const worksheet = readFileSync(path, 'utf8');
  const blocks = [...worksheet.matchAll(/```graphql\n([\s\S]*?)```/g)].map(m => m[1].trim());
  assert.equal(starter.trim(), blocks[0]);
  assert.equal(schemaSource.trim(), blocks.at(-1));
});
test('traveler query returns the requested data and models 120 calls', () => {
  const { status, result } = runQuery({ query: starter });
  assert.equal(status, 200);
  assert.equal(result.errors, undefined);
  assert.equal(result.data.journeys.length, 40);
  assert.equal(result.data.journeys[0].legs.length, 3);
  assert.equal(result.data.journeys[0].legs[0].from.name, 'Pittsburgh');
  assert.equal(result.data.journeys[0].legs[0].seats.length, 2);
  assert.equal(result.extensions.work.modeledSeatServiceCalls, 120);
  assert.equal(result.extensions.work.exceedsExerciseBudget, false);
  assert.equal(result.extensions.work.completed, true);
});
test('one extra service traversal completes and models 28,920 calls', () => {
  const { result } = runQuery({ query: related });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.journeys[0].legs[0].service.journeys.length, 80);
  assert.equal(result.extensions.work.modeledSeatServiceCalls, 28_920);
  assert.equal(result.extensions.work.exceedsExerciseBudget, true);
  assert.equal(result.extensions.work.completed, true);
});
test('selections, fragments, aliases, variables, directives and operation names affect actual work', () => {
  const query = `query Seats($date: Date!, $show: Boolean!) {
    journeys(from:"PIT", to:"PHL", date:$date) {
      legs { ...Seats ...Seats seats @include(if:$show) { class } other: seats @include(if:$show) { available } }
    }
  }
  fragment Seats on Leg { seats { available } }
  query Names { ${search} { legs { from { name } } } }`;
  let r = runQuery({ query, variables: { date: '2026-11-12', show: false }, operationName: 'Seats' }).result;
  assert.equal(r.errors, undefined);
  assert.equal(r.extensions.work.modeledSeatServiceCalls, 120, 'repeated fragment references merge');
  r = runQuery({ query, variables: { date: '2026-11-12', show: true }, operationName: 'Seats' }).result;
  assert.equal(r.extensions.work.modeledSeatServiceCalls, 240, 'an alias is a separate resolver call');
  r = runQuery({ query, operationName: 'Names' }).result;
  assert.equal(r.extensions.work.modeledSeatServiceCalls, 0);
});
test('invalid fields and first are rejected before execution', () => {
  for (const query of [`{ ${search} { nodes { id } } }`, '{ journeys(from:"PIT",to:"PHL",date:"2026-11-12",first:2){id} }']) {
    const { status, result } = runQuery({ query });
    assert.equal(status, 400);
    assert.ok(result.errors.length);
    assert.equal(result.extensions, undefined);
  }
});
test('invalid dates and variable shapes fail, and unknown searches return no journeys', () => {
  assert.equal(runQuery({ query: `{ journeys(from:"PIT",to:"PHL",date:"2026-02-30"){id} }` }).status, 400);
  assert.equal(runQuery({ query: starter, variables: [] }).status, 400);
  assert.equal(runQuery({ query: starter, variables: 3 }).status, 400);
  assert.ok(runQuery({ query: 'query Q($d: Date!){ journeys(from:"PIT",to:"PHL",date:$d){id} }', variables: { d: false } }).result.errors);
  assert.equal(runQuery({ query: starter.replace('2026-11-12', '2026-11-13') }).result.data.journeys.length, 0);
});
test('introspection is available to GraphQL clients', () => {
  const { result } = runQuery({ query: getIntrospectionQuery() });
  assert.equal(result.errors, undefined);
  assert.ok(result.data.__schema.types.some(t => t.name === 'Journey'));
});
test('recursive traversal stops safely and marks the count incomplete', () => {
  const query = `{ ${search} { legs { service { journeys(date:"2026-11-12") {
    legs { service { journeys(date:"2026-11-12") { legs { seats { available } } } } }
  } } } } }`;
  const { result } = runQuery({ query });
  assert.equal(result.extensions.work.sandboxLimitReached, true);
  assert.equal(result.extensions.work.completed, false);
  assert.ok(result.extensions.work.modeledSeatServiceCalls <= MAX_SEAT_CALLS);
  assert.equal(result.errors[0].extensions.code, 'SANDBOX_LIMIT');
  assert.equal(result.data, null);
  assert.equal(runQuery({ query: starter }).result.extensions.work.modeledSeatServiceCalls, 120, 'counters are per-request');
});
test('HTTP editor, schema, health, JSON errors, CORS, and size limits', async t => {
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}`;
  for (const path of ['/', '/app.js', '/style.css', '/schema.graphql', '/starter.graphql', '/health']) {
    assert.equal((await fetch(url + path)).status, 200, path);
  }
  let response = await fetch(url + '/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: starter }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await response.json()).extensions.work.modeledSeatServiceCalls, 120);
  response = await fetch(url + '/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(response.status, 400);
  response = await fetch(url + '/graphql', { method: 'POST', body: '{}' });
  assert.equal(response.status, 415);
  response = await fetch(url + '/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: ' '.repeat(17_000) }) });
  assert.equal(response.status, 413);
  assert.equal((await fetch(url + '/graphql', { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(url + '/graphql', { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(url + '/missing')).status, 404);
});
