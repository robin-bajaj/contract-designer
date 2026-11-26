// PostgreSQL-compatible SQL types for our Neon/dbt proof of concept.
// dbt model contract types are adapter-specific, not a universal dbt enum.
export const DATA_TYPES = [
  'text','varchar','char','integer','smallint','bigint','numeric','decimal',
  'real','double precision','boolean','date','timestamp','timestamp with time zone',
  'time','time with time zone','uuid','json','jsonb','bytea'
]
// Other dbt metric kinds (ratio, derived, cumulative, conversion) require
// different schemas and must not be exported as if they were simple metrics.
export const METRIC_TYPES = ['simple']
export const SIMPLE_AGGREGATIONS = [
  'sum','count','count_distinct','average','min','max','median','sum_boolean'
]
const NUMERIC_SQL = /^(smallint|integer|int|bigint|numeric(?:\(\d+(?:,\s*\d+)?\))?|decimal(?:\(\d+(?:,\s*\d+)?\))?|real|double precision)$/
export function isNumericType(dataType) {return NUMERIC_SQL.test((dataType || '').trim().toLowerCase())}
export function metricAggregationError(metric, attributes) {
  if (!METRIC_TYPES.includes(metric.type || 'simple'))
    return 'Only simple metrics are supported by this logical contract editor.'
  if (!SIMPLE_AGGREGATIONS.includes(metric.agg || 'sum'))
    return `Aggregation ${metric.agg} is not supported by this editor.`
  const attr = attributes.find(a => a.name === metric.expr)
  if (!attr) return `Metric ${metric.name} references missing attribute ${metric.expr}.`
  if (['sum','average','median'].includes(metric.agg) && !isNumericType(attr.data_type))
    return `${metric.agg} metric ${metric.name} requires a numeric attribute.`
  if (metric.agg === 'sum_boolean' && attr.data_type !== 'boolean')
    return `sum_boolean metric ${metric.name} requires a boolean attribute.`
  return null
}
