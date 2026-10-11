import { expect, test } from 'vitest';
import { csvRows } from './csvRows';

test('quoted commas, escaped quotes and multiline values remain in their cells', () => {
  expect(csvRows('name,note\r\n"Doe, Jane","He said ""hello""\nnext line"\r\n'))
    .toEqual([['name', 'note'], ['Doe, Jane', 'He said "hello"\nnext line']]);
});
test('keeps empty cells, blank records and zero values without a phantom final record', () => {
  expect(csvRows('\uFEFFa,b,c\r0,,\r\r')).toEqual([['a','b','c'],['0','',''],['']]);
  expect(csvRows(',,')).toEqual([['','','']]);
  expect(csvRows('')).toEqual([]);
});
test('retains literal HTML and spreadsheet formulas as data', () => {
  expect(csvRows('"<img onerror=alert(1)>",=1+2')).toEqual([['<img onerror=alert(1)>','=1+2']]);
});
