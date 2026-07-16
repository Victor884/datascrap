from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from packages.jobstore import DEFAULT_DB_PATH, sync_csv_to_db

DEFAULT_INPUT = ROOT_DIR / "data" / "processed" / "vagas-processadas.csv"


def main() -> int:
    parser = argparse.ArgumentParser(description="Sincroniza a base processada para um banco SQLite relacional.")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="CSV processado de entrada.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Caminho do banco SQLite.")
    args = parser.parse_args()

    rows = sync_csv_to_db(args.input, args.db)
    print(f"Pronto: {rows} vagas persistidas em {args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
