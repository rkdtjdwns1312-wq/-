import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const source=readFileSync(new URL('자료/콕끼리_회칙_초안.md',root),'utf8').split('## 작성 근거')[0].trim();
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let table=false,html='';
for(const line of source.split(/\r?\n/)){
  if(line.startsWith('|')){
    if(/^\|[\s:|-]+\|$/.test(line))continue;
    if(!table){html+='<table bgcolor="#ffffff" bordercolor="#bdcdc2" border="1" cellspacing="0" cellpadding="7" width="100%">';table=true;}
    html+='<tr bgcolor="#ffffff">'+line.slice(1,-1).split('|').map(x=>'<td bgcolor="#ffffff"><font color="#222222">'+esc(x.trim())+'</font></td>').join('')+'</tr>';continue;
  }
  if(table){html+='</table>';table=false;}
  if(!line.trim())continue;
  if(line.startsWith('# '))html+='<h1>'+esc(line.slice(2))+'</h1><p class="period">적용 기간 2026.11.21 ~ 2027.04.30 · 검토용</p>';
  else if(line.startsWith('## '))html+='<h2>'+esc(line.slice(3))+'</h2>';
  else if(/^\*\*제\d+조/.test(line))html+='<h3>'+esc(line.replaceAll('**',''))+'</h3>';
  else html+='<p>'+esc(line.startsWith('- ')?'• '+line.slice(2):line)+'</p>';
}
if(table)html+='</table>';
writeFileSync(new URL('자료/콕끼리_회칙_HWP원본.html',root),'\ufeff<!DOCTYPE html><html lang="ko"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"><title>콕끼리 회칙</title><style>@page{size:A4;margin:20mm}body{font-family:"맑은 고딕",sans-serif;font-size:11pt;line-height:155%;color:#222}h1{font-size:22pt;color:#17613b;text-align:center;margin:0 0 14pt}h2{font-size:15pt;color:#17613b;page-break-before:always;margin:0 0 12pt}h3{font-size:12pt;color:#17613b;margin:15pt 0 6pt;page-break-after:avoid}p{margin:0 0 5pt;orphans:2;widows:2}.period{text-align:center;color:#56685b;font-size:10pt;margin-bottom:18pt}table{border-collapse:collapse;font-size:10pt}td{border:1px solid #bdcdc2;vertical-align:top}tr:first-child{font-weight:bold;background:#eaf3ed}tr{page-break-inside:avoid}</style></head><body>'+html+'</body></html>','utf8');
console.log('Created Hangul import HTML: 18 articles, addendum, current rules table and review notes.');
