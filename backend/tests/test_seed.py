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
                        "inventory_items",
                        "inventory_locations",
                        "inventory_lots",
                        "stock_movements",
                        "event_logistics_requirements",
                        "inventory_allocations",
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
                self.assertTrue(
                    {row[0] for row in db.execute("SELECT name FROM inventory_locations")}
                    >= {"Tampines Hub", "Tampines CC", "West Coast CC", "Migrant Dormitories"}
                )
                self.assertTrue(
                    {row[0] for row in db.execute("SELECT name FROM inventory_items")}
                    >= {"Tables", "Chairs", "Clothes"}
                )
                seeded_events = db.execute(
                    """SELECT id FROM events WHERE name IN (?, ?, ?)""",
                    ("Yoga at Tampines Hub", "Zumba at Boon Lay Dormitory", "Clothes & Essentials Distribution"),
                ).fetchall()
                self.assertEqual(len(seeded_events), 3)
                for event in seeded_events:
                    self.assertGreaterEqual(
                        db.execute(
                            "SELECT COUNT(*) FROM event_logistics_requirements WHERE event_id = ?",
                            (event[0],),
                        ).fetchone()[0],
                        2,
                    )
                self.assertGreaterEqual(first_counts["inventory_allocations"], 6)
                self.assertGreater(first_counts["stock_movements"], 0)

                seed(db)
                second_counts = {
                    table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    for table in first_counts
                }

            self.assertEqual(second_counts, first_counts)


if __name__ == "__main__":
    unittest.main()
