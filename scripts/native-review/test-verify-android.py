import importlib.util
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('review', Path(__file__).with_name('verify-android.py'))
review = importlib.util.module_from_spec(spec); spec.loader.exec_module(review)

class ReviewEvidenceTests(unittest.TestCase):
    def test_old_three_test_run_and_missing_new_evidence_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); images = root / 'NativeUiReview'; images.mkdir()
            for name in review.P2_IMAGES | {f'baseline-{i}.png' for i in range(60)}:
                (images / name).touch()
            log = root / 'instrumentation.txt'
            log.write_text('OK (3 tests)')
            with self.assertRaises(AssertionError): review.validate(root)
            log.write_text('OK (4 tests)')
            self.assertEqual(review.validate(root)['testsPassed'], 4)
            (images / 'p2-component-states-dark.png').unlink()
            with self.assertRaises(AssertionError): review.validate(root)
    def test_failed_instrumentation_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'instrumentation.txt').write_text('FAILURES!!! Tests run: 4, Failures: 1')
            with self.assertRaises(AssertionError): review.validate(root)

if __name__ == '__main__': unittest.main()
