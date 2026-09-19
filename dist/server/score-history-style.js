export const scoreHistoryCss=`
dialog:has(.score-history-dialog){width:min(720px,calc(100vw - 28px));max-width:calc(100vw - 28px)}.score-history-dialog{width:100%;min-width:0;max-width:100%}
.score-history-dialog .dialog-head{margin-bottom:4px}
.score-history-open{appearance:none;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-align:left}
.score-history-open:hover,.score-history-open:focus{text-decoration:underline;color:#176337}
.score-history-summary{margin:0 0 10px;color:#4f6759;font-size:.9rem}
.score-history-scroll{overflow-x:auto;overscroll-behavior-x:contain;border:1px solid #dcece1;border-radius:12px;background:#fbfffc;scroll-snap-type:x mandatory}
.score-history-track{display:flex;align-items:stretch}.score-history-segment{flex:0 0 100%;width:100%;min-width:0;scroll-snap-align:start;padding:10px;box-sizing:border-box}.score-history-segment h3{margin:0 0 5px;font-size:.9rem;color:#245c39}
.score-history-svg{display:block;width:100%;height:auto;overflow:visible}.score-history-grid{stroke:#dcece1;stroke-width:1}.score-history-axis-label{fill:#708078;font-size:12px}.score-history-line{fill:none;stroke:#03a84e;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.score-history-point{fill:#fff;stroke:#03a84e;stroke-width:3;cursor:pointer}.score-history-point:focus{outline:none;stroke:#176337;stroke-width:5}.score-history-point.selected{fill:#03a84e}
.score-history-empty{margin:25px 0;text-align:center;color:#708078}.score-history-note{margin:9px 0;color:#708078;font-size:.8rem}.score-history-details{margin-top:10px}.score-history-details summary{cursor:pointer;color:#245c39;font-weight:700}.score-history-details ul{margin:8px 0 0;padding-left:18px}.score-history-details li{margin:4px 0}.score-history-popup{min-height:2.5em;margin:9px 0;padding:8px 10px;border-radius:9px;background:#eafff1;color:#245c39;font-size:.88rem}.score-history-actions{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:12px}.score-history-actions button{font-size:.86rem}.score-history-actions .score-history-return{margin-left:auto}
@media(max-width:500px){.score-history-segment{padding:7px}.score-history-axis-label{font-size:12px}}
`;
