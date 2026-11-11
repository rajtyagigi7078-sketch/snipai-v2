"""Check imported MSVC DLL names against the app-local runtime manifest."""
import json
import re
import struct
import sys
from pathlib import Path


def imports(path):
    b = path.read_bytes()
    pe = struct.unpack_from('<I', b, 60)[0]
    count = struct.unpack_from('<H', b, pe+6)[0]
    size = struct.unpack_from('<H', b, pe+20)[0]
    opt = pe+24
    magic = struct.unpack_from('<H', b, opt)[0]
    dd = opt+(112 if magic == 0x20b else 96)
    rva = struct.unpack_from('<I', b, dd+8)[0]
    if not rva:
        return []
    sections = []
    for index in range(count):
        vs, va, rs, rp = struct.unpack_from('<IIII', b, opt+size+index*40+8)
        sections.append((va,max(vs,rs),rp))
    def offset(rva):
        for va,size,raw in sections:
            if va <= rva < va+size:
                return raw+rva-va
        return rva
    current=offset(rva)
    names=[]
    while any(b[current:current+20]):
        at=offset(struct.unpack_from('<I',b,current+12)[0])
        names.append(b[at:b.index(0,at)].decode())
        current+=20
    return names


if __name__ == '__main__':
    root=Path(sys.argv[1]).resolve()
    missing=[];required=set();count=0
    for file in root.rglob('*'):
        if file.suffix.lower() not in {'.dll','.pyd','.exe'} or file.name=='VC_redist.x64.exe':
            continue
        try:
            names=imports(file)
        except (ValueError,IndexError,struct.error):
            continue
        count+=1
        for name in names:
            if not re.match(r'^(msvcp|vcruntime|concrt|vcomp)\d+',name,re.I):
                continue
            required.add(name.lower())
            # Wheels such as NumPy deliberately rename and vendor their CRT.
            # Their .libs directory is registered by the bootstrap/package loader.
            if re.search(r'-[a-f0-9]{16,}\.dll$',name,re.I) and list(root.rglob(name)):
                continue
            for folder in ['python','node']:
                if not (root/folder/name).is_file():
                    missing.append({'importer':str(file.relative_to(root)),'dependency':name,'folder':folder})
    report={'pass':not missing,'pe_files':count,'msvc_required':sorted(required),'missing':missing}
    print(json.dumps(report,indent=2))
    sys.exit(0 if report['pass'] else 1)
