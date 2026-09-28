#!/usr/bin/env python3
"""投聊品牌图标全平台生成脚本（唯一母版：assets/brand/touliao/master/touliao-icon-master.png）。

只做尺寸适配、格式转换、透明背景处理、安全区调整、单色转换；不改变 T / 聊天气泡 / 上升箭头 / 紫金配色。
用法：python3 assets/brand/touliao/generate.py   （在仓库根目录执行，依赖 Pillow）
"""
import json
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
KIT = os.path.join(ROOT, 'assets', 'brand', 'touliao')
MASTER_ORIGINAL = os.path.join(KIT, 'master', 'touliao-icon-master.png')   # 原始母版（备份，不直接使用）
MASTER = os.path.join(KIT, 'master', 'touliao-master-clean.png')          # 唯一出图源：已清除左下角孤立杂点

# 母版几何（由 alpha>20 连通域分析得到）：主体包围盒与离主体中心最远点（气泡尾部）半径
BODY = (99, 86, 1190, 1162)
BODY_RADIUS = 727.1

BG_CENTER = (42, 18, 80)     # 深紫黑径向渐变：中心
BG_EDGE = (18, 7, 32)        # 深紫黑径向渐变：边缘  #120720
SPLASH_BG = '#140A24'
LIGHT_BG = (244, 246, 250)   # 浅色背景版（与现有浅色界面底色一致）
GOLD = (245, 198, 106)


def out(rel, im, **kw):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, **kw)
    return p


# 光学尺寸（optical size）：小尺寸不做机械缩小。按「主体实际渲染尺寸」选择简化级别：
#   xs (≤21px)：隐藏柱状图，保留 T + 气泡 + 上升箭头；
#   s  (≤30px)：只留最高一根柱子（极简柱状图）；
#   m  (≤50px)：完整柱状图；
#   以上三级都去掉淡外发光、压低过曝高光、缩小前轻微平滑、缩小后轻微锐化。
#   >50px：干净母版直接高质量缩小。
BARS = [(676, 868, 780), (780, 790, 890), (900, 722, 1010)]   # 三根柱子 (x0, 顶端, x1)，母版像素坐标
RING_EDGE = [(660, 1040), (780, 1022), (880, 992), (960, 968), (1020, 945)]  # 柱子底部与气泡圆环的分界


