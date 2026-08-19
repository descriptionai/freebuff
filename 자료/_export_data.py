# -*- coding: utf-8 -*-
"""엑셀 3종 → data/*.js 변환 (임시 도구)"""
import zipfile, re, os
from xml.etree import ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
P = '{http://schemas.openxmlformats.org/package/2006/relationships}'

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(BASE), 'data')
os.makedirs(OUT, exist_ok=True)

def load_grid(path):
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = {r.get('Id'): r.get('Target') for r in rels.findall(P + 'Relationship')}
    shared = []
    try:
        sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in sst.findall(M + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(M + 't')))
    except KeyError:
        pass
    grid = {}
    # 첫 번째 시트만 사용 (여러 시트를 병합하면 행 번호 충돌 발생)
    for sh in wb.find(M + 'sheets')[:1]:
        tgt = relmap.get(sh.get(R + 'id'), '')
        if not tgt.startswith('xl/'):
            tgt = 'xl/' + tgt.lstrip('/')
        root = ET.fromstring(z.read(tgt))
        data = root.find(M + 'sheetData')
        if data is None:
            continue
        for row in data.findall(M + 'row'):
            rn = int(row.get('r'))
            for c in row.findall(M + 'c'):
                m = re.match(r'([A-Z]+)(\d+)', c.get('r') or '')
                if not m:
                    continue
                col = 0
                for ch in m.group(1):
                    col = col * 26 + (ord(ch) - 64)
                col -= 1
                t = c.get('t')
                v = c.find(M + 'v')
                val = ''
                if v is not None:
                    val = v.text or ''
                    if t == 's':
                        try: val = shared[int(val)]
                        except (IndexError, ValueError): pass
                    elif t == 'b':
                        val = 'TRUE' if val == '1' else 'FALSE'
                else:
                    is_ = c.find(M + 'is')
                    if is_ is not None:
                        val = ''.join(t.text or '' for t in is_.iter(M + 't'))
                grid[(rn, col)] = val
    return grid

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def js_str(s):
    return json_dumps(str(s))

import json as _json
def json_dumps(o):
    return _json.dumps(o, ensure_ascii=False)

