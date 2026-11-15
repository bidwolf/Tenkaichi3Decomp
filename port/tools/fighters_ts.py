#!/usr/bin/env python3
"""Writes port/matchmaking/supabase/fighters.ts: the fighters' names by character id, for the ranking's page.

    python3 port/tools/fighters_ts.py

Taken from the table the online menus have (sTbNames, src/menu/port_tbo.c), so that the two never differ."""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
src = (ROOT / "src/menu/port_tbo.c").read_text(encoding="utf-8")
a = src.index("static const char *const sTbNames[] = {")
names = re.findall(r'"((?:[^"\\]|\\.)*)"', src[a:src.index("};", a)])
out = "// Made by port/tools/fighters_ts.py from src/menu/port_tbo.c (sTbNames): the fighters' names by character id.\n"
out += "export const FIGHTERS: string[] = " + json.dumps(names, ensure_ascii=False) + ";\n"
(ROOT / "port/matchmaking/supabase/fighters.ts").write_text(out, encoding="utf-8")
print(len(names), "names")
