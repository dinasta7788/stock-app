# アプリのアイコン(PNG)を作る。使い方: python tools/make_icons.py
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (20, 23, 28)
RED = (230, 57, 70)
FONT = "C:/Windows/Fonts/meiryob.ttc"


def make(size: int, safe: float) -> Image.Image:
    """safe: 文字と線を描く範囲の割合(maskable アイコンは端が切られるので小さめにする)"""
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = size * (1 - safe) / 2
    inner = size * safe
    # 右上がりの線
    pts = [(0.08, 0.80), (0.32, 0.62), (0.50, 0.70), (0.92, 0.30)]
    xy = [(pad + x * inner, pad + y * inner) for x, y in pts]
    d.line(xy, fill=RED, width=max(4, int(size * 0.045)), joint="curve")
    r = size * 0.035
    ex, ey = xy[-1]
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=RED)
    # 「株」の文字
    font = ImageFont.truetype(FONT, int(inner * 0.46))
    box = d.textbbox((0, 0), "株", font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text((pad + inner * 0.10 - box[0], pad + inner * 0.06 - box[1]), "株", font=font, fill=(240, 242, 245))
    return img


OUT.mkdir(exist_ok=True)
make(192, 0.86).save(OUT / "icon-192.png")
make(512, 0.86).save(OUT / "icon-512.png")
make(512, 0.66).save(OUT / "icon-maskable-512.png")
print("作成:", sorted(p.name for p in OUT.iterdir()))
