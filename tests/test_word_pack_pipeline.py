import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.atlas.run_word_pack import approve_media, approve_text, select_candidates


class WordPackSelectionTests(unittest.TestCase):
    def test_priority_groups_are_exhausted_in_order_and_rank_is_ascending(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            atlas = root / "atlas.json"
            atlas.write_text(json.dumps([{"w": "already"}]), encoding="utf-8")
            csv_path = root / "ecdict.csv"
            with csv_path.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=["word", "tag", "frq"])
                writer.writeheader()
                writer.writerows([
                    {"word": "ielts-low", "tag": "ielts", "frq": "90"},
                    {"word": "ielts-high", "tag": "ielts", "frq": "10"},
                    {"word": "toefl-one", "tag": "toefl", "frq": "1"},
                    {"word": "gre-one", "tag": "gre", "frq": "1"},
                    {"word": "plain-one", "tag": "", "frq": "1"},
                ])
            selected = select_candidates(csv_path, atlas, 4)
            self.assertEqual([item["word"] for item in selected], [
                "ielts-high", "ielts-low", "toefl-one", "gre-one",
            ])
            self.assertEqual([item["group"] for item in selected], ["ielts", "ielts", "toefl", "gre"])

    def test_unknown_frequency_is_after_ranked_entries(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            atlas = root / "atlas.json"
            atlas.write_text("[]", encoding="utf-8")
            csv_path = root / "ecdict.csv"
            with csv_path.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=["word", "tag", "frq"])
                writer.writeheader()
                writer.writerows([
                    {"word": "ranked", "tag": "ielts", "frq": "100"},
                    {"word": "unknown", "tag": "ielts", "frq": "0"},
                ])
            selected = select_candidates(csv_path, atlas, 2)
            self.assertEqual([item["word"] for item in selected], ["ranked", "unknown"])

    def test_automatic_approval_marks_text_and_all_media(self):
        with tempfile.TemporaryDirectory() as temp:
            batch = Path(temp)
            (batch / "manifest.json").write_text(json.dumps({"status": "draft"}), encoding="utf-8")
            (batch / "media").mkdir()
            (batch / "media/review.json").write_text(json.dumps({
                "items": {"known": {"scene": "pending", "image": "pending", "uk": "pending"}},
            }), encoding="utf-8")
            approve_text(batch)
            approve_media(batch)
            self.assertEqual(json.loads((batch / "manifest.json").read_text(encoding="utf-8"))["status"], "approved")
            review = json.loads((batch / "media/review.json").read_text(encoding="utf-8"))
            self.assertEqual(review["items"]["known"], {"scene": "approved", "image": "approved", "uk": "approved"})


if __name__ == "__main__":
    unittest.main()
