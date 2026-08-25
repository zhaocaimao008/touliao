#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""投聊品牌视觉设计系统 v1 — 图标 / 启动画面 / 横幅 / 宣传图"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

OUT = "/root/touliao/design-assets"
os.makedirs(OUT, exist_ok=True)

# ── 品牌色 ─────────────────────────────────────────────
C_PURPLE   = (106, 87, 221)    # 6A57DD 主紫
C_PURPLE_L = (138, 120, 235)   # 8A78EB 亮紫
C_PURPLE_D = (75, 59, 184)     # 4B3BB8 深紫
C_NAVY     = (20, 25, 43)      # 14192B 深蓝
C_NAVY_M   = (35, 42, 77)      # 232A4D 中蓝
C_WEB_NAVY = (26, 32, 51)      # 1A2033 web splash 底
C_GOLD     = (240, 192, 96)    # F0C060 金
C_GOLD_D   = (232, 166, 60)    # E8A63C 深金
WHITE = (255, 255, 255)

FBOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FREG  = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

def font(path, size, idx=2):
    return ImageFont.truetype(path, size, index=idx)

# ── 基础绘制工具 ───────────────────────────────────────
def lin_gradient(size, c1, c2, angle_deg=135):
    """线性渐变 c1→c2, angle 为渐变方向(0=右, 90=下); 支持 RGB/RGBA"""
    w, h = size
    a = np.radians(angle_deg)
    ux, uy = np.cos(a), np.sin(a)
    # 沿法线方向插值(取对角线投影保证覆盖全图)
    diag = abs(w * ux) + abs(h * uy)
    yy, xx = np.mgrid[0:h, 0:w]
    t = (xx * ux + yy * uy) / max(diag, 1)
    t = np.clip(t, 0, 1)
    c1a, c2a = np.array(c1, float), np.array(c2, float)
    grad = (c1a[None, None, :] * (1 - t[..., None]) + c2a[None, None, :] * t[..., None])
    mode = "RGBA" if len(c1) == 4 else "RGB"
    return Image.fromarray(grad.astype(np.uint8), mode)

def radial_gradient(size, center, r_inner, r_outer, c_inner, c_outer):
    """径向渐变: 中心 c_inner 到边缘 c_outer"""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2)
    t = np.clip((d - r_inner) / max(r_outer - r_inner, 1), 0, 1)
    ci, co = np.array(c_inner, float), np.array(c_outer, float)
    grad = ci[None, None, :] * (1 - t[..., None]) + co[None, None, :] * t[..., None]
    return Image.fromarray(grad.astype(np.uint8), "RGB")

def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m

