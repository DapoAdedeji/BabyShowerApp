#!/usr/bin/env python3
"""
Seed Guess That Baby with real photos — re-run whenever new photos arrive.

    python3 scripts/seed_baby_photos.py "/path/to/Baby Photos"            # preview only
    python3 scripts/seed_baby_photos.py "/path/to/Baby Photos" --upload   # upload for real

Each file's name is the answer, exactly as spelt ("Temi Coker.JPG" ->
"Temi Coker", "kAI.JPG" -> "kAI").
For every photo it:
  * applies any crop listed in scripts/photo_crops.json (by filename),
  * rotates it upright (phone photos are often stored sideways),
  * converts to JPEG (HEIC/PNG too) and shrinks it to 1200px max,
  * strips hidden metadata (EXIF/GPS location, XMP, IPTC),
  * gives it a random id, so the URL never contains the person's name.
Photos are shuffled before numbering (alphabetical would give it away).

--upload writes everything to the Cloudflare KV store in one go
(`wrangler kv bulk put`), replaces the Guess That Baby photo list and
answers, deletes the previous upload's photos, and starts a fresh round
(old answers referred to the old numbering), clearing earlier rounds'
phone claims and answer sheets. Teams and Leaderboard scores are not
touched. Needs: macOS `sips`, `npx wrangler login`.
"""
import argparse
import base64
import json
import os
import random
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.heic', '.heif'}
MAX_SIDE = 1200
WRANGLER = ['npx', '-y', 'wrangler@4.158.0']


def namespace_id():
    with open(os.path.join(ROOT, 'wrangler.jsonc')) as f:
        m = re.search(r'"binding":\s*"QUESTIONS",\s*"id":\s*"([0-9a-f]+)"', f.read())
    if not m:
        sys.exit('Could not find the QUESTIONS KV namespace id in wrangler.jsonc')
    return m.group(1)


def answer_for(filename):
    """The answer is the filename as spelt, minus the extension and extra spaces."""
    return ' '.join(os.path.splitext(filename)[0].split())


def load_crops():
    """{ "Dapo.JPG": { "top": 60, "left": 5, "width": 239, "height": 412 } } in
    the original photo's pixels — e.g. to trim a phone screenshot's buttons."""
    path = os.path.join(ROOT, 'scripts', 'photo_crops.json')
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith('_')}


def sips(*args):
    out = subprocess.run(['sips', *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or out.stdout.strip())
    return out.stdout


def orientation(path):
    m = re.search(r'orientation:\s*(\d+)', sips('-g', 'orientation', path))
    return int(m.group(1)) if m else 1


def strip_metadata(jpeg):
    """Drop APP1 (EXIF/XMP), APP13 (IPTC) and comment segments from a JPEG."""
    if jpeg[:2] != b'\xff\xd8':
        return jpeg
    out = bytearray(b'\xff\xd8')
    i = 2
    while i + 4 <= len(jpeg):
        if jpeg[i] != 0xFF:
            break
        marker = jpeg[i + 1]
        if marker == 0xDA:  # start of scan: copy the rest unchanged
            out += jpeg[i:]
            return bytes(out)
        length = int.from_bytes(jpeg[i + 2:i + 4], 'big')
        segment = jpeg[i:i + 2 + length]
        if marker not in (0xE1, 0xED, 0xFE):
            out += segment
        i += 2 + length
    return jpeg  # unexpected layout: keep the original rather than corrupt it


def convert(src, dest, crop=None):
    """Cropped (optional), upright, JPEG, <= MAX_SIDE px, metadata stripped. Returns bytes."""
    shutil.copy(src, dest + '.src')
    work = dest + '.src'
    rotate = {3: 180, 6: 90, 8: 270}.get(orientation(work))
    if crop:
        sips('--cropOffset', str(crop['top']), str(crop['left']), '-c', str(crop['height']), str(crop['width']), work)
    dims = sips('-g', 'pixelWidth', '-g', 'pixelHeight', work)
    longest = max(int(x) for x in re.findall(r'pixel(?:Width|Height):\s*(\d+)', dims))
    resize = ['-Z', str(MAX_SIDE)] if longest > MAX_SIDE else []  # shrink only, never enlarge
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '82', *resize, work, '--out', dest)
    if rotate:
        sips('-r', str(rotate), dest)
    os.remove(work)
    with open(dest, 'rb') as f:
        data = strip_metadata(f.read())
    with open(dest, 'wb') as f:
        f.write(data)
    return data


