import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRelease, showDownload} from '../web-download/app-download.mjs';
const page = 'https://xentinel.example/Descarga.html';
const release = {available:true, packageId:'co.edu.sena.xentinel', version:'1.0.1', versionCode:2,
  sizeBytes:100, sha256:'a'.repeat(64), url:'/downloads/xentinel-1.0.1-2.apk'};
test('only verified matching installer metadata enables download', () => {
  assert.equal(validateRelease(release, page).url, 'https://xentinel.example/downloads/xentinel-1.0.1-2.apk');
  assert.equal(validateRelease({available:false}, page), null);
  for (const change of [{packageId:'other.app'}, {sha256:'invalid'}, {sizeBytes:0}, {url:'https://other.example/file.apk'},
    {url:'javascript:alert(1)'}, {url:'/img/base.apk'}, {url:'/downloads/xentinel-1.0.1-2.apk?old=1'}]) {
    assert.throws(() => validateRelease({...release,...change},page));
  }
});
test('unavailable or broken manifest never exposes a stale download', async () => {
  for (const response of [{ok:true,json:async()=>({available:false})}, {ok:false}]) {
    const elements = new Map(['status','download','version','checksum','file-details'].map(key=>[key,{hidden:true}]));
    await showDownload({getElementById:key=>elements.get(key)}, async()=>response, page);
    assert.equal(elements.get('download').hidden,true);
    assert.equal(elements.get('download').href,undefined);
    assert.ok(elements.get('status').textContent.length>0);
  }
});
