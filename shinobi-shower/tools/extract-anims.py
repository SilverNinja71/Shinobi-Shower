#!/usr/bin/env python3
"""Copies a few clips out of Quaternius's Universal Animation Library 2 (CC0) into a small .glb.

    python3 tools/extract-anims.py <UAL2_Standard.glb> assets/chars/ninja_anims.glb
"""
import json, struct, sys

KEEP = ['Slide_Loop', 'Slide_Start', 'NinjaJump_Start', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'Sword_Dash',
        'Sword_Regular_A', 'Sword_Regular_B', 'Hit_Knockback']
data = open(sys.argv[1], 'rb').read()
n = struct.unpack('<I', data[12:16])[0]
src = json.loads(data[20:20 + n])
binary = data[20 + n + 8:]

blob = bytearray()
views, accessors, remap = [], [], {}


def copy(i):
    if i in remap:
        return remap[i]
    a = dict(src['accessors'][i])
    v = src['bufferViews'][a['bufferView']]
    size = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']] * {5126: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1}[a['componentType']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = binary[start:start + size * a['count']]
    while len(blob) % 4:
        blob.append(0)
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(raw)})
    blob.extend(raw)
    a['bufferView'] = len(views) - 1
    a.pop('byteOffset', None)
    accessors.append(a)
    remap[i] = len(accessors) - 1
    return remap[i]


anims = []
for a in src['animations']:
    if a['name'] not in KEEP:
        continue
    samplers = [dict(s, input=copy(s['input']), output=copy(s['output'])) for s in a['samplers']]
    anims.append({'name': a['name'], 'samplers': samplers, 'channels': a['channels']})

nodes = [{k: v for k, v in node.items() if k not in ('mesh', 'skin')} for node in src['nodes']]
while len(blob) % 4:
    blob.append(0)
out = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': src['scenes'][:1], 'nodes': nodes, 'animations': anims,
       'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
text = json.dumps(out, separators=(',', ':')).encode()
text += b' ' * (-len(text) % 4)
with open(sys.argv[2], 'wb') as f:
    f.write(b'glTF' + struct.pack('<II', 2, 28 + len(text) + len(blob)))
    f.write(struct.pack('<I', len(text)) + b'JSON' + text)
    f.write(struct.pack('<I', len(blob)) + b'BIN\0' + bytes(blob))
print(len(anims), 'clips', (28 + len(text) + len(blob)) // 1024, 'KB')
