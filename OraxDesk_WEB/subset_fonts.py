from fontTools import subset
from fontTools.ttLib import TTFont
import os

fonts = ["Tajarib_Typeface_Regular.otf","Tajarib_Typeface_Medium.otf","Tajarib_Typeface_Bold.otf","Tajarib_Typeface_Light.otf"]
src_dir = "../ui/public/fonts"
dst_dir = "public/fonts"
os.makedirs(dst_dir, exist_ok=True)

unicode_ranges = [
    (0x0020,0x007E), (0x00A0,0x00FF), (0x0600,0x06FF), (0x0750,0x077F), (0x08A0,0x08FF), (0xFB50,0xFDFF), (0xFE70,0xFEFF), (0x2000,0x206F)
]
arabic = set()
for a,b in unicode_ranges:
    arabic.update(range(a,b+1))
latin = set(range(0x0020,0x007F)) | set(range(0x00A0,0x00FF))

for fname in fonts:
    src = os.path.join(src_dir, fname)
    if not os.path.exists(src):
        print("MISSING", src); continue
    base = fname.replace(".otf","")
    for label, cps in [("arabic", arabic), ("latin", latin)]:
        out = os.path.join(dst_dir, f"{base}-{label}.woff2")
        font = TTFont(src)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.with_zopfli = False
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=set(cps))
        sub.subset(font)
        font.save(out)
        kb = os.path.getsize(out)/1024
        print(f"{base}-{label}: {kb:.1f} KB")
    print(f"  orig: {os.path.getsize(src)/1024:.1f} KB")
