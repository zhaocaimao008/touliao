#!/usr/bin/env python3
"""Check platform unit conversion, complete roles, and deterministic generation."""
import importlib.util, json, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('generator',Path(__file__).with_name('generate-component-tokens.py'))
generator=importlib.util.module_from_spec(spec);spec.loader.exec_module(generator)

class ComponentTokensTest(unittest.TestCase):
    def test_platform_units_and_semantics(self):
        with tempfile.TemporaryDirectory(prefix='touliao-units-') as d:
            root=Path(d);source=root/'web/src/ui-kit/tokens.json';source.parent.mkdir(parents=True)
            t=json.loads((generator.ROOT/'web/src/ui-kit/tokens.json').read_text())
            # Non-round fixture values catch density scaling and milliseconds mistakes.
            t['spacing']['4']=17;t['motion']['duration']['fast']=125;t['typography']['size']['bodyMobile']=19
            source.write_text(json.dumps(t))
            first=generator.outputs(root);self.assertEqual(first,generator.outputs(root))
            swift=next(v for k,v in first.items()if k.suffix=='.swift')
            kotlin=next(v for k,v in first.items()if k.suffix=='.kt')
            self.assertIn('space4: CGFloat = 17',swift);self.assertIn('space4 = 17.dp',kotlin)
            self.assertIn('durationFast: Double = 0.125',swift);self.assertIn('durationFast = 125L',kotlin)
            self.assertIn('fontBody: CGFloat = 19',swift);self.assertIn('fontBody = 19.sp',kotlin)
            self.assertIn('touchTarget: CGFloat = 44',swift);self.assertIn('touchTarget = 48.dp',kotlin)
            self.assertIn('case .caption: return .caption',swift)
            self.assertIn('case .title: return .title2',swift)
            for role in t['typography']['roles']:
                self.assertIn('font'+role.title(),swift);self.assertIn('font'+role.title(),kotlin)
    def test_real_generated_files_are_exact(self):
        for p,s in generator.outputs().items():self.assertEqual(p.read_text(),s,str(p))

if __name__=='__main__':unittest.main()
