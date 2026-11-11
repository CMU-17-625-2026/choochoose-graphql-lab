const $ = id => document.getElementById(id);
let starter = '';
let fullResponse = '';
$('endpoint').value = `${location.origin}/graphql`;

Promise.all([
  fetch('/starter.graphql').then(r => { if (!r.ok) throw new Error(); return r.text(); }),
  fetch('/schema.graphql').then(r => { if (!r.ok) throw new Error(); return r.text(); }),
]).then(([query, schema]) => {
  starter = query;
  $('query').value = query;
  $('schema').textContent = schema;
  $('run').disabled = false;
}).catch(() => { $('status').textContent = 'Could not load the starter and schema. Reload to retry.'; });

$('reset').addEventListener('click', () => {
  $('query').value = starter;
  $('variables').value = '{}';
  $('operation').value = '';
  $('query').focus();
});
$('copy-endpoint').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('endpoint').value);
    $('copy-status').textContent = 'Copied';
  } catch { $('endpoint').select(); $('copy-status').textContent = 'Select and copy the URL.'; }
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([fullResponse], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'choochoose-response.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function run() {
  if ($('run').disabled) return;
  $('run').disabled = true;
  $('status').textContent = 'Running query…';
  $('work').className = 'work';
  $('count').textContent = '—';
  $('budget').textContent = 'Waiting for this request.';
  $('download').disabled = true;
  $('preview-note').hidden = true;
  $('result').textContent = '';
  try {
    let variables;
    try { variables = JSON.parse($('variables').value || '{}'); }
    catch { throw new Error('Variables must be valid JSON.'); }
    if (!variables || Array.isArray(variables) || typeof variables !== 'object') throw new Error('Variables must be a JSON object.');
    const response = await fetch('/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: $('query').value, variables, operationName: $('operation').value.trim() || undefined }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    fullResponse = JSON.stringify(payload, null, 2);
    $('result').textContent = fullResponse.slice(0, 50_000);
    $('preview-note').hidden = fullResponse.length <= 50_000;
    $('download').disabled = false;
    $('status').textContent = payload.errors?.length
      ? `HTTP ${response.status} · ${payload.errors[0].message}` : `HTTP ${response.status} · Query completed.`;
    const work = payload.extensions?.work;
    if (work) {
      $('count').textContent = work.modeledSeatServiceCalls.toLocaleString();
      $('work').className = `work${!work.completed ? ' incomplete' : work.exceedsExerciseBudget ? ' over' : ''}`;
      $('budget').textContent = !work.completed
        ? 'Incomplete execution: this is work performed before stopping, not the full query cost.'
        : work.exceedsExerciseBudget
          ? 'Over the 200-call exercise budget. The candidate API still executes it.'
          : 'Within the 200-call exercise budget.';
    } else { $('budget').textContent = 'The request was rejected before execution.'; }
  } catch (error) {
    $('status').textContent = error.name === 'TimeoutError' ? 'Request timed out. Try a smaller query.' : error.message;
    $('budget').textContent = 'No completed work count is available.';
  } finally { $('run').disabled = false; }
}
$('run').addEventListener('click', run);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
});
