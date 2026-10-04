"""Path guards for the hospital scripts (build_hospital.py, export_hospital.py).

These are resolved-path checks in plain Python, run once at start-up before any file is created or changed. They are NOT an OS sandbox:
Blender itself, its Python standard library and the other tools can still touch the disk, and a file can change between the check and the
write. What they do guarantee for the two scripts is listed in docs/ASSET_HANDOFF_A.md.

The checkout root comes from this file's own location (tools/assets-a/hospital/ -> three levels up), never from the current directory
or from an argument. Every path is resolved first (relative parts, `..`, symlinks and junctions followed) and only then compared.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE_DIR = ROOT / "world" / "assets-src" / "a-hospital"             # .blend, build report: the only place the build may write
RUNTIME_DIR = ROOT / "world" / "public" / "models" / "buildings"      # .glb: the only place the export may write
_NAME = re.compile(r"^hospital-a-[A-Za-z0-9][A-Za-z0-9._-]*$")


def _reject(what, why):
    raise SystemExit(f"path guard: {what} {why}")


def _checked(path_arg, area, suffix, what):
    raw = str(path_arg)
    if not raw.strip() or "\x00" in raw:
        _reject(what, "is empty or malformed")
    area_real = area.resolve()
    if not area_real.is_relative_to(ROOT):
        _reject(what, f"cannot be used: {area} resolves outside the checkout ({area_real})")
    if not area_real.is_dir():
        _reject(what, f"cannot be used: the directory {area_real} does not exist")
    path = Path(raw).resolve()
    if path.parent != area_real:
        _reject(what, f"must be a file directly inside {area_real} (resolved to {path})")
    if path.suffix != suffix:
        _reject(what, f"must end in exactly '{suffix}' (got '{path.suffix}')")
    if not _NAME.match(path.name):
        _reject(what, f"must be named hospital-a-<version>{suffix} using letters, digits, '.', '_' or '-' (got '{path.name}')")
    if path.exists() and not path.is_file():
        _reject(what, f"exists but is not a regular file ({path})")
    return path


def input_file(path_arg, area, suffix, what):
    path = _checked(path_arg, area, suffix, what)
    if not path.is_file():
        _reject(what, f"does not exist ({path})")
    return path


def output_file(path_arg, area, suffix, what):
    return _checked(path_arg, area, suffix, what)


def refuse_overwrite(paths, allow_overwrite):
    """All outputs together: if any exists and --allow-overwrite is not given, nothing is written at all."""
    existing = [str(p) for p in paths if p.exists()]
    if existing and not allow_overwrite:
        raise SystemExit("refusing to overwrite " + ", ".join(existing) + " (bump the version or pass --allow-overwrite)")
