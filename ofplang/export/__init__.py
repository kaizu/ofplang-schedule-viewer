"""ofplang export: write ofplang documents out in a form people read.

The one target so far is `view` — the interactive viewer as a single HTML
file. See `ofplang.export.cli` for the command, `ofplang.export.template` for
the contract between this package and the page it fills.
"""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("ofplang-export")
except PackageNotFoundError:  # a source tree without installed metadata
    __version__ = "0+unknown"
