// Run after gradlew :app:assembleRelease. Inspects only the unsigned build output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inspect = spawnSync('python', ['-c', `
import pathlib,zipfile,hashlib,json,struct
p=pathlib.Path('LifeOS/android-build/app/build/outputs/apk/release/app-release-unsigned.apk')
z=zipfile.ZipFile(p)
m=z.getinfo('assets/speech/vosk-model-small-en-us-0.15.zip')
dex=b''.join(z.read(i) for i in z.namelist() if i.endswith('.dex'))
methods=['listen','startContinuous','stopContinuous','recognitionEngine','setMuted','speak','stopSpeak','cancel','setWebMicrophoneInUse','echoCancellationAvailable']
alignment={}
for name in z.namelist():
 if not name.endswith('.so') or not ('arm64-v8a/' in name or 'x86_64/' in name): continue
 data=z.read(name)
 endian='<' if data[5]==1 else '>'
 offset=struct.unpack_from(endian+'Q',data,32)[0]
 size,count=struct.unpack_from(endian+'HH',data,54)
 alignment[name]=[struct.unpack_from(endian+'Q',data,offset+n*size+48)[0] for n in range(count) if struct.unpack_from(endian+'I',data,offset+n*size)[0]==1]
print(json.dumps({'apkBytes':p.stat().st_size,'modelBytes':m.file_size,'modelStored':m.compress_type==zipfile.ZIP_STORED,'modelSha256':hashlib.sha256(z.read(m)).hexdigest(),'abis':sorted(set(i.split('/')[1] for i in z.namelist() if i.startswith('lib/'))),'apiNames':{s:s.encode() in dex for s in methods},'notices':[i for i in z.namelist() if i.startswith('assets/speech/') and i.endswith('.txt')],'native64BitLoadAlignment':alignment}))
`], { cwd: root, encoding: 'utf8' });
assert.equal(inspect.status, 0, `${inspect.error ?? ''}\n${inspect.stdout}\n${inspect.stderr}`);
const result = JSON.parse(inspect.stdout);
assert.equal(result.modelBytes, 41205931);
assert.equal(result.modelStored, true, 'model archive must not be double-compressed in the APK');
assert.equal(result.modelSha256, '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498');
assert.deepEqual(result.abis, ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']);
for (const [name, present] of Object.entries(result.apiNames)) assert.equal(present, true, `release shrinker removed native API ${name}`);
for (const notice of ['NOTICE.txt', 'LICENSE-APACHE-2.0.txt', 'JNA-LICENSE.txt']) assert.ok(result.notices.includes(`assets/speech/${notice}`));
for (const [name, alignments] of Object.entries(result.native64BitLoadAlignment)) assert.ok(alignments.every(value => value >= 16384), `${name} needs 16 KB page compatibility`);
console.log(JSON.stringify(result, null, 2));
console.log('Unsigned APK speech packaging checks passed');
