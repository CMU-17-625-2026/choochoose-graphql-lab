import { readFileSync } from 'node:fs';
import {
  buildSchema, defaultFieldResolver, executeSync, GraphQLError,
  Kind, parse, validate, visit,
} from 'graphql';

export const schemaSource = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
export const schema = buildSchema(schemaSource);
export const DEMO_DATE = '2026-11-12';
export const EXERCISE_BUDGET = 200;
// Hosting guardrails are deliberately separate from the exercise's proposed budget.
export const MAX_SEAT_CALLS = 50_000;
const MAX_FIELDS = 400_000;
const observedAt = `${DEMO_DATE}T14:00:00Z`;
const stations = [
  { id: 'PIT', name: 'Pittsburgh' }, { id: 'HBG', name: 'Harrisburg' },
  { id: 'LNC', name: 'Lancaster' }, { id: 'PHL', name: 'Philadelphia' },
];

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new GraphQLError('Date must be a valid YYYY-MM-DD string.');
  }
  return value;
}
const date = schema.getType('Date');
date.serialize = dateValue;
date.parseValue = dateValue;
date.parseLiteral = node => {
  if (node.kind !== Kind.STRING) throw new GraphQLError('Date must be a YYYY-MM-DD string.');
  return dateValue(node.value);
};

function service(number) {
  return {
    id: `S-${String(number + 1).padStart(2, '0')}`,
    disruptions: number % 4 === 0 ? [{ summary: 'Signal fault: allow extra travel time.', updatedAt: observedAt }] : [],
    journeys: ({ date }) => date === DEMO_DATE
      ? Array.from({ length: 80 }, (_, i) => journey(`S${number + 1}-J${i + 1}`, i, number)) : [],
  };
}
function journey(id, index, requiredService) {
  // Related itineraries all include the requested service in the first leg.
  const serviceNumbers = [0, 1, 2].map(leg =>
    leg === 0 && requiredService !== undefined ? requiredService : (index + leg) % 12);
  return {
    id,
    fares: [{ name: 'Standard', price: 45 + index % 20 }, { name: 'Flexible', price: 65 + index % 20 }],
    legs: () => serviceNumbers.map((number, leg) => ({
      from: stations[leg], to: stations[leg + 1], service: () => service(number),
      seats: () => [
        { class: 'Standard', available: 5 + (index + leg) % 30, observedAt },
        { class: 'First', available: (index + leg) % 8, observedAt },
      ],
    })),
  };
}
const rootValue = {
  journeys: ({ from, to, date }) => from === 'PIT' && to === 'PHL' && date === DEMO_DATE
    ? Array.from({ length: 40 }, (_, i) => journey(`J-${String(i + 1).padStart(3, '0')}`, i)) : [],
};

// Wrap all resolvers, including introspection, so arbitrary selections remain bounded.
for (const type of Object.values(schema.getTypeMap())) {
  if (!('getFields' in type)) continue;
  for (const [name, field] of Object.entries(type.getFields())) {
    const resolve = field.resolve ?? defaultFieldResolver;
    field.resolve = (source, args, context, info) => {
      if (context.stopped) throw context.stopped;
      if (context.resolvedFields >= MAX_FIELDS ||
          (type.name === 'Leg' && name === 'seats' && context.seatCalls >= MAX_SEAT_CALLS)) {
        context.stopped = new GraphQLError(
          'Sandbox execution limit reached. Simplify the query. This hosting guardrail is separate from the 200-call exercise budget.',
          { extensions: { code: 'SANDBOX_LIMIT' } },
        );
        throw context.stopped;
      }
      context.resolvedFields++;
      if (type.name === 'Leg' && name === 'seats') context.seatCalls++;
      return resolve(source, args, context, info);
    };
  }
}

function errorsResult(message) {
  return { errors: [{ message }] };
}

export function runQuery(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.query !== 'string') {
    return { status: 400, result: errorsResult('Send a JSON object with a query string.') };
  }
  if (body.variables != null && (typeof body.variables !== 'object' || Array.isArray(body.variables))) {
    return { status: 400, result: errorsResult('variables must be a JSON object.') };
  }
  if (body.operationName != null && typeof body.operationName !== 'string') {
    return { status: 400, result: errorsResult('operationName must be a string.') };
  }
  let document;
  try {
    document = parse(body.query, { maxTokens: 3000 });
    let depth = 0;
    visit(document, { SelectionSet: {
      enter() { if (++depth > 20) throw new GraphQLError('Sandbox queries may nest at most 20 selection sets.'); },
      leave() { depth--; },
    } });
    const errors = validate(schema, document, undefined, { maxErrors: 10 });
    if (errors.length) return { status: 400, result: { errors } };
    if (document.definitions.some(d => d.kind === Kind.OPERATION_DEFINITION && d.operation !== 'query')) {
      return { status: 400, result: errorsResult('This sandbox supports queries only.') };
    }
  } catch (error) {
    return { status: 400, result: { errors: [error] } };
  }
  const contextValue = { seatCalls: 0, resolvedFields: 0, stopped: null };
  const result = executeSync({ schema, document, rootValue, contextValue,
    variableValues: body.variables, operationName: body.operationName });
  result.extensions = { work: {
    modeledSeatServiceCalls: contextValue.seatCalls,
    exerciseBudget: EXERCISE_BUDGET,
    exceedsExerciseBudget: contextValue.seatCalls > EXERCISE_BUDGET,
    completed: !contextValue.stopped && !result.errors,
    sandboxLimitReached: Boolean(contextValue.stopped),
    note: 'One modeled call per Leg.seats resolver invocation; no remote calls, caching, or batching. Counts are not latency measurements. Incomplete runs show work performed before stopping.',
  } };
  return { status: result.data === undefined && result.errors ? 400 : 200, result };
}