def wrangler(*args):
    out = subprocess.run([*WRANGLER, *args], capture_output=True, text=True, cwd=ROOT)
    if out.returncode != 0:
        sys.exit(f'wrangler {" ".join(args[:3])} failed:\n{out.stdout}\n{out.stderr}')
    return out.stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder', help='folder of photos named after each person')
    ap.add_argument('--upload', action='store_true', help='upload to Cloudflare (otherwise preview only)')
    ap.add_argument('--out', help='where to save the processed photos for checking (default: a temp folder)')
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(args.folder)
                   if os.path.splitext(f)[1].lower() in IMAGE_EXTS and not f.startswith('.'))
    if not files:
        sys.exit('No photos found.')
    if len(files) > 60:
        sys.exit('The game supports up to 60 photos.')

    names = [answer_for(f) for f in files]
    crops = load_crops()
    unknown = sorted(set(crops) - set(files))
    if unknown:
        print(f'Note: photo_crops.json mentions files that aren\'t in the folder: {", ".join(unknown)}')
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        sys.exit(f'Two photos have the same name: {", ".join(sorted(dupes))}. Rename one so every answer is unique.')

    out_dir = args.out or tempfile.mkdtemp(prefix='baby-photos-')
    os.makedirs(out_dir, exist_ok=True)

    order = list(range(len(files)))
    random.SystemRandom().shuffle(order)

    photos, key, entries, manifest = [], {}, [], []
    for n, idx in enumerate(order, start=1):
        src = os.path.join(args.folder, files[idx])
        photo_id = secrets.token_hex(8)
        data = convert(src, os.path.join(out_dir, f'{n:02d}.jpg'), crops.get(files[idx]))
        photos.append({'n': n, 'img': f'/api/gtb/photo/{photo_id}'})
        key[str(n)] = names[idx]
        entries.append({'key': f'gtb:photo:{photo_id}', 'value': base64.b64encode(data).decode(), 'base64': True})
        manifest.append((n, names[idx], files[idx] in crops, len(data)))

    print(f'{len(files)} photos -> {out_dir}')
    for n, name, cropped, size in manifest:
        print(f'  #{n:<2} {name:<16} {size // 1024:>4} KB{"   (cropped)" if cropped else ""}')
    with open(os.path.join(out_dir, 'answers.json'), 'w') as f:
        json.dump({'key': key}, f, indent=2)

    if not args.upload:
        print('\nPreview only — check the photos above, then re-run with --upload.')
        return

    ns = namespace_id()
    # Remember the previous upload's photos so they can be removed afterwards.
    old_keys = []
    current = subprocess.run([*WRANGLER, 'kv', 'key', 'get', 'gtb:config', '--namespace-id', ns, '--remote'],
                             capture_output=True, text=True, cwd=ROOT)
    try:
        old = json.loads(current.stdout[current.stdout.index('{'):])
        old_keys = [f'gtb:photo:{p["img"].rsplit("/", 1)[1]}' for p in old.get('photos', [])
                    if p.get('img', '').startswith('/api/gtb/photo/')]
    except (ValueError, KeyError, IndexError):
        pass

    config = {'photos': photos, 'names': sorted(names, key=str.lower), 'key': key}
    state = {'round': f'r{int(time.time() * 1000):x}', 'status': 'open', 'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    entries.append({'key': 'gtb:config', 'value': json.dumps(config)})
    entries.append({'key': 'gtb:state', 'value': json.dumps(state)})

    bulk = os.path.join(out_dir, 'bulk.json')
    with open(bulk, 'w') as f:
        json.dump(entries, f)
    print('\nUploading…')
    wrangler('kv', 'bulk', 'put', bulk, '--namespace-id', ns, '--remote')
    os.remove(bulk)  # contains the answers; don't leave it lying around

    if old_keys:
        stale = os.path.join(out_dir, 'stale.json')
        with open(stale, 'w') as f:
            json.dump(old_keys, f)
        wrangler('kv', 'bulk', 'delete', stale, '--namespace-id', ns, '--remote', '--force')
        os.remove(stale)
        print(f'Removed {len(old_keys)} photos from the previous upload.')

    # Old rounds' phone claims and answer sheets can't be used any more.
    listing = wrangler('kv', 'key', 'list', '--namespace-id', ns, '--remote', '--prefix', 'gtb:')
    leftovers = [k['name'] for k in json.loads(listing[listing.index('['):])
                 if k['name'].startswith(('gtb:claim:', 'gtb:sheet:'))
                 and not k['name'].startswith((f'gtb:claim:{state["round"]}:', f'gtb:sheet:{state["round"]}:'))]
    if leftovers:
        stale = os.path.join(out_dir, 'stale.json')
        with open(stale, 'w') as f:
            json.dump(leftovers, f)
        wrangler('kv', 'bulk', 'delete', stale, '--namespace-id', ns, '--remote', '--force')
        os.remove(stale)
        print(f'Cleared {len(leftovers)} claims/answer sheets from earlier rounds.')

    print(f'Done: {len(photos)} photos live, fresh round started. Teams & Leaderboard untouched.')


if __name__ == '__main__':
    main()
