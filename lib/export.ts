/**
 * Serialising a set of records into every format that can honestly carry it.
 *
 * The planner exported JSON and NDJSON and nothing else, which meant "export"
 * quietly meant "export, if you happen to want JSON". This covers the formats a
 * person actually asks for, and the point of the exercise is the word *honestly*:
 * a format that cannot represent the data says so before it writes, rather than
 * writing something that looks complete and is not.
 *
 * That is the whole design. `describeLoss` is not a nicety attached to the
 * writers; it is why they can be offered at all. CSV cannot hold a nested object,
 * so a row with one either gets a flattened column or a JSON blob in a cell, and
 * the caller is told which before a file lands in somebody's downloads folder.
 */

export type ExportFormat = 'json' | 'jsonl' | 'yaml' | 'toml' | 'xml' | 'csv' | 'tsv' | 'markdown' | 'html' | 'sql' | 'schema';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'jsonl', 'csv', 'tsv', 'yaml', 'toml', 'xml', 'markdown', 'html', 'sql', 'schema'];

export type ExportRecord = Record<string, unknown>;

export const EXPORT_MEDIA: Readonly<Record<ExportFormat, { extension: string; type: string; label: string }>> = Object.freeze({
  json: { extension: 'json', type: 'application/json;charset=utf-8', label: 'JSON' },
  jsonl: { extension: 'jsonl', type: 'application/x-ndjson;charset=utf-8', label: 'JSON Lines' },
  csv: { extension: 'csv', type: 'text/csv;charset=utf-8', label: 'CSV' },
  tsv: { extension: 'tsv', type: 'text/tab-separated-values;charset=utf-8', label: 'TSV' },
  yaml: { extension: 'yaml', type: 'application/yaml;charset=utf-8', label: 'YAML' },
  toml: { extension: 'toml', type: 'application/toml;charset=utf-8', label: 'TOML' },
  xml: { extension: 'xml', type: 'application/xml;charset=utf-8', label: 'XML' },
  markdown: { extension: 'md', type: 'text/markdown;charset=utf-8', label: 'Markdown' },
  html: { extension: 'html', type: 'text/html;charset=utf-8', label: 'HTML' },
  sql: { extension: 'sql', type: 'application/sql;charset=utf-8', label: 'SQL' },
  schema: { extension: 'schema.json', type: 'application/schema+json;charset=utf-8', label: 'JSON Schema' },
});

const isPlain = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const columnsOf = (rows: readonly ExportRecord[]) => {
  const seen: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  return seen;
};

/**
 * What this format cannot carry, in words, before anything is written.
 *
 * An empty array means nothing is lost. Everything else is shown to the person
 * choosing the format, which is the only moment the information is useful.
 */
export function describeLoss(rows: readonly ExportRecord[], format: ExportFormat): string[] {
  const losses: string[] = [];
  const nested = columnsOf(rows).filter((column) => rows.some((row) => row[column] !== undefined && !isPlain(row[column])));

  if (['csv', 'tsv', 'markdown', 'html', 'sql'].includes(format) && nested.length) {
    losses.push(`${nested.join(', ')} ${nested.length === 1 ? 'holds' : 'hold'} structured values, which become JSON text inside a single cell`);
  }
  if (format === 'schema') {
    losses.push('a schema describes the shape of these records and contains none of the records themselves');
  }
  if (format === 'sql') {
    losses.push('column types are inferred from the values present, so an empty column is typed as text');
  }
  if (['csv', 'tsv'].includes(format) && rows.some((row) => columnsOf(rows).some((column) => row[column] === undefined))) {
    losses.push('a record missing a column is written as an empty cell, which is not the same as an empty value');
  }
  if (format === 'toml' && rows.some((row) => Object.values(row).some((value) => value === null))) {
    losses.push('TOML has no null, so a null value is omitted from its record');
  }
  return losses;
}

/* ---------------------------------------------------------------- writers -- */

const jsonText = (value: unknown) => JSON.stringify(value ?? null);

function delimited(rows: readonly ExportRecord[], separator: string): string {
  const columns = columnsOf(rows);
  const cell = (value: unknown) => {
    if (value === undefined) return '';
    const text = isPlain(value) ? String(value ?? '') : jsonText(value);
    // A separator, a quote or a newline inside a value has to be quoted, or the
    // file silently gains a column and every row after it is misaligned.
    return /["\n\r]/.test(text) || text.includes(separator) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(separator), ...rows.map((row) => columns.map((column) => cell(row[column])).join(separator))].join('\r\n') + '\r\n';
}

function yamlValue(value: unknown, indent: string): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : '\n' + value.map((item) => `${indent}- ${yamlValue(item, indent + '  ').replace(/^\n/, '')}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as ExportRecord);
    return entries.length === 0 ? '{}' : '\n' + entries.map(([key, item]) => `${indent}${key}: ${yamlValue(item, indent + '  ')}`).join('\n');
  }
  // Quoted always, so a value like `yes`, `null` or `12:30` cannot be read back
  // as a boolean, a null or a sexagesimal number.
  return JSON.stringify(String(value));
}

function tomlValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value !== null && typeof value === 'object') return JSON.stringify(jsonText(value));
  return JSON.stringify(String(value ?? ''));
}

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (character) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] as string);

/** A key that is safe as an XML element name; anything else becomes an attribute on a generic one. */
const xmlSafe = (key: string) => /^[A-Za-z_][\w.-]*$/.test(key);

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = isPlain(value) ? String(value) : jsonText(value);
  return `'${text.replaceAll("'", "''")}'`;
}

const sqlIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

function jsonSchema(rows: readonly ExportRecord[], name: string): string {
  const columns = columnsOf(rows);
  const typeOf = (column: string): string => {
    const values = rows.map((row) => row[column]).filter((value) => value !== undefined && value !== null);
    if (!values.length) return 'string';
    if (values.every((value) => typeof value === 'number')) return 'number';
    if (values.every((value) => typeof value === 'boolean')) return 'boolean';
    if (values.every((value) => Array.isArray(value))) return 'array';
    if (values.every((value) => typeof value === 'object')) return 'object';
    return 'string';
  };
  return JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: name,
    type: 'array',
    items: {
      type: 'object',
      properties: Object.fromEntries(columns.map((column) => [column, { type: typeOf(column) }])),
      // Only a column present in every record is required; one that is sometimes
      // absent is optional, which is a fact about the data rather than a guess.
      required: columns.filter((column) => rows.every((row) => row[column] !== undefined)),
    },
  }, null, 2) + '\n';
}

