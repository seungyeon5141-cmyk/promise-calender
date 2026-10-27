# 모든 파일을 하나의 HTML로 합친 미리보기 페이지를 만든다 (외부 스크립트 파일을 못 불러오는 환경용)
# 사용법: python3 scripts/build_preview.py 출력.html
import re, sys
import os
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'
out = sys.argv[1]
def strip(js):
    js = re.sub(r"^import .*?;\n", "", js, flags=re.M)
    return re.sub(r"^export ", "", js, flags=re.M)
store = strip(open(src+'store.js').read())
names = re.findall(r"^export (?:async function|function|const) (\w+)", open(src+'store.js').read(), flags=re.M)
parts = [
  "window.PROMISE_CAL_MEMORY_ROUTER = true;",
  # 미리보기는 외부 서버에 접속할 수 없으므로 항상 체험 모드(빈 설정)로 만든다
  "const SUPABASE_URL = '';\nconst SUPABASE_ANON_KEY = '';",
  strip(open(src+'data.js').read()),
  strip(open(src+'regions.js').read()),
  "const store = (() => {\n" + store + "\nreturn { " + ", ".join(names) + " };\n})();",
  strip(open(src+'app.js').read()),
]
css = open(src+'style.css').read()
html = f"""<title>약속잡기</title>
<meta name="theme-color" content="#f6f1ff">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap">
<style>
{css}
</style>
<div id="app" class="page"></div>
<script>
{chr(10).join(parts)}
</script>
"""
open(out,'w').write(html)
print(names)
