import { describe, it, expect } from 'vitest';
import { classify } from './attachmentType';

describe('classify（附件格式判定，供 FilePreview 复用）', () => {
  it('PDF：mime 或扩展名任一命中即可', () => {
    expect(classify('application/pdf', 'x.pdf')).toBe('pdf');
    expect(classify('', '报告.pdf')).toBe('pdf');
    expect(classify('application/pdf', '无扩展名')).toBe('pdf');
  });
  it('Word/Excel/PPT 按标准 OOXML mime 或扩展名识别', () => {
    expect(classify('', 'a.docx')).toBe('docx');
    expect(classify('', 'a.xlsx')).toBe('xlsx');
    expect(classify('', 'a.xls')).toBe('xlsx');
    expect(classify('', 'a.pptx')).toBe('pptx');
  });
  it('文本类：txt/md/csv/log/json 或 text/* mime', () => {
    expect(classify('', 'a.txt')).toBe('text');
    expect(classify('', 'a.md')).toBe('text');
    expect(classify('', 'a.csv')).toBe('text');
    expect(classify('text/plain', 'noext')).toBe('text');
  });
  it('旧版二进制 doc/ppt、压缩包等一律归为 generic（明确不支持App内预览）', () => {
    expect(classify('application/msword', 'old.doc')).toBe('generic');
    expect(classify('application/vnd.ms-powerpoint', 'old.ppt')).toBe('generic');
    expect(classify('application/zip', 'a.zip')).toBe('generic');
    expect(classify('', 'a.rar')).toBe('generic');
  });
});
