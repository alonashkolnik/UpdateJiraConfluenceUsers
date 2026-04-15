import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ParseResult } from '../../shared/types';
import { mapColumns, processRows } from './column-mapper';

/**
 * Parse a CSV or Excel file and return structured data with validation.
 */
export function parseFile(filePath: string): ParseResult {
  const ext = path.extname(filePath).toLowerCase();

  let rawRows: Record<string, string>[];
  let headers: string[];

  if (ext === '.csv' || ext === '.tsv') {
    const result = parseCsv(filePath);
    rawRows = result.rows;
    headers = result.headers;
  } else if (ext === '.xlsx' || ext === '.xls') {
    const result = parseExcel(filePath);
    rawRows = result.rows;
    headers = result.headers;
  } else {
    return {
      rows: [],
      errors: [
        {
          rowIndex: 0,
          column: '',
          message: `Unsupported file format: ${ext}. Please use .csv, .tsv, .xlsx, or .xls`,
          severity: 'error',
        },
      ],
      detectedColumns: {},
      totalRows: 0,
    };
  }

  if (headers.length === 0) {
    return {
      rows: [],
      errors: [{ rowIndex: 0, column: '', message: 'File appears to be empty or has no headers', severity: 'error' }],
      detectedColumns: {},
      totalRows: 0,
    };
  }

  // Map columns
  const columnMapping = mapColumns(headers);

  // Process rows
  const { rows, errors } = processRows(rawRows, columnMapping);

  return {
    rows,
    errors,
    detectedColumns: columnMapping,
    totalRows: rawRows.length,
  };
}

function parseCsv(filePath: string): { headers: string[]; rows: Record<string, string>[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    trimHeaders: true,
    transformHeader: (h: string) => h.trim(),
  });

  const headers = result.meta.fields || [];
  return { headers, rows: result.data };
}

function parseExcel(filePath: string): { headers: string[]; rows: Record<string, string>[] } {
  // Use fs.readFileSync + buffer instead of XLSX.readFile to handle OneDrive-synced paths
  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const data: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  if (data.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = data[0].map((h) => (h || '').toString().trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every((c) => !c || c.toString().trim() === '')) continue; // skip empty rows

    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (row[j] || '').toString().trim();
    }
    rows.push(obj);
  }

  return { headers, rows };
}
