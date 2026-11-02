// Read the saved HWP 5 compound file and compare its paragraph text with the draft.
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const data=readFileSync(new URL('자료/콕끼리_회칙_초안.hwp',root));
assert.equal(data.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1','Expected genuine compound HWP file');
const size=2**data.readUInt16LE(30),miniSize=2**data.readUInt16LE(32);
const sector=id=>data.subarray((id+1)*size,(id+2)*size);
const words=b=>Array.from({length:b.length/4},(_,i)=>b.readUInt32LE(i*4));
const fatIds=words(data.subarray(76,512)).filter(x=>x<0xfffffffa);
let dif=data.readUInt32LE(68);
for(let i=0;i<data.readUInt32LE(72);i++){
  const entries=words(sector(dif)); dif=entries.pop(); fatIds.push(...entries.filter(x=>x<0xfffffffa));
}
const fat=fatIds.flatMap(id=>words(sector(id)));
function chain(start,table,read){
  const parts=[],seen=new Set();
  for(let id=start;id<0xfffffffa;id=table[id]){
    assert(!seen.has(id)&&id<table.length,'Invalid compound-file chain'); seen.add(id);parts.push(read(id));
  }
  return Buffer.concat(parts);
}
const directories=chain(data.readUInt32LE(48),fat,sector);
const streams=[];
for(let i=0;i+128<=directories.length;i+=128){
  const d=directories.subarray(i,i+128),len=d.readUInt16LE(64);
  if(len<2)continue;
  streams.push({name:d.subarray(0,len-2).toString('utf16le'),type:d[66],start:d.readUInt32LE(116),length:Number(d.readBigUInt64LE(120))});
}
const rootEntry=streams.find(x=>x.type===5);
const miniRoot=chain(rootEntry.start,fat,sector).subarray(0,rootEntry.length);
const miniFat=words(chain(data.readUInt32LE(60),fat,sector));
function readStream(s){
  assert(s,'Missing HWP stream');
  return (s.length<data.readUInt32LE(56)?chain(s.start,miniFat,id=>miniRoot.subarray(id*miniSize,(id+1)*miniSize)):chain(s.start,fat,sector)).subarray(0,s.length);
}
const header=readStream(streams.find(x=>x.name==='FileHeader'));
assert(header.toString('ascii',0,17).startsWith('HWP Document File'),'Missing HWP signature');
const compressed=Boolean(header.readUInt32LE(36)&1),paragraphs=[];
for(const stream of streams.filter(x=>x.type===2&&/^Section\d+$/.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name))){
  const raw=readStream(stream),body=compressed?inflateRawSync(raw):raw;
  for(let offset=0;offset<body.length;){
    const record=body.readUInt32LE(offset);offset+=4;
    const tag=record&1023;let length=record>>>20;
    if(length===4095){length=body.readUInt32LE(offset);offset+=4;}
    const payload=body.subarray(offset,offset+length);offset+=length;
    if(tag!==67)continue;
    let text='';
    for(let i=0;i+1<payload.length;i+=2){
      const c=payload.readUInt16LE(i);
      if(c>=32)text+=String.fromCharCode(c);
      else if(c===10||c===13)text+='\n';
      else if(c===9){text+=' ';i+=14;}
      else if([1,2,3,4,5,6,7,8,11,12,14,15,16,17,18,19,20,21,22,23].includes(c))i+=14;
    }
    paragraphs.push(text);
  }
}
const normalize=s=>s.replace(/[\s\uFEFF]/g,'');
const text=normalize(paragraphs.join('\n'));
const source=readFileSync(new URL('자료/콕끼리_회칙_초안.md',root),'utf8').split('## 작성 근거')[0];
let checked=0;
for(const line of source.split(/\r?\n/)){
  if(!line.trim()||/^\|[\s:|-]+\|$/.test(line))continue;
  const values=line.startsWith('|')?line.slice(1,-1).split('|'):[line.replace(/^#{1,3} /,'').replace(/^- /,'').replaceAll('**','')];
  for(const value of values){assert(text.includes(normalize(value)),`Missing text: ${value}`);checked++;}
}
console.log(`PASS: genuine HWP 5, ${data.length} bytes; all ${checked} draft paragraphs/table cells retained.`);
