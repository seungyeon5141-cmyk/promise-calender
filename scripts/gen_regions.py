# regions.js 생성기
# 사용법: python3 scripts/gen_regions.py <southkorea-maps kostat/2013/json 폴더> regions.js
import json, math, sys, re
G = sys.argv[1]; OUT = sys.argv[2]
muni = json.load(open(G + '/skorea_municipalities_geo_simple.json'))
prov = json.load(open(G + '/skorea_provinces_geo_simple.json'))

PROV = {  # code: (정식 이름, 짧은 이름, 광역시 여부)
  '11': ('서울특별시', '서울', True), '21': ('부산광역시', '부산', True), '22': ('대구광역시', '대구', True),
  '23': ('인천광역시', '인천', True), '24': ('광주광역시', '광주', True), '25': ('대전광역시', '대전', True),
  '26': ('울산광역시', '울산', True), '29': ('세종특별자치시', '세종', True), '31': ('경기도', '경기', False),
  '32': ('강원특별자치도', '강원', False), '33': ('충청북도', '충북', False), '34': ('충청남도', '충남', False),
  '35': ('전북특별자치도', '전북', False), '36': ('전라남도', '전남', False), '37': ('경상북도', '경북', False),
  '38': ('경상남도', '경남', False), '39': ('제주특별자치도', '제주', False),
}
ORDER = ['11', '31', '23', '32', '29', '25', '33', '34', '22', '37', '21', '26', '38', '24', '35', '36', '39']

COS = math.cos(math.radians(36))
def proj(lng, lat): return ((lng - 124.5) * COS * 100, (38.7 - lat) * 100)

def rings(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    return [p[0] for p in polys]

def area_centroid(rs):
    A = cx = cy = 0
    for r in rs:
        for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]):
            c = x0 * y1 - x1 * y0
            A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    return (cx / (3 * A), cy / (3 * A), abs(A) / 2)

def dp(pts, tol):
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0
    for k in range(1, len(pts) - 1):
        d = abs(dy * pts[k][0] - dx * pts[k][1] + x1 * y0 - y1 * x0) / L
        if d > dmax: i, dmax = k, d
    if dmax <= tol: return [pts[0], pts[-1]]
    return dp(pts[:i + 1], tol)[:-1] + dp(pts[i:], tol)

def path(rs, tol, min_area):
    out = []
    for r in rs:
        pr = [proj(*p) for p in r]
        a = abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pr, pr[1:] + pr[:1]))) / 2
        if a < min_area: continue
        mid = len(pr) // 2  # 닫힌 고리는 시작=끝이라 반으로 나눠서 단순화
        s = dp(pr[:mid + 1], tol)[:-1] + dp(pr[mid:], tol)
        if len(s) < 3: continue
        out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in s) + 'Z')
    return ''.join(out).replace('.0,', ',').replace('.0L', 'L').replace('.0Z', 'Z')

groups = {}  # (prov, name) -> rings
for f in muni['features']:
    code, name = f['properties']['code'], f['properties']['name']
    p = code[:2]
    if p == '37' and name == '군위군': p = '22'
    if p == '23' and name == '남구': name = '미추홀구'
    if p == '33' and name == '청원군': name = '청주시'
    if p == '29': name = '세종시'
    if not PROV[p][2]:
        name = re.sub(r'^(.+?시).+구$', r'\1', name)  # 수원시장안구 → 수원시
    groups.setdefault((p, name), []).extend(rings(f['geometry']))

provinces = []
for p in ORDER:
    full, short, metro = PROV[p]
    regs = []
    for (pp, name), rs in groups.items():
        if pp != p: continue
        lng, lat, _ = area_centroid(rs)
        regs.append({'name': name, 'lat': round(lat, 4), 'lng': round(lng, 4), 'path': path(rs, 0.25, 0.3)})
    regs.sort(key=lambda r: r['name'])
    prs = [r for f in prov['features'] if f['properties']['code'] == p for r in rings(f['geometry'])]
    if p == '22':  # 군위군 편입
        prs += groups[('22', '군위군')]
    lng, lat, _ = area_centroid(prs)
    allp = [proj(*pt) for r in prs for pt in r]
    xs, ys = [q[0] for q in allp], [q[1] for q in allp]
    provinces.append({
        'code': p, 'name': full, 'short': short, 'metro': metro,
        'lat': round(lat, 4), 'lng': round(lng, 4),
        'bbox': [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)],
        'path': path(prs, 0.6, 2),
        'regions': regs,
    })

js = ('// 시·도 / 시·군·구 목록과 지도 모양 (통계청 2013 경계를 2026년 행정구역에 맞게 보정)\n'
      '// 지도 좌표: x = (경도 - 124.5) × cos36° × 100, y = (38.7 - 위도) × 100\n'
      '// 출처: southkorea/southkorea-maps (kostat 2013)\n'
      'export const PROVINCES = ' + json.dumps(provinces, ensure_ascii=False, separators=(',', ':')) + ';\n')
open(OUT, 'w').write(js)
print('bytes', len(js.encode()), 'regions', sum(len(p['regions']) for p in provinces))
for p in provinces: print(p['short'], len(p['regions']), [r['name'] for r in p['regions']][:6])
