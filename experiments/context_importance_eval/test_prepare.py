"""Small source-contract checks; no operational payloads embedded in fixtures."""
import csv
import hashlib
import tempfile
import unittest
from pathlib import Path

from prepare import convert, opaque


class PreparationTests(unittest.TestCase):
    def convert_rows(self, name, fields, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(fields)
                writer.writerows(rows)
            return convert(name, path, hashlib.sha256(path.read_bytes()).hexdigest())

    def test_global_order_and_past_only_case_collapse(self):
        data, meta = self.convert_rows("helpdesk", ["CaseID", "ActivityID", "CompleteTimestamp"], [
            ["a", "end", "2020-01-01 00:00:03"],
            ["a", "start", "2020-01-01 00:00:00"],
            ["b", "start", "2020-01-01 00:00:01"],
            ["a", "start", "2020-01-01 00:00:02"],
        ])
        self.assertEqual([e["source_position"] for e in data["events"]], [1, 2, 0])
        self.assertEqual(meta["cases"], 2)
        self.assertEqual(meta["events"], 3)

    def test_context_change_retained_without_state_change_and_missing_date_fallback(self):
        data, _ = self.convert_rows("incident", ["number", "incident_state", "sys_updated_at",
            "opened_at", "category", "assignment_group"], [
            ["a", "open", "?", "01/01/2020 00:00", "c", "g1"],
            ["a", "open", "01/01/2020 00:01", "01/01/2020 00:00", "c", "g2"],
            ["a", "open", "01/01/2020 00:02", "01/01/2020 00:00", "c", "g2"],
        ])
        events = data["events"]
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["state"], events[1]["state"])
        self.assertNotEqual(events[0]["context"], events[1]["context"])

    def test_hash_mismatch_rejected_before_parsing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.csv"
            path.write_text("not a CSV dataset")
            with self.assertRaisesRegex(ValueError, "Source hash mismatch"):
                convert("helpdesk", path, "0" * 64)

    def test_opaque_ids_are_stable_and_dataset_scoped(self):
        self.assertEqual(opaque("helpdesk", "1"), opaque("helpdesk", "1"))
        self.assertNotEqual(opaque("helpdesk", "1"), opaque("incident", "1"))
        self.assertNotEqual(opaque("helpdesk", "1"), 0)


if __name__ == "__main__":
    unittest.main()
