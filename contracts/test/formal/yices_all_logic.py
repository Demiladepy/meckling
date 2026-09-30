"""Halmos solver wrapper: runs yices on a query declared `(set-logic ALL)` instead of `QF_AUFBV`.

The Windows build of yices 2.6.4 that Halmos 0.3.3 uses never answers a query declared QF_AUFBV, even a trivially
unsatisfiable one; the same query under ALL answers in milliseconds (reproduced Sep 30, see docs/formal.md). The
query itself is unchanged. Usage:

    halmos --contract RuleProofs --solver-command "python test/formal/yices_all_logic.py"
"""

import subprocess
import sys

path = sys.argv[-1]
with open(path, encoding="utf-8") as f:
    query = f.read().replace("(set-logic QF_AUFBV)", "(set-logic ALL)", 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(query)

sys.exit(subprocess.call(["yices-smt2", "--smt2-model-format", "--bvconst-in-decimal", path]))