def _ring_limit(x):
    for (x0, y0), (x1, y1) in zip(RING_EDGE, RING_EDGE[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return RING_EDGE[-1][1]


def _load_master(keep_bars=(0, 1, 2), optical=False):
    im = Image.open(MASTER).convert('RGBA')
    if optical:
        px = im.load()
        W, H = im.size
        for i, (x0, top, x1) in enumerate(BARS):
            if i in keep_bars:
                continue
            for x in range(x0, x1 + 1):
                for y in range(top, int(_ring_limit(x))):
                    px[x, y] = (0, 0, 0, 0)
        for y in range(H):
            for x in range(W):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                if a < 60:                      # 去掉淡外发光，小尺寸边缘更干净
                    px[x, y] = (0, 0, 0, 0)
                elif 0.299 * r + 0.587 * g + 0.114 * b > 215:   # 压低过曝高光
                    px[x, y] = (int(r * 0.86), int(g * 0.86), int(b * 0.86), a)
    bx0, by0, bx1, by1 = BODY
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    side = int(math.ceil(2 * BODY_RADIUS)) + 8          # 以主体中心为圆心、能容纳最远点的正方形
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, (int(round(side / 2 - cx)), int(round(side / 2 - cy))), im)
    return canvas.convert('RGBa'), side                 # 预乘 alpha：缩放不产生黑边/紫边


_LEVELS = {}


def _level(name):
    if name not in _LEVELS:
        if name == 'full':
            _LEVELS[name] = _load_master()
        elif name == 'xs':
            _LEVELS[name] = _load_master(keep_bars=(), optical=True)
        elif name == 's':
            _LEVELS[name] = _load_master(keep_bars=(2,), optical=True)
        else:
            _LEVELS[name] = _load_master(optical=True)
    return _LEVELS[name]


EMBLEM = _load_master()[0].convert('RGBA')
EM_SIDE = EMBLEM.size[0]


def optical_level(radius_px):
    eff = 2 * radius_px / 0.97          # 主体等效图标尺寸（px）
    return 'xs' if eff <= 21 else 's' if eff <= 30 else 'm' if eff <= 50 else 'full'


def emblem_for_radius(canvas_px, radius_px, level=None):
    """缩放主体，使最远点半径 = radius_px，返回放在 canvas_px 透明画布中央的图层。"""
    level = level or optical_level(radius_px)
    src, side = _level(level)
    n = max(1, int(round(side * radius_px / BODY_RADIUS)))
    if level == 'full':
        em = src.resize((n, n), Image.LANCZOS)
    else:
        p = src.filter(ImageFilter.GaussianBlur(4 if level != 'm' else 3))
        f = max(1, side // (n * 4))
        if f > 1:
            p = p.reduce(f)
        em = p.resize((n, n), Image.LANCZOS)
    em = em.convert('RGBA')
    if level != 'full':
        rgb = em.convert('RGB')
        if level == 'xs':   # 最小一级：适度提高对比/饱和，让金色 T 与紫色气泡分开（经 16/20px 对比选定，未改配色方向）
            from PIL import ImageEnhance
            rgb = ImageEnhance.Color(ImageEnhance.Contrast(rgb).enhance(1.25)).enhance(1.15)
            rgb = rgb.filter(ImageFilter.UnsharpMask(radius=0.5, percent=50, threshold=1))
        else:
            rgb = rgb.filter(ImageFilter.UnsharpMask(radius=0.5, percent=40 if level != 'm' else 30, threshold=2))
        a = em.getchannel('A')
        em = rgb.convert('RGBA')
        em.putalpha(a)
    layer = Image.new('RGBA', (canvas_px, canvas_px), (0, 0, 0, 0))
    off = (canvas_px - n) // 2
    if off >= 0:
        layer.alpha_composite(em, (off, off))
    else:
        layer.alpha_composite(em.crop((-off, -off, -off + canvas_px, -off + canvas_px)))
    return layer


def radial_bg(s, center=BG_CENTER, edge=BG_EDGE):
    big = 256
    g = Image.new('RGB', (big, big))
    p = g.load()
    for y in range(big):
        for x in range(big):
            t = min(1.0, math.hypot(x - big / 2, y - big / 2) / (big * 0.72))
            p[x, y] = tuple(int(center[i] + (edge[i] - center[i]) * t) for i in range(3))
    return g.resize((s, s), Image.LANCZOS).convert('RGBA')


def tile(s, radius_frac):
    im = radial_bg(s)
    im.alpha_composite(emblem_for_radius(s, radius_frac * s))
    return im


def light_tile(s, radius_frac):
    im = Image.new('RGBA', (s, s), LIGHT_BG + (255,))
    im.alpha_composite(emblem_for_radius(s, radius_frac * s))
    return im


def transparent(s, radius_frac):
    return emblem_for_radius(s, radius_frac * s)


def mono(layer, color):
    a = layer.getchannel('A')
    m = Image.new('RGBA', layer.size, color + (0,))
    m.putalpha(a)
    return m


def glow_layer(s, radius_frac, strength=70):
    g = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    r = int(radius_frac * s)
    d.ellipse((s / 2 - r, s / 2 - r, s / 2 + r, s / 2 + r), fill=GOLD + (strength,))
    # 模糊半径按画布算：光晕半径 + 3σ ≤ 0.46s，在图片边缘前完全淡出（否则启动页上会露出方形亮框）
    return g.filter(ImageFilter.GaussianBlur(s * 0.07))


def circle_mask(s, inset=0.0):
    big = s * 4
    m = Image.new('L', (big, big), 0)
    ImageDraw.Draw(m).ellipse((inset * big, inset * big, big * (1 - inset), big * (1 - inset)), fill=255)
    return m.resize((s, s), Image.LANCZOS)


def superellipse_mask(s, n=5.0):
    big = s * 4
    m = Image.new('L', (big, big), 0)
    pts = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        c, sn = math.cos(t), math.sin(t)
        x = abs(c) ** (2 / n) * (1 if c >= 0 else -1)
        y = abs(sn) ** (2 / n) * (1 if sn >= 0 else -1)
        pts.append((big / 2 + x * big / 2, big / 2 + y * big / 2))
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.resize((s, s), Image.LANCZOS)


def rounded_mask(s, r_frac):
    big = s * 4
    m = Image.new('L', (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, big - 1, big - 1), radius=int(r_frac * big), fill=255)
    return m.resize((s, s), Image.LANCZOS)


# ── 安全区（最远点半径 / 画布边长）──────────────────────────────────
R_TILE = 0.39       # iOS / 安卓旧版方形 / apple-touch / PWA any：主体约占 76%，系统圆角不切到气泡尾部
R_ROUND = 0.43      # 安卓旧版圆形：最远点在圆内留 7% 余量
R_ADAPT = 31.5 / 108  # 安卓自适应前景：最远点落在直径 66dp 的安全圆内
R_MASKABLE = 0.38   # PWA maskable：安全区为 40% 半径
R_FULL = 0.485      # favicon / Windows / 托盘：透明底尽量撑满，小尺寸更清楚
R_NOTIF = 10 / 24   # 通知小图标：24dp 画布四周留 2dp
R_SPLASH_ANDROID = 90 / 288  # Android 12 SplashScreen 无背景图标：288dp 画布、内容在 192dp 圆内


def main():
    written = []
    w = lambda rel, im, **kw: written.append(os.path.relpath(out(rel, im, **kw), ROOT))

    # ── 品牌资源包 ─────────────────────────────────────────
    # 独立尺寸 PNG（透明底；≤48px 为光学尺寸简化版，≥64px 为干净母版缩小）
    for s in (16, 20, 24, 29, 32, 40, 48, 64, 128, 256, 512, 1024):
        w(f'assets/brand/touliao/sizes/touliao-{s}.png', transparent(s, R_FULL), optimize=True)
    w('assets/brand/touliao/master/touliao-standard-1024.png', tile(1024, R_TILE).convert('RGB'), optimize=True)
    w('assets/brand/touliao/master/touliao-transparent-1024.png', transparent(1024, R_FULL), optimize=True)
    w('assets/brand/touliao/master/touliao-dark-bg-1024.png', tile(1024, R_TILE).convert('RGB'), optimize=True)
    w('assets/brand/touliao/master/touliao-light-bg-1024.png', light_tile(1024, R_TILE).convert('RGB'), optimize=True)
    w('assets/brand/touliao/monochrome/touliao-mono-white-1024.png', mono(transparent(1024, R_FULL), (255, 255, 255)), optimize=True)
    w('assets/brand/touliao/monochrome/touliao-mono-black-1024.png', mono(transparent(1024, R_FULL), (0, 0, 0)), optimize=True)

    # ── iOS AppIcon ────────────────────────────────────────
    ios_dir = 'ios/Touliao/Assets.xcassets/AppIcon.appiconset'
    for s in (20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024):
        im = tile(s, R_TILE).convert('RGB')              # App Store 要求不透明、无 alpha、不预加圆角
        w(f'{ios_dir}/AppIcon-{s}.png', im, optimize=True)
        w(f'assets/brand/touliao/ios/AppIcon-{s}.png', im, optimize=True)

    # iOS 启动页：深紫黑底色 + 居中主体（少量金色光晕）
    launch = 'ios/Touliao/Assets.xcassets/LaunchLogo.imageset'
    for scale in (1, 2, 3):
        s = 200 * scale
        im = glow_layer(s, 0.25, 70)
        im.alpha_composite(transparent(s, 0.40))
        w(f'{launch}/LaunchLogo@{scale}x.png', im, optimize=True)
        w(f'assets/brand/touliao/splash/ios-LaunchLogo@{scale}x.png', im, optimize=True)
    json.dump({'images': [{'idiom': 'universal', 'filename': f'LaunchLogo@{k}x.png', 'scale': f'{k}x'} for k in (1, 2, 3)],
               'info': {'author': 'xcode', 'version': 1}},
              open(os.path.join(ROOT, launch, 'Contents.json'), 'w'), indent=2)
    written.append(f'{launch}/Contents.json')
    cset = 'ios/Touliao/Assets.xcassets/LaunchBackground.colorset'
    os.makedirs(os.path.join(ROOT, cset), exist_ok=True)
    json.dump({'colors': [{'idiom': 'universal', 'color': {'color-space': 'srgb', 'components': {
        'red': '0x14', 'green': '0x0A', 'blue': '0x24', 'alpha': '1.000'}}}], 'info': {'author': 'xcode', 'version': 1}},
              open(os.path.join(ROOT, cset, 'Contents.json'), 'w'), indent=2)
    written.append(f'{cset}/Contents.json')

    # ── Android ────────────────────────────────────────────
    res = 'android/app/src/main/res'
    dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for d, k in dens.items():
        s48, s108, s24 = int(48 * k), int(108 * k), int(24 * k)
        sq = tile(s48, R_TILE)
        w(f'{res}/mipmap-{d}/ic_launcher.png', sq, optimize=True)
        rnd = tile(s48, R_ROUND)
        rnd.putalpha(circle_mask(s48))
        w(f'{res}/mipmap-{d}/ic_launcher_round.png', rnd, optimize=True)
        fg = transparent(s108, R_ADAPT)
        w(f'{res}/mipmap-{d}/ic_launcher_foreground.png', fg, optimize=True)
        w(f'{res}/mipmap-{d}/ic_launcher_background.png', radial_bg(s108).convert('RGB'), optimize=True)
        w(f'{res}/mipmap-{d}/ic_launcher_monochrome.png', mono(fg, (255, 255, 255)), optimize=True)
        w(f'{res}/drawable-{d}/ic_notification.png', mono(transparent(s24, R_NOTIF), (255, 255, 255)), optimize=True)
        for n, im in (('ic_launcher', sq), ('ic_launcher_round', rnd), ('ic_launcher_foreground', fg)):
            w(f'assets/brand/touliao/android/mipmap-{d}/{n}.png', im, optimize=True)
    # Android 12 SplashScreen 图标（无背景版，288dp 画布，内容在 192dp 圆内）+ 少量金色光晕
    sp = 288 * 4
    splash = glow_layer(sp, 0.25, 65)
    splash.alpha_composite(transparent(sp, R_SPLASH_ANDROID))
    w(f'{res}/drawable-nodpi/splash_logo.png', splash, optimize=True)
    w('assets/brand/touliao/splash/android-splash_logo.png', splash, optimize=True)

    # ── Windows / Electron ─────────────────────────────────
    ico_sizes = (16, 24, 32, 48, 64, 128, 256)
    frames = [transparent(s, R_FULL) for s in ico_sizes]
    frames[-1].save(os.path.join(ROOT, 'desktop-electron/assets/icon.ico'), format='ICO',
                    sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])
    written.append('desktop-electron/assets/icon.ico')
    w('desktop-electron/assets/icon.png', transparent(512, R_FULL), optimize=True)
    w('desktop-electron/assets/icon-1024.png', transparent(1024, R_FULL), optimize=True)
    for s in (16, 24, 32, 48, 64, 128, 256, 512):
        w(f'assets/brand/touliao/windows/icon-{s}.png', transparent(s, R_FULL), optimize=True)
    frames[-1].save(os.path.join(KIT, 'windows', 'icon.ico'), format='ICO',
                    sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])
    written.append('assets/brand/touliao/windows/icon.ico')

    # ── Web / PWA ──────────────────────────────────────────
    pub = 'web/public'
    fav = [transparent(s, R_FULL) for s in (16, 32, 48)]
    fav[-1].save(os.path.join(ROOT, pub, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=fav[:-1])
    written.append(f'{pub}/favicon.ico')
    w(f'{pub}/favicon-16x16.png', fav[0], optimize=True)
    w(f'{pub}/favicon-32x32.png', fav[1], optimize=True)
    w(f'{pub}/favicon.png', transparent(64, R_FULL), optimize=True)
    w(f'{pub}/apple-touch-icon.png', tile(180, R_TILE).convert('RGB'), optimize=True)
    w(f'{pub}/icons/icon-192.png', tile(192, R_TILE), optimize=True)
    w(f'{pub}/icons/icon-512.png', tile(512, R_TILE), optimize=True)
    w(f'{pub}/icons/icon-512-maskable.png', tile(512, R_MASKABLE), optimize=True)
    w(f'{pub}/icon.png', tile(192, R_TILE), optimize=True)
    w(f'{pub}/icon.webp', tile(192, R_TILE), quality=92, method=6)
    w(f'{pub}/icon-512.png', tile(512, R_TILE), optimize=True)
    for rel in ('favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'favicon.png', 'apple-touch-icon.png',
                'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'):
        src = os.path.join(ROOT, pub, rel)
        dst = os.path.join(KIT, 'web', rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(open(src, 'rb').read())
        written.append(os.path.relpath(dst, ROOT))

    # ── 视觉验收预览（不进任何产物）──────────────────────────
    prev = 'assets/brand/touliao/preview'
    a = 432
    fg, bg = transparent(a, R_ADAPT), radial_bg(a)
    comp = bg.copy(); comp.alpha_composite(fg)
    vis = int(a * 72 / 108); off = (a - vis) // 2
    view = comp.crop((off, off, off + vis, off + vis))
    sheet = Image.new('RGBA', (vis * 4 + 100, vis + 40), (40, 40, 48, 255))
    for i, m in enumerate((circle_mask(vis), Image.new('L', (vis, vis), 255), rounded_mask(vis, 0.18), superellipse_mask(vis))):
        t = view.copy(); t.putalpha(m); sheet.alpha_composite(t, (20 + i * (vis + 20), 20))
    w(f'{prev}/android-adaptive-masks.png', sheet)
    ios = tile(512, R_TILE); ios.putalpha(superellipse_mask(512))
    w(f'{prev}/ios-squircle-512.png', ios)
    small = Image.new('RGBA', (560, 140), (255, 255, 255, 255))
    x = 10
    for s in (16, 24, 32, 48, 64):
        small.alpha_composite(transparent(s, R_FULL), (x, 20)); x += s + 20
    dark = Image.new('RGBA', (280, 100), (32, 32, 36, 255)); x = 10
    for s in (16, 24, 32, 48):
        dark.alpha_composite(transparent(s, R_FULL), (x, 20)); x += s + 20
    small.alpha_composite(dark, (270, 20))
    w(f'{prev}/small-sizes-light-dark.png', small)
    big = small.resize((small.width * 4, small.height * 4), Image.NEAREST)
    w(f'{prev}/small-sizes-light-dark-x4.png', big)
    sp_prev = Image.new('RGBA', (390, 844), SPLASH_BG)
    logo = glow_layer(260, 0.25, 70); logo.alpha_composite(transparent(260, 0.40))
    sp_prev.alpha_composite(logo, ((390 - 260) // 2, (844 - 260) // 2))
    w(f'{prev}/splash-phone-390x844.png', sp_prev)

    # ICON_OPTICAL_SIZE_PREVIEW：各尺寸实际像素放大（最近邻），浅色/深色背景各一行
    from PIL import ImageFont
    sizes = (16, 24, 32, 48, 64, 128, 256, 512)
    disp = {16: 192, 24: 192, 32: 192, 48: 192, 64: 256, 128: 256, 256: 256, 512: 256}
    colw = [disp[s] + 24 for s in sizes]
    sheet = Image.new('RGBA', (sum(colw) + 24, 2 * (256 + 48) + 40), (250, 250, 252, 255))
    d = ImageDraw.Draw(sheet)
    for row, bgc in enumerate(((255, 255, 255, 255), (28, 26, 34, 255))):
        x = 24
        y = 40 + row * (256 + 48)
        for s, cw in zip(sizes, colw):
            t = Image.new('RGBA', (s, s), bgc)
            t.alpha_composite(Image.open(os.path.join(KIT, 'sizes', f'touliao-{s}.png')))
            k = disp[s]
            sheet.paste(t.resize((k, k), Image.NEAREST if s <= 64 else Image.LANCZOS), (x, y))
            d.text((x, y - 18), f'{s}x{s}' + (' (optical)' if s <= 48 else ''), fill=(60, 60, 70, 255))
            x += cw
    w('assets/brand/touliao/preview/ICON_OPTICAL_SIZE_PREVIEW.png', sheet)

    # ANDROID_MASK_PREVIEW：自适应图标（背景层 + 前景层，72dp 可视区）在三种遮罩下
    a = 432
    comp = radial_bg(a)
    comp.alpha_composite(transparent(a, R_ADAPT))
    vis = int(a * 72 / 108)
    off = (a - vis) // 2
    view = comp.crop((off, off, off + vis, off + vis))
    masks = (('Circle', circle_mask(vis)), ('Squircle', superellipse_mask(vis)), ('Rounded Square', rounded_mask(vis, 0.18)))
    sheet = Image.new('RGBA', (len(masks) * (vis + 30) + 30, vis + 70), (238, 238, 242, 255))
    d = ImageDraw.Draw(sheet)
    for i, (name, m) in enumerate(masks):
        t = view.copy()
        t.putalpha(m)
        sheet.alpha_composite(t, (30 + i * (vis + 30), 40))
        d.text((30 + i * (vis + 30), 14), name, fill=(40, 40, 50, 255))
        # 安全圆（直径 66dp）参考线
        r = vis * 33 / 72
        cxp, cyp = 30 + i * (vis + 30) + vis / 2, 40 + vis / 2
        d.ellipse((cxp - r, cyp - r, cxp + r, cyp + r), outline=(0, 200, 120, 160))
    w('assets/brand/touliao/preview/ANDROID_MASK_PREVIEW.png', sheet)

    json.dump(sorted(set(written)), open(os.path.join(KIT, 'generated-files.json'), 'w'), indent=1, ensure_ascii=False)
    print(len(set(written)), 'files written')


if __name__ == '__main__':
    main()
