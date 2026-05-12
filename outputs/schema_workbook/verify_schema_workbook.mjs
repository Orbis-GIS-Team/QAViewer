import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const input = await FileBlob.load('C:/dev/QAViewer/outputs/schema_workbook/QAViewer_Database_Dictionary.xlsx');
const workbook = await SpreadsheetFile.importXlsx(input);
const sheets = await workbook.inspect({ kind: 'sheet', include: 'name', maxChars: 4000 });
console.log(sheets.ndjson);
const overview = await workbook.inspect({ kind: 'table', range: 'Overview!A1:H20', tableMaxRows: 20, tableMaxCols: 8, maxChars: 6000 });
console.log(overview.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, maxChars: 1000 });
console.log(errors.ndjson);
