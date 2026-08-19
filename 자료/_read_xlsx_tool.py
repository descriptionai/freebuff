# -*- coding: utf-8 -*-
"""xlsx 읽기 도구 (표준 라이브러리만 사용) — 임시"""
import sys, zipfile, re, datetime
from xml.etree import ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
P = '{http://schemas.openxmlformats.org/package/2006/relationships}'

def read_xlsx(path, max_rows=100000, raw=False):
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = {r.get('Id'): r.get('Target') for r in rels.findall(P + 'Relationship')}
    sheets = []
    for sh in wb.find(M + 'sheets'):
        name = sh.get('name')
        rid = sh.get(R + 'id')
        tgt = relmap.get(rid, '')
        if not tgt.startswith('xl/'):
            tgt = 'xl/' + tgt.lstrip('/')
        sheets.append((name, tgt))

    # shared strings
    shared = []
    try:
        sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in sst.findall(M + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(M + 't')))
    except KeyError:
        pass

    # date formats
    date_fmt_ids = set(range(14, 23)) | {45, 46, 47}
    cell_xfs = []
    try:
        styles = ET.fromstring(z.read('xl/styles.xml'))
        nf = styles.find(M + 'numFmts')
        if nf is not None:
            for f in nf:
                if re.search(r'[ymdhs]', f.get('formatCode') or '', re.I):
                    date_fmt_ids.add(int(f.get('numFmtId')))
        cx = styles.find(M + 'cellXfs')
        if cx is not None:
            cell_xfs = [x.get('numFmtId') for x in cx]
    except KeyError:
        pass

    def parse_cell(c):
        t = c.get('t')
        st = c.get('s')
        v = c.find(M + 'v')
        if v is None:
            is_ = c.find(M + 'is')
            if is_ is not None:
                return ''.join(t.text or '' for t in is_.iter(M + 't'))
            return ''
        val = v.text or ''
        if t == 's':
            try:
                return shared[int(val)]
            except (IndexError, ValueError):
                return val
        if t == 'b':
            return 'TRUE' if val == '1' else 'FALSE'
        if t == 'str':
            return val
        try:
            num = float(val)
        except ValueError:
            return val
        fmt = ''
        if st is not None:
            try:
                idx = int(st)
                fmt = cell_xfs[idx] if idx < len(cell_xfs) else ''
            except (ValueError, IndexError):
                fmt = ''
        if not raw and fmt and int(fmt) in date_fmt_ids:
            try:
                dt = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=num)
                return dt.strftime('%Y-%m-%d')
            except (OverflowError, ValueError):
                return val
        if num.is_integer() and abs(num) < 1e15:
            return str(int(num))
        return val

    for name, target in sheets:
        root = ET.fromstring(z.read(target))
        data = root.find(M + 'sheetData')
        print('\n===== SHEET: %s =====' % name)
        if data is None:
            print('(empty)')
            continue
        rows = []
        for row in data.findall(M + 'row'):
            cells = {}
            for c in row.findall(M + 'c'):
                m = re.match(r'([A-Z]+)(\d+)', c.get('r') or '')
                if not m:
                    continue
                col = 0
                for ch in m.group(1):
                    col = col * 26 + (ord(ch) - 64)
                cells[col - 1] = parse_cell(c)
            if cells:
                rows.append(cells)
        if not rows:
            print('(empty)')
            continue
        maxc = max(max(r.keys()) for r in rows) + 1
        print('(rows=%d, cols=%d)' % (len(rows), maxc))
        for i, r in enumerate(rows[:max_rows]):
            vals = []
            for j in range(maxc):
                vals.append(str(r.get(j, '')).replace('\n', '\\n'))
            while vals and vals[-1] == '':
                vals.pop()
            print('R%d: %s' % (i + 1, ' | '.join(vals)))

if __name__ == '__main__':
    raw = len(sys.argv) > 3 and sys.argv[3] == 'raw'
    read_xlsx(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 100000, raw)
