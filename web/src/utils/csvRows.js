// CSV fields can contain delimiters, line breaks and escaped double quotes.
// Keep values as text; React renders them without interpreting HTML or formulas.
export function csvRows(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  if (!text) return [];
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || value === '') quoted = !quoted;
      else value += char;
    } else if (!quoted && char === ',') { row.push(value); value = ''; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      row.push(value); rows.push(row); row = []; value = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else value += char;
  }
  if (value !== '' || row.length || !/[\r\n]$/.test(text)) { row.push(value); rows.push(row); }
  return rows;
}
