"""Downloads the CC0 PBR textures used by the bridge game and writes them to assets/tex at 1K.

Sources: Poly Haven (https://polyhaven.com) and ambientCG (https://ambientcg.com), both CC0.
Run from the project root:  python3 tools/fetch_textures.py
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'tex')
SIZE = 1024

POLYHAVEN = {
    # name in the game: (Poly Haven id, maps wanted)
    'plank': ('rough_wood', ['Diffuse', 'nor_gl', 'Rough', 'AO']),
    'snow': ('snow_02', ['Diffuse', 'nor_gl', 'Rough']),
    'burlap': ('hessian_230', ['Diffuse', 'nor_gl', 'Rough']),
    'leather': ('brown_leather', ['Diffuse', 'nor_gl', 'Rough']),
}
AMBIENTCG = {
    'slate': 'Rock035',
    'rope': 'Rope001',
}
SUFFIX = {'Diffuse': 'd', 'nor_gl': 'n', 'Rough': 'r', 'AO': 'ao', 'Color': 'd', 'NormalGL': 'n', 'Roughness': 'r', 'AmbientOcclusion': 'ao', 'Opacity': 'a'}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'shinobi-bridge-asset-fetch'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def save(img: Image.Image, name: str, srgb: bool) -> None:
    img = img.convert('RGB' if srgb or img.mode not in ('L',) else 'L')
    if img.size != (SIZE, SIZE):
        img = img.resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(OUT, name + '.jpg')
    img.save(path, quality=84, optimize=True)
    print(f'  {name}.jpg {os.path.getsize(path) // 1024} KB')


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for game_name, (asset, maps) in POLYHAVEN.items():
        print(f'Poly Haven {asset} -> {game_name}')
        files = json.loads(fetch(f'https://api.polyhaven.com/files/{asset}'))
        for m in maps:
            url = files[m]['1k']['jpg']['url']
            img = Image.open(io.BytesIO(fetch(url)))
            save(img, f'{game_name}_{SUFFIX[m]}', m == 'Diffuse')
    for game_name, asset in AMBIENTCG.items():
        print(f'ambientCG {asset} -> {game_name}')
        z = zipfile.ZipFile(io.BytesIO(fetch(f'https://ambientcg.com/get?file={asset}_1K-JPG.zip')))
        for info in z.namelist():
            for key, suffix in SUFFIX.items():
                if f'_{key}.' in info and key in ('Color', 'NormalGL', 'Roughness', 'AmbientOcclusion', 'Opacity'):
                    save(Image.open(io.BytesIO(z.read(info))), f'{game_name}_{suffix}', key == 'Color')


if __name__ == '__main__':
    sys.exit(main())
