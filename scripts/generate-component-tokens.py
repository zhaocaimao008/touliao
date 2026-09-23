#!/usr/bin/env python3
"""Non-icon native adapters. Logical layout px -> pt/dp; font px -> scaled pt/sp.

No physical-density multiplication: SwiftUI/Compose handle density and font scale.
Exact generated output checks intentionally fail on any drift.
"""
import argparse, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def outputs(root=ROOT):
    t = json.loads((root/'web/src/ui-kit/tokens.json').read_text())
    result = {}
    for platform in ('ios', 'android'):
        numbers = {}
        for group, prefix in [('spacing','space'), ('radius','radius')]:
            for k,v in t[group].items(): numbers[prefix+k[:1].upper()+k[1:]]=(v,'layout')
        for role, spec in t['typography']['roles'].items():
            numbers['font'+role.title()]=(t['typography']['size'][spec['size']],'font')
            numbers['leading'+role.title()]=(t['typography']['lineHeight'][spec['lineHeight']],'ratio')
        for k,v in t['motion']['duration'].items(): numbers['duration'+k.title()]=(v,'duration')
        for k,v in t['components']['avatar']['nativeRoles'].items(): numbers['avatar'+k.title()]=(v,'layout')
        for k,v in t['layout']['zIndex'].items(): numbers['layer'+k[:1].upper()+k[1:]]=(v,'integer')
        p=t['platforms'][platform];c=t['components']
        numbers.update(touchTarget=(p['touchTargetMinimum'],'layout'),buttonHeight=(p['defaultButtonHeight'],'layout'),
            fieldHeight=(p['inputHeight'],'layout'),settingHeight=(p['settingsRowMinimum'],'layout'),
            borderDefault=(t['borderWidth']['default'],'layout'),borderFocus=(t['borderWidth']['focus'],'layout'),
            disabledOpacity=(c['control']['disabledOpacity'],'ratio'),skeletonDuration=(c['skeleton']['animationDuration'],'duration'),
            toastDuration=(c['toast']['duration'],'duration'),toastErrorDuration=(c['toast']['errorDuration'],'duration'),
            toastMaximumDuration=(c['toast']['maximumDuration'],'duration'),toastReadPerCharacter=(c['toast']['readMillisPerCharacter'],'duration'),
            callEndedDuration=(c['media']['endedDuration'],'duration'),callControlSize=(c['media']['nativeControlSize'],'layout'),callPrimarySize=(c['media']['primaryControlSize'],'layout'))
        header='// Generated from ui-kit/tokens.json by scripts/generate-component-tokens.py. Do not edit.\n'
        if platform=='ios':
            text=header+'import SwiftUI\n\nenum TouliaoMetrics {\n'
            for name,(value,unit) in numbers.items():
                value=value/1000 if unit=='duration' else value
                typ='Double' if unit=='duration' else 'Int' if unit=='integer' else 'CGFloat'
                text+=f'    static let {name}: {typ} = {value}\n'
            text+='}\n\nenum TouliaoTextRole {\n    case '+', '.join(t['typography']['roles'])+'\n'
            for prop,typ,expr in [('size','CGFloat',lambda n,r:'TouliaoMetrics.font'+n.title()),('style','Font.TextStyle',lambda n,r:'.'+r['iosStyle']),('leading','CGFloat',lambda n,r:'TouliaoMetrics.leading'+n.title()),('weight','Font.Weight',lambda n,r:'.'+r['weight'])]:
                text+=f'    var {prop}: {typ} {{\n        switch self {{\n'
                for name,role in t['typography']['roles'].items():text+=f'        case .{name}: return {expr(name,role)}\n'
                text+='        }\n    }\n'
            text+='}\n\nenum TouliaoMedia {\n'
            for name,value in c['media'].items():
                if isinstance(value,str): text+=f'    static let {name} = Color(red: {int(value[1:3],16)} / 255.0, green: {int(value[3:5],16)} / 255.0, blue: {int(value[5:7],16)} / 255.0)\n'
            text+='}\n\nenum TouliaoMotion {\n'
            for name,value in t['motion']['easing'].items():
                points=re.fullmatch(r'cubic-bezier\(([^)]+)\)', value).group(1)
                text+=f'    static func {name}(_ duration: Double = TouliaoMetrics.durationNormal) -> Animation {{ .timingCurve({points}, duration: duration) }}\n'
            text+='}\n'
            result[root/'ios/Touliao/UI/Theme/ComponentTokens.swift']=text
        else:
            text=header+'package com.touliao.app.ui.theme\n\nimport androidx.compose.ui.unit.dp\nimport androidx.compose.ui.unit.sp\nimport androidx.compose.ui.graphics.Color\nimport androidx.compose.animation.core.CubicBezierEasing\n\nobject TouliaoMetrics {\n'
            for name,(value,unit) in numbers.items():
                suffix={'layout':'.dp','font':'.sp','duration':'L','ratio':'f','integer':''}[unit]
                text+=f'    val {name} = {value}{suffix}\n'
            text+='}\n\nobject TouliaoMedia {\n'
            for name,value in c['media'].items():
                if isinstance(value,str):text+=f'    val {name} = Color(0xFF{value[1:].upper()})\n'
            text+='}\n\nobject TouliaoMotion {\n'
            for name,value in t['motion']['easing'].items():
                points=re.fullmatch(r'cubic-bezier\(([^)]+)\)', value).group(1)
                args=', '.join(x.strip()+'f' for x in points.split(','))
                text+=f'    val {name} = CubicBezierEasing({args})\n'
            text+='}\n'
            result[root/'android/app/src/main/java/com/touliao/app/ui/theme/ComponentTokens.kt']=text
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    for path,text in outputs().items():
        if args.check:
            if not path.is_file() or path.read_text()!=text:raise SystemExit('Generated component tokens differ: '+str(path.relative_to(ROOT)))
        else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
    print(('Checked' if args.check else 'Generated')+' iOS pt/seconds and Android dp/sp/milliseconds component adapters.')
