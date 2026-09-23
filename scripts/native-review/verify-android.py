#!/usr/bin/env python3
"""Require every registered native review test plus its new P2 visual evidence."""
import json
import re
from pathlib import Path

EXPECTED_TESTS = 4  # gallery, login keyboard/back, compact chat, P2 component states
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
    return result

if __name__ == '__main__':
    print(validate(Path('native-review')))
