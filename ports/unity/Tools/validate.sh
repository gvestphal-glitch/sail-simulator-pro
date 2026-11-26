#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test Backend/rooms.test.mjs Tools/assets.test.mjs
: "${UNITY_EDITOR:?Indique o executável do Unity 6000.0.58f1 para rodar o EditMode}"
mkdir -p Results
"$UNITY_EDITOR" -batchmode -nographics -projectPath "$PWD" -runTests -testPlatform EditMode -testResults "$PWD/Results/EditMode.xml" -logFile "$PWD/Results/editor.log"
python3 - <<'PY'
import xml.etree.ElementTree as ET
r=ET.parse('Results/EditMode.xml').getroot()
assert int(r.attrib.get('passed',0))>0 and r.attrib.get('result')=='Passed',r.attrib
PY