export type ExportOptions = {
  /** Names the table, the root element and the schema title. */
  name?: string;
  /** Written into the formats that can carry a comment, so a file says where it came from. */
  note?: string;
};

/** Serialise the records. The caller has already applied whatever filter is in play. */
export function exportRecords(rows: readonly ExportRecord[], format: ExportFormat, options: ExportOptions = {}): string {
  const name = options.name?.replace(/[^A-Za-z0-9_]/g, '_') || 'records';
  const note = options.note;
  const columns = columnsOf(rows);

  switch (format) {
    case 'json':
      return JSON.stringify(note ? { note, records: rows } : rows, null, 2) + '\n';
    case 'jsonl':
      return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    case 'csv':
      return delimited(rows, ',');
    case 'tsv':
      return delimited(rows, '\t');
    case 'yaml':
      return (note ? `# ${note}\n` : '') + (rows.length === 0 ? '[]\n'
        : rows.map((row) => '-' + Object.entries(row).map(([key, value], index) =>
            `${index === 0 ? ' ' : '\n  '}${key}: ${yamlValue(value, '    ')}`).join('')).join('\n') + '\n');
    case 'toml':
      return (note ? `# ${note}\n\n` : '') + rows.map((row) =>
        `[[${name}]]\n` + Object.entries(row)
          .filter(([, value]) => value !== null && value !== undefined)
          .map(([key, value]) => `${key} = ${tomlValue(value)}`).join('\n') + '\n').join('\n');
    case 'xml':
      return `<?xml version="1.0" encoding="UTF-8"?>\n${note ? `<!-- ${escapeXml(note)} -->\n` : ''}<${name}>\n` +
        rows.map((row) => '  <record>\n' + Object.entries(row).map(([key, value]) => {
          const text = escapeXml(isPlain(value) ? String(value ?? '') : jsonText(value));
          return xmlSafe(key)
            ? `    <${key}>${text}</${key}>\n`
            : `    <field name="${escapeXml(key)}">${text}</field>\n`;
        }).join('') + '  </record>\n').join('') + `</${name}>\n`;
    case 'markdown': {
      if (!columns.length) return (note ? `${note}\n\n` : '') + '_No records._\n';
      const cell = (value: unknown) => (isPlain(value) ? String(value ?? '') : jsonText(value)).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
      return (note ? `${note}\n\n` : '') +
        `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n` +
        rows.map((row) => `| ${columns.map((column) => cell(row[column])).join(' | ')} |`).join('\n') + '\n';
    }
    case 'html':
      return `<!doctype html>\n<meta charset="utf-8">\n<title>${escapeXml(name)}</title>\n` +
        (note ? `<p>${escapeXml(note)}</p>\n` : '') +
        `<table>\n  <thead><tr>${columns.map((column) => `<th>${escapeXml(column)}</th>`).join('')}</tr></thead>\n  <tbody>\n` +
        rows.map((row) => `    <tr>${columns.map((column) => {
          const value = row[column];
          return `<td>${escapeXml(isPlain(value) ? String(value ?? '') : jsonText(value))}</td>`;
        }).join('')}</tr>\n`).join('') + '  </tbody>\n</table>\n';
    case 'sql': {
      if (!columns.length) return (note ? `-- ${note}\n` : '') + '-- No records.\n';
      const type = (column: string) => {
        const values = rows.map((row) => row[column]).filter((value) => value !== undefined && value !== null);
        if (values.length && values.every((value) => typeof value === 'number')) return Number.isInteger(values[0] as number) ? 'INTEGER' : 'REAL';
        if (values.length && values.every((value) => typeof value === 'boolean')) return 'BOOLEAN';
        return 'TEXT';
      };
      return (note ? `-- ${note}\n` : '') +
        `CREATE TABLE ${sqlIdentifier(name)} (\n${columns.map((column) => `  ${sqlIdentifier(column)} ${type(column)}`).join(',\n')}\n);\n` +
        rows.map((row) => `INSERT INTO ${sqlIdentifier(name)} (${columns.map(sqlIdentifier).join(', ')}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(', ')});`).join('\n') + (rows.length ? '\n' : '');
    }
    case 'schema':
      return jsonSchema(rows, name);
  }
}

/** The filename an export lands as, with the date so a folder of them is orderable. */
export function exportFilename(name: string, format: ExportFormat, day: string): string {
  const safe = name.replace(/[^A-Za-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'export';
  return `${safe}-${day}.${EXPORT_MEDIA[format].extension}`;
}