def to_time(v):
    """엑셀 일단위 소수 → 'HH:MM' (비숫자/빈값이면 그대로)"""
    n = num(v)
    if n is None:
        return str(v).strip()
    total_min = int(round(n * 24 * 60))
    if total_min >= 24 * 60:
        total_min %= 24 * 60
    return '%02d:%02d' % (total_min // 60, total_min % 60)

# ============================================================
# 1) 파일2: 직영단가표
# ============================================================
print('파일2 처리 중...')
g2 = load_grid(os.path.join(BASE, '(붙임1) `26년 우체국물류지원단 직영단가표.xlsx'))
dist2 = []
tables2 = [
    ('ride1', '1인 탑승'), ('ride2', '2인 탑승'),
    ('parcel1', '1인 낱소포'), ('parcel2', '2인 낱소포'), ('ship1', '1인 선편'),
]
B2 = {0: 2, 1: 12, 2: 22, 3: 32, 4: 42}  # 값 시작 컬럼
KM2 = {0: 1, 1: 11, 2: 21, 3: 31, 4: 41}  # km 컬럼
rows2 = {}
for rn in range(4, 71):
    km = num(g2.get((rn, KM2[0]), ''))
    if km is None:
        continue
    rows2[rn] = km
dist2 = [int(rows2[rn]) for rn in sorted(rows2)]
tables2_out = []
for i, (tid, tname) in enumerate(tables2):
    vals = []
    for rn in sorted(rows2):
        row = []
        for k in range(8):
            v = num(g2.get((rn, B2[i] + k), ''))
            row.append(round(v) if v is not None else None)
        vals.append(row)
    tables2_out.append({'id': tid, 'name': tname, 'values': vals})

with open(os.path.join(OUT, 'direct_rate_2026.js'), 'w', encoding='utf-8') as f:
    f.write('// 2026년 우체국물류지원단 직영단가표 (부가세 별도, 단위: 원)\n')
    f.write('// 출처: (붙임1) `26년 우체국물류지원단 직영단가표.xlsx\n')
    f.write('window.DIRECT_RATE_2026 = {\n')
    f.write('  label: "2026년 우체국물류지원단 직영단가표 (부가세 별도)",\n')
    f.write('  tonnages: ["1톤", "2.5톤", "4.5톤", "5톤", "8톤", "11톤", "18톤", "25톤"],\n')
    f.write('  distances: %s,\n' % json_dumps(dist2))
    f.write('  tables: %s\n' % json_dumps(tables2_out))
    f.write('};\n')
print('  → data/direct_rate_2026.js (%d개 거리구간)' % len(dist2))

# ============================================================
# 2) 파일3: 민간위탁 단가표
# ============================================================
print('파일3 처리 중...')
g3 = load_grid(os.path.join(BASE, '_2026년 민간위탁 단가내역(2026.4월 변경 적용).xlsx'))
def consignment_section(start_rn, sid, sname):
    dists, base, c25, c26 = [], [], [], []
    for rn in range(start_rn, start_rn + 80):
        km = num(g3.get((rn, 0), ''))
        if km is None:
            continue
        b, c2, c3 = [], [], []
        for k in range(8):
            b.append(round(num(g3.get((rn, 1 + k), ''))) if num(g3.get((rn, 1 + k), '')) is not None else None)
            c2.append(round(num(g3.get((rn, 11 + k), ''))) if num(g3.get((rn, 11 + k), '')) is not None else None)
            c3.append(round(num(g3.get((rn, 21 + k), ''))) if num(g3.get((rn, 21 + k), '')) is not None else None)
        dists.append(int(km)); base.append(b); c25.append(c2); c26.append(c3)
    return {'id': sid, 'name': sname, 'distances': dists,
            'base': base, 'contract_2025': c25, 'contract_2026': c26}

sections = [consignment_section(10, 'road', '육상일반'),
            consignment_section(76, 'parcel', '낱소포')]

with open(os.path.join(OUT, 'consignment_rate_2026.js'), 'w', encoding='utf-8') as f:
    f.write('// 2026년 민간위탁 단가내역 — 대전권역 (부가세 별도, 단위: 원)\n')
    f.write('// 출처: _2026년 민간위탁 단가내역(2026.4월 변경 적용).xlsx\n')
    f.write('// 3블록: base(원단가) → ×낙찰률 → contract_2025 → ×인상률 → contract_2026\n')
    f.write('window.CONSIGNMENT_RATE_2026 = {\n')
    f.write('  label: "2026년 민간위탁 단가내역 (대전권역, 부가세 별도)",\n')
    f.write('  tonnages: ["1.4톤", "2.5톤", "4.5톤", "5톤", "8톤", "11톤", "18톤", "25톤"],\n')
    f.write('  bid_rate: 0.78,       // 낙찰률 (2025.1.1 계약단가 = 원단가 × 0.78)\n')
    f.write('  inflation_rate: 1.0348, // 인상률 3.48% (2026.4.1 계약단가 = 2025 × 1.0348)\n')
    f.write('  sections: %s\n' % json_dumps(sections))
    f.write('};\n')
print('  → data/consignment_rate_2026.js (%d개 섹션)' % len(sections))

# ============================================================
# 3) 파일1: 수집운송환경 조사결과
# ============================================================
print('파일1 처리 중...')
g1 = load_grid(os.path.join(BASE, '(260723) (충청청) 수집운송환경 조사결과 (imc,대집).xlsx'))
survey_rows = []
# 데이터는 R8부터 (R2~R7은 제목/헤더)
for rn in range(8, 400):
    if num(g1.get((rn, 0), '')) is None:
        continue
    def gv(c):
        v = g1.get((rn, c), '')
        return v if v is not None else ''
    def gnum(c):
        v = num(g1.get((rn, c), ''))
        return v
    survey_rows.append({
        'no': gnum(0),
        'region': gv(1),
        'hq': gv(2),
        'name': gv(3),
        'type': gv(4),
        'addr': gv(5),
        'hub': gv(6),
        'mid_deadline': to_time(gv(7)),
        'final_deadline': to_time(gv(8)),
        'depart': to_time(gv(9)),
        'line': gv(10),
        'parcels': gnum(11),
        'letters': gnum(12),
        'containers': gnum(13),
        'mode': gv(14),          # 롤 / 낱소포
        'liftgate': gv(15),      # 리프트게이트 O/X
        'dock': gv(16),          # 발착설비
        'other_equip': gv(17),   # 기타 상차설비
        'max_ton': gv(18),       # 운송가능 최대톤급 (문자 — "18톤" 오타 포함)
        'side_door': gv(19),     # 측면도어 사용 상차
        'note': gv(20)
    })

with open(os.path.join(OUT, 'collection_survey.js'), 'w', encoding='utf-8') as f:
    f.write('// (충청청) 수집운송환경 조사결과 — 361개 관서 (수집편: 롤+낱소포만 적재, 평팔레트 미사용)\n')
    f.write('// 출처: (260723) (충청청) 수집운송환경 조사결과 (imc,대집).xlsx\n')
    f.write('// 시간(HH:MM)은 엑셀 일단위 소수를 변환한 값, "-"은 해당 없음\n')
    f.write('window.COLLECTION_SURVEY = %s;\n' % json_dumps(survey_rows))
print('  → data/collection_survey.js (%d개 관서)' % len(survey_rows))

print('\n완료!')
