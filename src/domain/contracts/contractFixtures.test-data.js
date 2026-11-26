// Legacy sample definitions retained only as test fixtures; never displayed in the GitHub catalog.
export const initialContracts = [
  {
    id: 'cdo.all', name: 'cdo.all', version: 1, description: 'Enterprise business dictionary. Logical definitions only; not a dbt model.', uses: null,
    attributes: [
      { name: 'position_id', data_type: 'text', description: 'Position identifier' },
      { name: 'report_date', data_type: 'date', description: 'Business reporting date' },
      { name: 'profit_loss', data_type: 'numeric', description: 'Standardized profit and loss' },
      { name: 'instrument_code', data_type: 'integer', description: 'Financial instrument identifier' },
      { name: 'counterparty_id', data_type: 'text', description: 'Unique identifier of a counterparty' },
      { name: 'counterparty_name', data_type: 'text', description: 'Legal or business name of a counterparty' },
      { name: 'counterparty_type', data_type: 'text', description: 'Business classification of the counterparty' },
    ],
    metrics: [{ name: 'total_profit_loss', description: 'Total position profit and loss', type: 'simple', agg: 'sum', expr: 'profit_loss', fill_nulls_with: 0 }],
    include: null,
  },
  { id: 'cdo.position', name: 'cdo.position', version: 1, description: 'Logical Position business concept.', uses: { name: 'cdo.all', version: 1 }, attributes: [], metrics: [], include: { attributes: ['position_id', 'report_date', 'profit_loss', 'instrument_code'], metrics: ['total_profit_loss'] } },
  { id: 'cdo.counterparty', name: 'cdo.counterparty', version: 1, description: 'Logical Counterparty business concept.', uses: { name: 'cdo.all', version: 1 }, attributes: [], metrics: [], include: { attributes: ['counterparty_id', 'counterparty_name', 'counterparty_type'], metrics: [] } },
]
