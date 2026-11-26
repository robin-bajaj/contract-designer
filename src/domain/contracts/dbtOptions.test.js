import test from 'node:test'
import assert from 'node:assert/strict'
import { DATA_TYPES, SIMPLE_AGGREGATIONS, isNumericType, metricAggregationError } from './dbtOptions.js'
import { initialContracts } from './contractFixtures.test-data.js'
import { toContractDocument, validateContract } from './contracts.js'

test('Postgres types include existing CDO contract types and common dbt model types', () => {
  for (const type of ['text', 'integer', 'numeric', 'date', 'boolean', 'timestamp', 'varchar', 'jsonb'])
    assert.ok(DATA_TYPES.includes(type), type)
})
test('supported simple metric aggregations include dbt MetricFlow aggregates', () => {
  for (const agg of ['sum', 'count', 'count_distinct', 'average', 'min', 'max', 'median', 'sum_boolean'])
    assert.ok(SIMPLE_AGGREGATIONS.includes(agg), agg)
})
test('numeric aggregates require numeric columns and boolean aggregates require booleans', () => {
  const columns = [{ name: 'money', data_type: 'numeric(18,2)' }, { name: 'label', data_type: 'text' }, { name: 'flag', data_type: 'boolean' }]
  assert.equal(metricAggregationError({name:'x',type:'simple',agg:'sum',expr:'money'},columns),null)
  assert.equal(metricAggregationError({name:'x',type:'simple',agg:'median',expr:'label'},columns)?.includes('requires a numeric'),true)
  assert.equal(metricAggregationError({name:'x',type:'simple',agg:'sum_boolean',expr:'flag'},columns),null)
  assert.equal(metricAggregationError({name:'x',type:'simple',agg:'sum_boolean',expr:'money'},columns)?.includes('requires a boolean'),true)
  assert.equal(isNumericType('double precision'),true)
})
test('non-simple or unsupported metric kinds fail preflight instead of exporting inaccurate YAML', () => {
  const cols=[{name:'amount',data_type:'numeric'}]
  assert.match(metricAggregationError({name:'r',type:'ratio',expr:'amount',agg:'sum'},cols),/Only simple/)
  assert.match(metricAggregationError({name:'u',type:'simple',expr:'amount',agg:'unknown'},cols),/not supported/)
})
test('existing CDO metric serialization retains legacy fill nulls value despite removal from grid', () => {
  const root=initialContracts[0]
  const result=toContractDocument(root)
  assert.equal(result.metrics[0].fill_nulls_with,0)
  assert.deepEqual(validateContract(root,initialContracts),[])
})
