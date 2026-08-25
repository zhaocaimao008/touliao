#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""投聊 — 商店横幅 1024x500 + 宣传图 1280x720"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from gen_core import (C_PURPLE, C_PURPLE_L, C_PURPLE_D, C_NAVY, C_NAVY_M,
                      C_GOLD, C_GOLD_D, WHITE, FBOLD, FREG, font,
                      lin_gradient, radial_gradient, rounded_mask, glow, bubble)

OUT = "/root/touliao/design-assets"

# ── 商店横幅 1024x500 ──────────────────────────────────
def make_banner():
    w, h = 1024, 500
    bg = lin_gradient((w, h), C_PURPLE_D, C_PURPLE, 100).convert("RGBA")
    # 右上亮紫光晕
    bg = Image.alpha_composite(bg, glow((w, h), (int(w*0.95), 0), 320, C_PURPLE_L, 90))
    # 左下金光
    bg = Image.alpha_composite(bg, glow((w, h), (int(w*0.18), h), 260, C_GOLD_D, 60))

    # 右侧装饰气泡群
    deco = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(deco)
    bub = [(620, 70, 960, 330), (740, 200, 1010, 430), (560, 300, 840, 480)]
    for i, b in enumerate(bub):
        fill = (255, 255, 255, 26 if i != 1 else 40)
        bubble(d, b, 60, fill, tail=None)
    # 金色圆点
    for cx, cy, r in [(700, 150, 16), (850, 380, 12), (790, 260, 20)]:
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=C_GOLD + (230,))
    bg = Image.alpha_composite(bg, deco)

    # 图标
    icon = Image.open(f"{OUT}/app-icon-512.png")
    icon = icon.resize((200, 200), Image.Resampling.LANCZOS)
    bg.paste(icon, (60, 150), icon)

    # 文字
    d = ImageDraw.Draw(bg)
    f_name = font(FBOLD, 96)
    d.text((295, 118), "投聊", font=f_name, fill=WHITE)
    f_sub = font(FREG, 34)
    d.text((298, 240), "安全 · 私密 · 畅聊", font=f_sub, fill=(232, 224, 255))
    # 金色短句
    f_tag = font(FBOLD, 30)
    d.text((298, 305), "连接价值  畅聊未来", font=f_tag, fill=C_GOLD)
    bg.save(f"{OUT}/banner-store.png")
    print("banner-store")

# ── 宣传图 1280x720 ───────────────────────────────────
def make_promo():
    w, h = 1280, 720
    bg = radial_gradient((w, h), (w//2, int(h*0.30)), 0, int(h*0.9), C_NAVY_M, C_NAVY).convert("RGBA")
    # 巨型气泡轮廓(背景装饰)
    deco = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(deco)
    d.ellipse([w//2-330, 30, w//2+330, 690], outline=(138, 120, 235, 60), width=3)
    d.ellipse([w//2-210, 150, w//2+210, 570], outline=(138, 120, 235, 36), width=2)
    # 金色光芒(底部升起)
    bg = Image.alpha_composite(bg, glow((w, h), (w//2, int(h*1.02)), 380, C_GOLD_D, 55))
    bg = Image.alpha_composite(bg, glow((w, h), (w//2, int(h*0.35)), 420, C_PURPLE, 40))
    bg = Image.alpha_composite(bg, deco)

    # 中央图标
    icon = Image.open(f"{OUT}/app-icon-512.png").resize((180, 180), Image.Resampling.LANCZOS)
    bg.paste(icon, (w//2-90, int(h*0.13)), icon)

    d = ImageDraw.Draw(bg)
    # 品牌大字(金色渐变模拟: 画两层)
    f_name = font(FBOLD, 150)
    name = "投聊"
    nw = d.textlength(name, font=f_name)
    x = w//2 - nw/2
    d.text((x+3, int(h*0.40)+3), name, font=f_name, fill=(0, 0, 0, 120))  # 阴影
    d.text((x, int(h*0.40)), name, font=f_name, fill=C_GOLD)

    # 金色分隔线
    lw, ly = 90, int(h*0.575)
    d.rounded_rectangle([w//2-lw//2, ly, w//2+lw//2, ly+4], radius=2, fill=C_GOLD)

    # 标语
    f_tag = font(FREG, 44)
    tag = "连接价值 畅聊未来"
    tw = d.textlength(tag, font=f_tag)
    d.text((w//2 - tw/2, ly + 26), tag, font=f_tag, fill=(232, 224, 255))

    # 副标语
    f_sub = font(FREG, 30)
    s2 = "安全 · 私密 · 畅聊"
    sw = d.textlength(s2, font=f_sub)
    d.text((w//2 - sw/2, ly + 96), s2, font=f_sub, fill=(190, 180, 230))

    bg.save(f"{OUT}/promo-1280x720.png")
    print("promo-1280x720")

if __name__ == "__main__":
    make_banner()
    make_promo()