def glow(shape, pos, rad, color, alpha):
    """高斯模糊光晕层(叠加用)"""
    layer = Image.new("RGBA", shape, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([pos[0] - rad, pos[1] - rad, pos[0] + rad, pos[1] + rad], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(rad * 0.45))

def bubble(draw, box, radius, fill, outline=None, width=0, tail="bl"):
    """圆角气泡 + 可选小三角尾巴 tail: bl=左下 br=右下"""
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    if tail:
        x0, y0, x1, y1 = box
        if tail == "bl":
            tri = [(x0 + 14, y1 - 6), (x0 + 34, y1 - 6), (x0 + 6, y1 + 22)]
        else:
            tri = [(x1 - 14, y1 - 6), (x1 - 34, y1 - 6), (x1 - 6, y1 + 22)]
        draw.polygon(tri, fill=fill)

# ── 1. App 图标 ────────────────────────────────────────
def make_icon(size=512):
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    r = int(s * 0.225)

    # 渐变底
    base = lin_gradient((s, s), C_PURPLE, C_PURPLE_L, 135).convert("RGBA")
    # 加深底部(立体感)
    shade = lin_gradient((s, s), (0, 0, 0, 0), C_PURPLE_D + (110,), 45).convert("RGBA")
    base = Image.alpha_composite(base, shade)
    # 顶部高光
    hi = lin_gradient((s, s), (255, 255, 255, 130), (255, 255, 255, 0), 90 + 180).convert("RGBA")
    base = Image.alpha_composite(base, hi)
    # 圆角裁剪
    mask = rounded_mask((s, s), r)
    img = Image.composite(base, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask)

    # 内阴影(仅底部)
    inner = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(inner)
    d.rounded_rectangle([0, int(s * 0.55), s - 1, s - 1], radius=r, fill=(0, 0, 0, 130))
    inner = inner.filter(ImageFilter.GaussianBlur(s * 0.05))
    img = Image.alpha_composite(img, inner)

    # 气泡元素(白色)
    overlay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    u = s / 512.0
    # 副气泡(右上, 略小)
    bubble(d, [int(242*u), int(148*u), int(438*u), int(272*u)], int(46*u), WHITE + (246,), tail="br")
    # 主气泡(左下, 大)
    bubble(d, [int(74*u), int(196*u), int(330*u), int(368*u)], int(50*u), WHITE, tail="bl")

    # 金色三圆点(主气泡内)
    dots = [(int(140*u), int(282*u)), (int(220*u), int(282*u)), (int(300*u), int(282*u))]
    dr = int(24*u)
    for i, c in enumerate(dots):
        r0 = dr if i == 1 else int(17*u)
        d.ellipse([c[0]-r0, c[1]-r0, c[0]+r0, c[1]+r0], fill=C_GOLD)
        # 圆点高光
        d.ellipse([c[0]-r0*0.55, c[1]-r0*0.65, c[0]+r0*0.25, c[1]+r0*0.15], fill=(255, 230, 170, 200))
    img = Image.alpha_composite(img, overlay)

    # 全局轻微外发光(视觉提亮)
    return img

# ── 2. 启动画面 ────────────────────────────────────────
def make_splash(w, h, icon_size, tag="连接价值 畅聊未来"):
    # 径向渐变背景
    bg = radial_gradient((w, h), (w // 2, int(h * 0.42)), 0, int(h * 0.95), C_NAVY_M, C_NAVY)
    bg = bg.convert("RGBA")
    # 顶部微弱紫晕
    bg = Image.alpha_composite(bg, glow((w, h), (w // 2, int(h * 0.18)), int(w * 0.5), C_PURPLE, 46))
    # 底部金色光芒
    bg = Image.alpha_composite(bg, glow((w, h), (w // 2, int(h * 0.98)), int(w * 0.42), C_GOLD_D, 42))

    # 图标(带柔光)
    icon = make_icon(icon_size)
    ic_pos = (w // 2 - icon_size // 2, int(h * 0.26))
    halo = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(halo)
    d.ellipse([w//2 - icon_size*0.75, ic_pos[1] + icon_size*0.1 - icon_size*0.75,
               w//2 + icon_size*0.75, ic_pos[1] + icon_size*0.1 + icon_size*0.75],
              fill=C_PURPLE + (70,))
    halo = halo.filter(ImageFilter.GaussianBlur(icon_size * 0.22))
    bg = Image.alpha_composite(bg, halo)
    bg.paste(icon, ic_pos, icon)

    # 品牌字
    d = ImageDraw.Draw(bg)
    name_size = int(h * 0.052)
    f_name = font(FBOLD, name_size)
    name = "投聊"
    bw = d.textlength(name, font=f_name)
    d.text((w // 2 - bw / 2, ic_pos[1] + icon_size + int(h * 0.045)), name,
           font=f_name, fill=WHITE)

    # 金色分隔短线
    line_w = int(w * 0.06)
    line_y = ic_pos[1] + icon_size + int(h * 0.085)
    d.rounded_rectangle([w//2 - line_w//2, line_y, w//2 + line_w//2, line_y + max(int(h*0.0028), 2)],
                        radius=2, fill=C_GOLD)

    # 标语
    f_tag = font(FREG, int(h * 0.024))
    tw = d.textlength(tag, font=f_tag)
    d.text((w // 2 - tw / 2, line_y + int(h * 0.016)), tag, font=f_tag, fill=(226, 216, 255, 235))

    # 顶部星点
    import random
    random.seed(7)
    for _ in range(26):
        x = random.randint(0, w)
        y = random.randint(0, int(h * 0.16))
        rr = random.randint(1, 3)
        a = random.randint(40, 110)
        d.ellipse([x, y, x + rr * 2, y + rr * 2], fill=(255, 255, 255, a))
    return bg

# ── 生成 ───────────────────────────────────────────────
def main():
    # 1. 图标(1024 主源 + 512 + 192)
    for sz in (1024, 512, 192):
        make_icon(sz).save(f"{OUT}/app-icon-{sz}.png")
        print("icon", sz)

    # 2. Android splash 1080x1920
    make_splash(1080, 1920, 330).save(f"{OUT}/splash-android.png")
    print("splash-android")

    # 3. iOS splash 1170x2532
    make_splash(1170, 2532, 360).save(f"{OUT}/splash-ios.png")
    print("splash-ios")

    # 4. Web splash 背景 1440x900
    make_splash(1440, 900, 200, tag="安全 · 私密 · 畅聊").save(f"{OUT}/splash-web.png")
    print("splash-web")

if __name__ == "__main__":
    main()
