import math
import unittest
from scan import is_blocked


class Decisions(unittest.TestCase):
    def test_explicit_nudity_blocks_at_threshold(self):
        for category in ['FEMALE_BREAST_EXPOSED', 'FEMALE_GENITALIA_EXPOSED',
                         'MALE_GENITALIA_EXPOSED', 'BUTTOCKS_EXPOSED', 'ANUS_EXPOSED']:
            self.assertTrue(is_blocked([{'class': category, 'score': 0.6}], 0.6))

    def test_faces_clothed_people_and_empty_results_are_not_nudity(self):
        self.assertFalse(is_blocked([], 0.6))
        self.assertFalse(is_blocked([{'class': 'FACE_FEMALE', 'score': 0.99},
                                     {'class': 'FEMALE_BREAST_COVERED', 'score': 0.98}], 0.6))

    def test_invalid_inference_never_becomes_approval(self):
        for score in [math.nan, math.inf, -0.1, 1.1]:
            with self.assertRaises(ValueError):
                is_blocked([{'class': 'FACE_FEMALE', 'score': score}], 0.6)
        with self.assertRaises(ValueError):
            is_blocked(None, 0.6)


if __name__ == '__main__':
    unittest.main()
