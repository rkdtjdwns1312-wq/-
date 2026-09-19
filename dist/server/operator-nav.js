const links=[
  ['#home','홈'],
  ['#notice','공지사항'],
  ['#schedule','대진표'],
  ['#live','실시간대진'],
  ['#seed','시드현황']
];

// This is deliberately static: `editor` only controls whether the menu exists.
export function operatorNavHtml(editor){
  if(!editor)return '';
  return '<nav class="operator-nav" aria-label="운영진 메뉴">'+links.map(([href,label])=>'<a class="operator-nav-link" href="'+href+'">'+label+'</a>').join('')+'</nav>';
}

export const operatorNavCss=`
body.operator-layout{padding-left:140px}
.operator-nav{position:fixed;left:12px;top:50%;z-index:12;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:112px;max-height:calc(100dvh - 24px);padding:8px;background:#087a3d;color:#fff;border:1px solid #056b34;border-radius:16px;box-shadow:0 8px 24px rgba(5,78,38,.22);transform:translateY(-50%);overflow:auto;overscroll-behavior:contain}
.operator-nav-link{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:7px 8px;border:1px solid transparent;border-radius:10px;color:#fff;font-size:.92rem;font-weight:700;line-height:1.3;text-align:center;text-decoration:none;overflow-wrap:anywhere}
.operator-nav-link:hover{background:#0b9449;border-color:rgba(255,255,255,.45)}
.operator-nav-link:focus-visible{outline:3px solid #fff;outline-offset:2px;background:#0b9449}
.operator-layout main,.operator-layout .match,.operator-layout .teams,.operator-layout .team-wrap{min-width:0}
@media(max-width:650px){
  body.operator-layout{padding-left:78px}
  .operator-nav{left:6px;width:66px;padding:7px 5px;border-radius:12px}
  .operator-nav-link{min-width:44px;min-height:44px;padding:5px 3px;font-size:.72rem;line-height:1.15}
  .operator-layout main{padding:16px 8px}
  .operator-layout main .detail{padding:12px 10px}
  .operator-layout main .round-head{flex-wrap:wrap;gap:6px;padding:8px 10px}
  .operator-layout main .round-head h3{white-space:nowrap;font-size:1rem}
  .operator-layout main .matches{grid-template-columns:minmax(0,1fr)}
  .operator-layout main .match .teams{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;justify-content:stretch}
  .operator-layout main .match .team-wrap{width:100%}
  .operator-layout main .edit-match .team-wrap,.operator-layout main .edit-match .vs,.operator-layout main .edit-match .win-pick{grid-area:auto}
  .operator-layout main .edit-match .vs-cluster{display:flex}
  .operator-layout main .match:not(.edit-match) .team{flex-direction:row;flex-wrap:wrap;justify-content:center;column-gap:4px;row-gap:2px}
}
`;
