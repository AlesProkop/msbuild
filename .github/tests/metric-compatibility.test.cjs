const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(
    process.env.DASHBOARD_HTML || path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const names = [
    'getMetricValue', 'toMs', 'cmpNum', 'platformOf', 'getSeries',
    'measuredSdkVersion', 'crankSdkVersion', 'fmtMs', 'cmpDiffChip',
    'cmpPlatformLabel', 'cmpEnsureLoaded', 'cmpRunMap', 'cmpAverageMap', 'cmpCompute'
];
// Load the real dashboard functions without chart libraries or startup network requests.
const definitions = names.map(name =>
    source.match(new RegExp(`^    function ${name}\\([^\\n]*\\}[^\\n]*$`, 'm'))?.[0]
    || source.match(new RegExp(`^    (?:async )?function ${name}\\([^]*?^    }`, 'm'))?.[0]
).filter(Boolean).join('\n');

function fixture() {
    const state = { datasets: [], cache: {} };
    const elements = Object.fromEntries([
        'cmpStatus', 'cmpTable', 'cmpBody', 'cmpNote', 'cmpSummaryLine',
        'cmpMetric', 'cmpADataset', 'cmpBDataset', 'cmpARun', 'cmpBRun', 'cmpBMode', 'cmpBDays'
    ].map(id => [id, { value: '', textContent: '', innerHTML: '', style: {} }]));
    const api = vm.runInNewContext(
        definitions + '\n({ cmpRunMap, cmpAverageMap, getSeries, cmpCompute })',
        { CMP: state, CMP_SEP: '\u241F', DATA: [], document: {
            getElementById(id) {
                assert.ok(elements[id], `Unexpected control: ${id}`);
                return elements[id];
            }
        }, console },
        { timeout: 1000 });
    return { api, state, elements };
}

function record(results, changes = {}) {
    return {
        date: '2026-09-29',
        scenario: 'orchard-core-warm-inc-build-mt-dotnet',
        perfstarCIBuildNumber: 'run',
        machineID: 'GOLDWIN',
        results,
        ...changes
    };
}

function value(results, metric = 'evaluation-time') {
    return fixture().api.cmpRunMap([record(results)], 'run', metric).values().next().value?.value;
}

test('legacy evaluation metrics remain readable', () => {
    assert.equal(value({ 'evaluation-time': 123 }), 123);
    assert.equal(value({ 'evaluation-time-pass1': 45 }, 'evaluation-time-pass1'), 45);
    assert.equal(value({ 'evaluation-time-pass5': 6 }, 'evaluation-time-pass5'), 6);
});

test('current evaluation metrics use the same UI selections', () => {
    assert.equal(value({ 'evaluation-time-metrics': 123 }), 123);
    assert.equal(value({ 'evaluation-time-pass1-metrics': 45 }, 'evaluation-time-pass1'), 45);
    assert.equal(value({ 'evaluation-time-pass5-metrics': 6 }, 'evaluation-time-pass5'), 6);
});

test('current values take precedence, including zero', () => {
    assert.equal(value({ 'evaluation-time': 900, 'evaluation-time-metrics': 100 }), 100);
    assert.equal(value({ 'evaluation-time': 900, 'evaluation-time-metrics': 0 }), 0);
    assert.equal(value({ 'evaluation-time': 900, 'evaluation-time-metrics': null }), 900);
});

test('missing and invalid values do not become zero-valued samples', () => {
    assert.equal(value(undefined), undefined);
    assert.equal(value({}), undefined);
    for (const missing of [null, undefined, '', ' ', 'invalid', NaN, Infinity]) {
        assert.equal(value({ 'evaluation-time-metrics': missing }), undefined);
        assert.equal(value({ 'evaluation-time': missing }), undefined);
    }
});

test('numeric strings and build-time metrics retain their behavior', () => {
    assert.equal(value({ 'evaluation-time-metrics': '12.5' }), 12.5);
    assert.equal(value({ 'build-time': 42 }, 'build-time'), 42);
    assert.equal(value({ 'build-time': 0 }, 'build-time'), 0);
});

test('a mixed-schema run averages only valid matching samples', () => {
    const records = [
        record({ 'evaluation-time': 10 }),
        record({ 'evaluation-time-metrics': 30 }),
        record({ 'evaluation-time-metrics': null }),
        record({ 'evaluation-time-metrics': 999 }, { perfstarCIBuildNumber: 'other' })
    ];
    const result = fixture().api.cmpRunMap(records, 'run', 'evaluation-time').values().next().value;
    assert.equal(result.value, 20);
    assert.equal(result.samples, 2);
});

test('date-window averages support both schemas and preserve the cutoff', () => {
    const records = [
        record({ 'evaluation-time-metrics': 50 }),
        record({ 'evaluation-time': 30 }, { date: '2026-09-28' }),
        record({ 'evaluation-time': 999 }, { date: '2026-09-27' }),
        record({ 'evaluation-time-metrics': '' })
    ];
    const result = fixture().api.cmpAverageMap(records, 1, 'evaluation-time').values().next().value;
    assert.equal(result.value, 40);
    assert.equal(result.samples, 2);
});

test('trend and MT series mix schemas without changing metadata or input order', () => {
    const records = [
        record({ 'evaluation-time-metrics': 30, 'exit-code': 0, 'dotnet-version': 'sdk' }),
        record({ 'evaluation-time': 10 }, { date: '2026-09-28' }),
        record({ 'evaluation-time-metrics': null }),
        record(undefined)
    ];
    const original = JSON.stringify(records);
    const series = fixture().api.getSeries(records[0].scenario, 'evaluation-time', records);
    assert.equal(series.length, 2);
    assert.equal(series[0].value, 10);
    assert.equal(series[1].value, 30);
    assert.equal(series[1].exitCode, 0);
    assert.equal(series[1].sdkVersion, 'sdk');
    assert.equal(JSON.stringify(records), original);
});

test('unavailable globbing metrics stay unavailable', () => {
    const records = [record({ 'evaluation-time-metrics': 123 })];
    const { api } = fixture();
    assert.equal(api.cmpRunMap(records, 'run', 'evaluation-time-globbing').size, 0);
    assert.equal(api.cmpAverageMap(records, 30, 'evaluation-time-globbing').size, 0);
    assert.equal(api.getSeries(records[0].scenario, 'evaluation-time-globbing', records).length, 0);
});

for (const mode of ['specific', 'latest', 'average']) {
    test(`reported OrchardCore comparison renders both platforms (${mode})`, async () => {
        const { api, state, elements } = fixture();
        const candidate = [
            record({ 'evaluation-time-metrics': 137168.10226 }, { perfstarCIBuildNumber: '20260929.4.s' }),
            record({ 'evaluation-time-metrics': 115681.2781806 }, {
                perfstarCIBuildNumber: '20260929.4.s', machineID: 'GOLDLIN'
            })
        ];
        const baseline = [
            record({ 'evaluation-time-metrics': 109597.92954 }, {
                date: '2026-09-25', perfstarCIBuildNumber: '20260925.7.t'
            }),
            record({ 'evaluation-time-metrics': 101939.968602 }, {
                date: '2026-09-25', perfstarCIBuildNumber: '20260925.7.t', machineID: 'GOLDLIN'
            })
        ];
        state.datasets = [
            { base: 'data/main', label: 'main' },
            { base: 'data/branches/perf-evaluation-cache-off', label: 'perf/evaluation-cache-off' }
        ];
        state.cache['data/main'] = {
            records: candidate, runs: [{ build: '20260929.4.s', date: '2026-09-29' }]
        };
        state.cache['data/branches/perf-evaluation-cache-off'] = {
            records: baseline, runs: [{ build: '20260925.7.t', date: '2026-09-25' }]
        };
        elements.cmpADataset.value = 'data/main';
        elements.cmpBDataset.value = 'data/branches/perf-evaluation-cache-off';
        elements.cmpARun.value = '20260929.4.s';
        elements.cmpBRun.value = '20260925.7.t';
        elements.cmpMetric.value = 'evaluation-time';
        elements.cmpBMode.value = mode;
        elements.cmpBDays.value = '30';
        await api.cmpCompute();
        assert.equal(elements.cmpStatus.textContent, '');
        assert.equal((elements.cmpBody.innerHTML.match(/<tr>/g) || []).length, 2);
        assert.ok(elements.cmpBody.innerHTML.includes('25.2%'));
        assert.ok(elements.cmpBody.innerHTML.includes('13.5%'));
        assert.equal(elements.cmpTable.style.display, '');

        elements.cmpMetric.value = 'evaluation-time-globbing';
        await api.cmpCompute();
        assert.equal(elements.cmpTable.style.display, 'none');
        assert.equal(elements.cmpNote.textContent, 'No scenarios had data on both sides for this metric.');
    });
}
