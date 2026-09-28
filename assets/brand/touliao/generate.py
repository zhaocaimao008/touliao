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
MASTER = os.path.join(KIT, 'master', 'touliao-icon-master.png')

# 母版几何（由 alpha>20 连通域分析得到）：主体包围盒与离主体中心最远点（气泡尾部）半径
BODY = (99, 86, 1190, 1162)
BODY_RADIUS = 727.1
STRAY_SPECK = (328, 1186, 342, 1199)   # 母版左下角与主体不相连的 68px 杂点，透明化处理

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


def load_emblem():
    im = Image.open(MASTER).convert('RGBA')
    px = im.load()
    x0, y0, x1, y1 = STRAY_SPECK
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, 0)
    bx0, by0, bx1, by1 = BODY
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    side = int(math.ceil(2 * BODY_RADIUS)) + 8          # 以主体中心为圆心、能容纳最远点的正方形
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, (int(round(side / 2 - cx)), int(round(side / 2 - cy))), im)
    return canvas, side


EMBLEM, EM_SIDE = load_emblem()
EM_RADIUS_FRAC = BODY_RADIUS / EM_SIDE      # 最远点半径 / 画布边长


def emblem_for_radius(canvas_px, radius_px):
    """缩放主体，使最远点半径 = radius_px，返回放在 canvas_px 透明画布中央的图层。"""
    scale = radius_px / BODY_RADIUS
    size = max(1, int(round(EM_SIDE * scale)))
    em = EMBLEM.resize((size, size), Image.LANCZOS)
    layer = Image.new('RGBA', (canvas_px, canvas_px), (0, 0, 0, 0))
    off = (canvas_px - size) // 2
    layer.alpha_composite(em, (off, off)) if off >= 0 else layer.paste(em.crop((-off, -off, -off + canvas_px, -off + canvas_px)), (0, 0))
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
    w('assets/brand/touliao/master/touliao-icon-master-clean.png', EMBLEM, optimize=True)
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

    json.dump(sorted(set(written)), open(os.path.join(KIT, 'generated-files.json'), 'w'), indent=1, ensure_ascii=False)
    print(len(set(written)), 'files written')


if __name__ == '__main__':
    main()
