# -*- coding: utf-8 -*-
"""
학습·자동·결과·검증 슬라이드의 이미지 자리에 들어갈 삽화를 PIL로 생성한다.
(사용자 선택: 실제 사진 대신 삽화 이미지를 그려서 넣기)
- 학습_스파르타.png    : 스파르타 군인들이 컴퓨터를 둘러싸고 열정적으로 가르치는 모습
- 자동_무써기.png      : 사람이 도마 위에서 무를 칼로 채 써는 모습
- 결과_우체국행진.png  : 정장 여성 3명·남성 3명이 우체국으로 걸어가는 모습
- 검증_종이날림.png    : 컴퓨터 앞에서 종이를 작업하다 하나씩 날리는 모습
각 이미지는 PPT 배치 박스의 종횡비와 동일하게 렌더링한다 (2배 해상도).
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join("발표자료", "이미지")
os.makedirs(OUT, exist_ok=True)

NAVY = (12, 22, 56)
PANEL = (15, 29, 74)
SKIN = (226, 190, 150)
SKIN_DARK = (205, 168, 128)
HAIR = (38, 28, 22)
RED = (196, 36, 36)


def font(size, bold=False):
    try:
        path = "C:/Windows/Fonts/malgunbd.ttf" if bold else "C:/Windows/Fonts/malgun.ttf"
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path)
    print("SAVED:", path)


# --------------------------------------------------------------------------
# 1. 학습: 스파르타 군인 + 컴퓨터
# --------------------------------------------------------------------------

def draw_spartan(d, cx, base_y, s, target):
    """창백한 헬멧(붉은 벼슬) + 갑옷 + 붉은 망토의 스파르타 병사."""
    # 망토
    d.polygon([(cx - 20 * s, base_y - 78 * s), (cx + 10 * s, base_y - 46 * s),
               (cx - 8 * s, base_y - 4 * s)], fill=(176, 32, 32))
    # 다리
    d.rectangle([cx - 21 * s, base_y - 30 * s, cx - 6 * s, base_y - 2 * s], fill=(120, 92, 62))
    d.rectangle([cx + 6 * s, base_y - 30 * s, cx + 21 * s, base_y - 2 * s], fill=(120, 92, 62))
    # 갑옷(청동) + 허리띠
    d.rounded_rectangle([cx - 24 * s, base_y - 110 * s, cx + 24 * s, base_y - 28 * s],
                        12 * s, fill=(154, 114, 72), outline=(96, 72, 46), width=3)
    d.rectangle([cx - 24 * s, base_y - 56 * s, cx + 24 * s, base_y - 49 * s], fill=(62, 42, 26))
    # 머리(헬멧)
    d.ellipse([cx - 17 * s, base_y - 146 * s, cx + 17 * s, base_y - 112 * s],
              fill=(172, 182, 192), outline=(104, 114, 124), width=3)
    d.rectangle([cx - 11 * s, base_y - 134 * s, cx + 11 * s, base_y - 126 * s], fill=(30, 30, 36))
    # 붉은 벼슬
    d.rounded_rectangle([cx - 4 * s, base_y - 166 * s, cx + 4 * s, base_y - 144 * s],
                        3 * s, fill=RED)
    # 가르키는 팔
    dx, dy = target[0] - cx, (target[1] - 30) - base_y
    dist = math.hypot(dx, dy) or 1.0
    ax = cx + dx / dist * 40 * s
    ay = base_y - 96 * s + dy / dist * 40 * s
    d.line([(cx + 12 * s, base_y - 92 * s), (ax, ay)], fill=(154, 114, 72), width=int(7 * s))
    d.ellipse([ax - 8 * s, ay - 8 * s, ax + 8 * s, ay + 8 * s], fill=SKIN)


def scene_learn():
    W, H = 1325, 1109
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    d.ellipse([W * 0.15, H * 0.58, W * 0.85, H * 0.97], fill=(10, 18, 48))

    # 모니터
    mw, mh = 360, 250
    mx, my = (W - mw) // 2, int(H * 0.40)
    d.rounded_rectangle([mx, my, mx + mw, my + mh], 16, fill=(54, 62, 80),
                        outline=(130, 150, 180), width=4)
    d.rounded_rectangle([mx + 16, my + 16, mx + mw - 16, my + mh - 16], 8, fill=(20, 32, 62))
    codes = [(120, 200, 240), (160, 215, 250), (90, 185, 230), (200, 220, 250),
             (140, 205, 245), (110, 195, 238), (175, 215, 252), (130, 205, 245)]
    for i, c in enumerate(codes):
        y = my + 30 + i * 25
        d.rounded_rectangle([mx + 30, y, mx + 30 + random.randint(90, 220), y + 9], 3, fill=c)
    d.rectangle([mx + mw // 2 - 22, my + mh, mx + mw // 2 + 22, my + mh + 44], fill=(54, 62, 80))
    d.ellipse([mx + mw // 2 - 80, my + mh + 36, mx + mw // 2 + 80, my + mh + 70], fill=(54, 62, 80))

    # 스파르타 병사 4명이 모니터를 둘러쌈
    target = (W // 2, my + mh // 2)
    positions = [
        (W * 0.24, H * 0.80, 1.0),
        (W * 0.76, H * 0.80, 1.0),
        (W * 0.32, H * 0.60, 0.85),
        (W * 0.68, H * 0.60, 0.85),
    ]
    for cx, by, s in positions:
        draw_spartan(d, cx, by, s, target)

    # 열정 표시 (느낌표 + 별)
    f_big = font(46, bold=True)
    f_small = font(30, bold=True)
    d.text((W * 0.16, H * 0.40), "!", font=f_big, fill=(255, 217, 74))
    d.text((W * 0.80, H * 0.38), "!", font=f_big, fill=(255, 217, 74))
    for sx, sy in ((W * 0.20, H * 0.34), (W * 0.74, H * 0.30), (W * 0.50, H * 0.16)):
        d.text((sx, sy), "✦", font=f_small, fill=(255, 217, 74))
    save(img, "학습_스파르타.png")


# --------------------------------------------------------------------------
# 2. 자동: 도마 위 무 썰기
# --------------------------------------------------------------------------

def scene_auto():
    W, H = 1008, 778
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)

    # 조리대
    d.rectangle([0, int(H * 0.60), W, H], fill=(62, 46, 34))
    d.rectangle([0, int(H * 0.60), W, int(H * 0.62)], fill=(98, 76, 56))

    # 도마 (원근)
    d.polygon([(int(W * 0.06), int(H * 0.68)), (int(W * 0.94), int(H * 0.68)),
               (int(W * 0.82), int(H * 0.95)), (int(W * 0.18), int(H * 0.95))],
              fill=(205, 168, 112), outline=(150, 118, 76), width=3)
    d.line([(int(W * 0.12), int(H * 0.715)), (int(W * 0.88), int(H * 0.715))],
           fill=(232, 202, 152), width=2)

    # 무 (흰 통 + 꼬리 + 잎)
    rx0, ry0, rx1, ry1 = int(W * 0.14), int(H * 0.585), int(W * 0.56), int(H * 0.73)
    d.polygon([(rx0, ry0 + 26), (rx0 - 74, (ry0 + ry1) // 2), (rx0, ry1 - 26)],
              fill=(240, 244, 248), outline=(170, 180, 190), width=2)
    d.rounded_rectangle([rx0, ry0, rx1, ry1], 20, fill=(240, 244, 248),
                        outline=(170, 180, 190), width=2)
    for i, (dx, dy, rot) in enumerate([(30, -66, -25), (58, -60, 5), (44, -46, 30)]):
        lx, ly = rx1 + dx, ry0 + 12 + i * 26
        leaf = Image.new("RGBA", (80, 90), (0, 0, 0, 0))
        ld = ImageDraw.Draw(leaf)
        ld.polygon([(40, 84), (6, 10), (74, 10)], fill=(90, 160, 74))
        leaf = leaf.rotate(rot, resample=Image.BICUBIC, expand=True)
        img.paste(leaf, (int(lx - leaf.width / 2), int(ly - leaf.height / 2)), leaf)

    # 채 썬 무 조각 (날리는 것 포함)
    for i in range(14):
        px = random.randint(int(W * 0.16), int(W * 0.60))
        py = random.randint(int(H * 0.70), int(H * 0.86))
        d.rounded_rectangle([px, py, px + random.randint(8, 22), py + 4], 2,
                            fill=(245, 248, 250), outline=(180, 190, 200), width=1)

    # 칼 + 손
    kx, ky = int(W * 0.52), int(H * 0.52)
    d.polygon([(kx, ky), (kx + 96, ky + 22), (kx + 92, ky + 48), (kx - 6, ky + 28)],
              fill=(210, 218, 228), outline=(140, 150, 165), width=2)
    d.rectangle([kx - 26, ky + 18, kx - 6, ky + 40], fill=(120, 82, 44), outline=(80, 55, 30), width=2)
    d.ellipse([kx - 42, ky + 8, kx - 14, ky + 46], fill=SKIN, outline=SKIN_DARK, width=2)

    # 사람 (왼쪽, 몸통+머리, 칼을 쥔 팔)
    hx = int(W * 0.30)
    d.ellipse([hx - 34, int(H * 0.28), hx + 34, int(H * 0.50)], fill=SKIN)
    d.pieslice([hx - 34, int(H * 0.26), hx + 34, int(H * 0.50)], 180, 360, fill=HAIR)
    d.rounded_rectangle([hx - 78, int(H * 0.50), hx + 78, int(H * 0.78)], 24,
                        fill=(70, 110, 150), outline=(50, 80, 115), width=3)
    d.line([(hx + 70, int(H * 0.54)), (kx - 30, ky + 20)], fill=SKIN, width=16)
    d.ellipse([kx - 34, ky + 30, kx - 18, ky + 46], fill=SKIN)

    # 썰기 동작선
    for a0, a1 in ((200, 250), (205, 255)):
        d.arc([kx - 60, ky - 60, kx + 40, ky + 60], a0, a1, fill=(200, 214, 235), width=4)
    save(img, "자동_무써기.png")


# --------------------------------------------------------------------------
# 3. 결과: 우체국으로 걸어가는 정장 6명 (여3·남3)
# --------------------------------------------------------------------------

def draw_person(d, cx, base_y, s, female):
    suit = (56, 62, 84) if female else (42, 48, 70)
    leg = (30, 32, 44)
    # 다리/치마
    if female:
        d.polygon([(cx - 17 * s, base_y - 36 * s), (cx + 17 * s, base_y - 36 * s),
                   (cx + 11 * s, base_y - 2 * s), (cx - 11 * s, base_y - 2 * s)], fill=suit)
        d.rectangle([cx - 13 * s, base_y - 2 * s, cx - 6 * s, base_y + 7 * s], fill=SKIN)
        d.rectangle([cx + 6 * s, base_y - 2 * s, cx + 13 * s, base_y + 7 * s], fill=SKIN)
    else:
        d.rectangle([cx - 15 * s, base_y - 30 * s, cx - 6 * s, base_y], fill=leg)
        d.rectangle([cx + 6 * s, base_y - 30 * s, cx + 15 * s, base_y], fill=leg)
    # 상체(정장) + 팔
    d.rounded_rectangle([cx - 18 * s, base_y - 82 * s, cx + 18 * s, base_y - 30 * s],
                        7 * s, fill=suit, outline=(26, 30, 46), width=2)
    d.rectangle([cx - 23 * s, base_y - 78 * s, cx - 18 * s, base_y - 40 * s], fill=suit)
    d.rectangle([cx + 18 * s, base_y - 78 * s, cx + 23 * s, base_y - 40 * s], fill=suit)
    # 머리 + 헤어
    d.ellipse([cx - 12 * s, base_y - 104 * s, cx + 12 * s, base_y - 80 * s], fill=SKIN)
    if female:
        d.ellipse([cx - 13 * s, base_y - 107 * s, cx + 13 * s, base_y - 88 * s], fill=HAIR)
        d.ellipse([cx - 6 * s, base_y - 114 * s, cx + 6 * s, base_y - 100 * s], fill=HAIR)
    else:
        d.pieslice([cx - 13 * s, base_y - 107 * s, cx + 13 * s, base_y - 84 * s],
                   180, 360, fill=HAIR)


def scene_result():
    W, H = 1181, 259
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    d.rectangle([0, H - 26, W, H], fill=(8, 14, 34))

    # 우체국 건물
    bx, by, bw, bh = 22, 40, 205, 150
    d.rectangle([bx, by + 55, bx + bw, by + bh], fill=(236, 236, 229),
                outline=(92, 92, 84), width=2)
    d.polygon([(bx - 22, by + 62), (bx + bw + 22, by + 62), (bx + bw, by + 18), (bx, by + 18)],
              fill=(142, 80, 62), outline=(92, 52, 42), width=2)
    d.rounded_rectangle([bx + 72, by + 122, bx + 133, by + bh], 7, fill=(98, 64, 46))
    for wx in (bx + 26, bx + 60, bx + 110, bx + 144):
        d.rectangle([wx, by + 76, wx + 26, by + 100], fill=(150, 196, 226), outline=(90, 130, 160), width=2)
    # 간판
    sign = Image.new("RGBA", (150, 42), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sign)
    sd.rounded_rectangle([0, 0, 149, 41], 8, fill=(240, 240, 235), outline=(90, 90, 84), width=2)
    f = font(24, bold=True)
    sd.text((75, 21), "우체국", font=f, fill=(60, 50, 90), anchor="mm")
    img.paste(sign, (bx + (bw - 150) // 2, by + 20), sign)

    # 정장 6명 (앞 3명 여성, 뒤 3명 남성) — 건물 방향(왼쪽)으로 이동
    for i in range(6):
        female = i < 3
        cx = W - 70 - i * 92
        draw_person(d, cx, H - 24, 0.72, female)
    save(img, "결과_우체국행진.png")


# --------------------------------------------------------------------------
# 4. 검증: 컴퓨터 앞 종이 작업, 종이가 하나씩 날림
# --------------------------------------------------------------------------

def paper(img, cx, cy, w, h, rot):
    layer = Image.new("RGBA", (w + 20, h + 20), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle([0, 0, w - 1, h - 1], 4, fill=(236, 239, 244),
                         outline=(150, 160, 176), width=2)
    for ly in (7, 13):
        ld.line([(6, ly), (w - 8, ly)], fill=(182, 192, 208), width=2)
    rot_layer = layer.rotate(rot, resample=Image.BICUBIC, expand=True)
    img.paste(rot_layer, (int(cx - rot_layer.width / 2), int(cy - rot_layer.height / 2)), rot_layer)


def scene_check():
    W, H = 1037, 778
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)

    # 책상
    d.rectangle([0, int(H * 0.74), W, H], fill=(44, 36, 54))
    d.rectangle([0, int(H * 0.72), W, int(H * 0.75)], fill=(72, 60, 82))

    # 모니터
    mw, mh = 310, 215
    mx, my = (W - mw) // 2, int(H * 0.40)
    d.rounded_rectangle([mx, my, mx + mw, my + mh], 16, fill=(54, 62, 80),
                        outline=(130, 150, 180), width=4)
    d.rounded_rectangle([mx + 15, my + 15, mx + mw - 15, my + mh - 15], 8, fill=(20, 32, 62))
    for i in range(5):
        y = my + 26 + i * 26
        d.rounded_rectangle([mx + 26, y, mx + 26 + random.randint(80, 200), y + 8], 3,
                            fill=(120, 200, 240))
    d.rectangle([mx + mw // 2 - 20, my + mh, mx + mw // 2 + 20, my + mh + 40], fill=(54, 62, 80))
    d.ellipse([mx + mw // 2 - 70, my + mh + 34, mx + mw // 2 + 70, my + mh + 64], fill=(54, 62, 80))

    # 사람 (뒷모습, 모니터를 바라봄)
    px, py = W // 2, int(H * 0.90)
    d.rounded_rectangle([px - 95, py - 78, px + 95, py + 6], 26, fill=(46, 52, 74),
                        outline=(30, 34, 52), width=3)
    d.ellipse([px - 34, py - 150, px + 34, py - 82], fill=HAIR)
    d.ellipse([px - 26, py - 144, px + 26, py - 94], fill=SKIN)
    d.rounded_rectangle([px - 42, py - 108, px + 42, py - 40], 16, fill=(46, 52, 74))
    d.rectangle([px - 88, py - 60, px - 46, py + 4], fill=(46, 52, 74))
    d.rectangle([px + 46, py - 60, px + 88, py + 4], fill=(46, 52, 74))

    # 책상 위 종이 몇 장
    for (cx, cy, w, h, r) in [(W * 0.26, H * 0.82, 150, 60, 6), (W * 0.40, H * 0.84, 150, 60, -8)]:
        paper(img, cx, cy, w, h, r)

    # 날아가는 종이 (하나씩)
    for (cx, cy, w, h, r) in [
        (W * 0.36, H * 0.46, 150, 60, -20),
        (W * 0.24, H * 0.28, 145, 58, 15),
        (W * 0.62, H * 0.34, 150, 60, -30),
        (W * 0.50, H * 0.16, 145, 58, 10),
    ]:
        paper(img, cx, cy, w, h, r)

    # 날림 동작선
    for (x0, y0, x1, y1) in [(W * 0.30, H * 0.52, W * 0.28, H * 0.42),
                             (W * 0.28, H * 0.34, W * 0.26, H * 0.24),
                             (W * 0.58, H * 0.40, W * 0.56, H * 0.30)]:
        d.line([(x0, y0), (x1, y1)], fill=(150, 165, 195), width=3)
    save(img, "검증_종이날림.png")


if __name__ == "__main__":
    scene_learn()
    scene_auto()
    scene_result()
    scene_check()
    print("ALL DONE")
