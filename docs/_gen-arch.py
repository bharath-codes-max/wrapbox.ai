import json, re
logos=json.load(open('docs/_logos.json'))
t=open('docs/_architecture.template.html').read()
missing=set()
def sub(m):
    k=m.group(1)
    if k in logos: return logos[k]
    missing.add(k); return ""
out=re.sub(r'\{\{logo:([a-z0-9_-]+)\}\}', sub, t)
open('docs/architecture.html','w').write(out)
print("generated", len(out)//1024, "KB; missing:", missing or "none")
