#!/usr/bin/env python3
"""Require every registered native review test plus its new P2 visual evidence."""
import json
import re
from pathlib import Path

EXPECTED_TESTS = 4  # gallery, login keyboard/back, compact chat, P2 component states
# BubbleGestureTest(4) + CallMinimizedBubbleTest(1) + CallActivityManifestTest(1) + GroupCallMinimizeTest(1)
EXPECTED_CALL_TESTS = 7
P2_IMAGES = {f'p2-{name}.png' for name in (
    'component-states-light', 'component-states-dark', 'error-retry-light',
    'error-retry-dark', 'component-states-dark-large-text', 'component-buttons-dark-large-text')}

def validate(root):
    text = (root / 'instrumentation.txt').read_text()
    match = re.search(r'\bOK \((\d+) tests?\)', text)
    images = list((root / 'NativeUiReview').glob('*.png'))
    result = dict(environment='Android Emulator API 34, native instrumentation',
                  testsPassed=int(match[1]) if match else 0, screenshots=len(images), hardware=False)
    (root / 'validation.json').write_text(json.dumps(result, indent=2) + '\n')
    assert match and int(match[1]) == EXPECTED_TESTS, 'All four native review tests must pass, including p2ComponentStates'
    assert 'FAILURES!!!' not in text and 'INSTRUMENTATION_FAILED' not in text, 'Instrumentation reported failure'
    assert len(images) >= 66, 'Native screenshot collection is incomplete'
    assert P2_IMAGES <= {p.name for p in images}, 'P2 component state screenshots are missing'
    call_text = (root / 'call-regression.txt').read_text()
    call_match = re.search(r'\bOK \((\d+) tests?\)', call_text)
    result['callRegressionTestsPassed'] = int(call_match[1]) if call_match else 0
    (root / 'validation.json').write_text(json.dumps(result, indent=2) + '\n')
    assert 'FAILURES!!!' not in call_text and 'INSTRUMENTATION_FAILED' not in call_text, 'Call regression tests reported failure'
    assert call_match and int(call_match[1]) == EXPECTED_CALL_TESTS, f'All {EXPECTED_CALL_TESTS} call / bubble gesture regression tests must pass'
    return result

if __name__ == '__main__':
    print(validate(Path('native-review')))
