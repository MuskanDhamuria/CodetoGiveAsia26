import tempfile
import unittest
from pathlib import Path

from backend.database import connect, initialize_database
from backend.seed import seed


class DemoSeedTest(unittest.TestCase):
    def test_seed_adds_idempotent_logistics_demo_records(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "seed.sqlite3"
            initialize_database(database_path)

            with connect(database_path) as db:
                seed(db)
                first_counts = {
                    table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    for table in (
                        "donation_batches",
                        "supplier_orders",
                        "supplier_order_lines",
                        "supplier_order_fulfilments",
                    )
                }

                self.assertGreaterEqual(first_counts["donation_batches"], 3)
                self.assertGreaterEqual(first_counts["supplier_orders"], 3)
                self.assertGreaterEqual(first_counts["supplier_order_lines"], 3)
                self.assertGreaterEqual(first_counts["supplier_order_fulfilments"], 2)

                seed(db)
                second_counts = {
                    table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    for table in first_counts
                }

            self.assertEqual(second_counts, first_counts)


if __name__ == "__main__":
    unittest.main()
