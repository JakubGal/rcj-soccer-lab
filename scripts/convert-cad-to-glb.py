"""Convert STEP robot CAD into an intermediate GLB with CadQuery.

CadQuery is intentionally kept outside the web application's dependencies. Run
this script with a Python environment that has CadQuery installed. The output is
an intermediate asset; ``prepare-robot-glb.py`` performs web normalization.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cadquery as cq


class DuplicateSafeAssembly(cq.Assembly):
    """Accept real-world CAD assemblies that reuse component display names."""

    def add(self, arg, **kwargs):  # type: ignore[no-untyped-def]
        requested = kwargs.get("name") or getattr(arg, "name", None) or "part"
        candidate = requested
        suffix = 2
        while candidate in self.objects:
            candidate = f"{requested} {suffix}"
            suffix += 1
        kwargs["name"] = candidate
        return super().add(arg, **kwargs)


def load_step(path: Path) -> cq.Assembly:
    try:
        return DuplicateSafeAssembly.importStep(str(path), unit="MM")
    except ValueError as error:
        if "does not contain an assembly" not in str(error):
            raise

    shape = cq.importers.importStep(str(path), unit="MM")
    assembly = DuplicateSafeAssembly(name=path.stem)
    assembly.add(
        shape,
        name=path.stem,
        color=cq.Color(0.55, 0.59, 0.63),
    )
    return assembly


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a STEP assembly to an intermediate binary glTF.",
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--tolerance-mm",
        type=float,
        default=0.55,
        help="Linear tessellation tolerance in millimetres (default: 0.55).",
    )
    parser.add_argument(
        "--angular-tolerance",
        type=float,
        default=0.42,
        help="Angular tessellation tolerance in radians (default: 0.42).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.input.resolve()
    target = args.output.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if source.suffix.lower() not in {".step", ".stp"}:
        raise ValueError(f"Expected STEP input, received {source.suffix}")

    target.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    assembly = load_step(source)
    imported = time.perf_counter()
    assembly.export(
        str(target),
        tolerance=args.tolerance_mm,
        angularTolerance=args.angular_tolerance,
    )
    finished = time.perf_counter()
    size_mb = target.stat().st_size / (1024 * 1024)
    print(
        f"Imported {len(assembly.objects):,} nodes in "
        f"{imported - started:.1f}s; wrote {size_mb:.1f} MB in "
        f"{finished - imported:.1f}s: {target}",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
