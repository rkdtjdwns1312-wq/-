export const scheduleInfoCss=`
.schedule-board-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.schedule-list-row{display:flex;align-items:center;gap:10px;border-bottom:1px solid #e5ebe7}
.schedule-list-row .post{flex:1;min-width:0;border-bottom:0}
.schedule-list-row>button{flex-shrink:0;margin-right:12px;min-height:44px;white-space:nowrap}
@media(max-width:480px){.schedule-list-row{flex-wrap:wrap;padding-bottom:10px}.schedule-list-row .post{flex-basis:100%}.schedule-list-row>button{margin-left:14px}}
.schedule-info{color:#244b34;font-family:inherit;min-width:0}
.schedule-info [hidden]{display:none!important}
.schedule-info h3{margin:0 0 12px;color:#245c39;font-size:1.05rem}
.schedule-info button,.schedule-info input,.schedule-info select{font:inherit}
.schedule-info button{min-height:44px}
.schedule-info-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.schedule-info-actions button{flex:0 0 auto;max-width:100%;padding:9px 12px;border:1px solid #cfe3d4;border-radius:11px;background:#f4faf5;color:#245c39;font-weight:700;white-space:nowrap;cursor:pointer}
.schedule-info-actions button[aria-expanded=true]{border-color:#168447;background:#e8f6ec;color:#176337}
.schedule-info button:focus-visible,.schedule-info input:focus-visible,.schedule-info select:focus-visible{outline:2px solid #168447;outline-offset:2px}
.schedule-info-panel{margin-top:12px;padding:14px;border:1px solid #dcece1;border-radius:14px;background:#fbfffc}
.schedule-info-panel label{display:block;margin:0 0 7px;color:#315b40;font-weight:700}
.schedule-calendar{box-sizing:border-box;width:100%;max-width:350px;margin:0 auto 16px;padding:10px;border:1px solid #e0ede3;border-radius:13px;background:#fff}
.schedule-calendar-nav{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:6px;margin-bottom:8px;text-align:center}
.schedule-calendar-nav button{width:44px;padding:0;border:1px solid #dcece1;border-radius:9px;background:#f4faf5;color:#245c39;font-size:1.1rem;cursor:pointer}
.schedule-calendar-nav strong{min-width:0;color:#245c39;font-size:.98rem}
.schedule-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;width:100%}
.schedule-weekday,.schedule-day,.schedule-calendar-blank{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:0;aspect-ratio:1}
.schedule-weekday{color:#6b8272;font-size:.75rem;font-weight:700}
.schedule-day{min-height:36px;padding:0;border:1px solid transparent;border-radius:9px;background:#f5faf6;color:#2e4e38;font-size:.86rem;font-variant-numeric:tabular-nums;cursor:pointer}
.schedule-day:hover{border-color:#acd2b7;background:#eaf6ed}
.schedule-day.selected{border-color:#168447;background:#168447;color:#fff;font-weight:700}
.schedule-day.today:not(.selected){border-color:#168447;color:#176337;font-weight:700}
.schedule-calendar-blank{pointer-events:none}
.schedule-info-panel input,.schedule-time-fields select{box-sizing:border-box;min-height:44px;padding:9px 11px;border:1px solid #cfe0d3;border-radius:10px;background:#fff;color:#244b34}
.schedule-info-panel #scheduleVenue{width:100%;max-width:100%}
.schedule-time-fields{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.schedule-time-fields label{margin:0}
.schedule-time-fields select{min-width:76px}
.schedule-title-preview{margin:14px 0 0;padding:11px 12px;border-radius:11px;background:#eaf6ed;color:#315b40;overflow-wrap:anywhere}
.schedule-title-preview p{margin:0;line-height:1.55}
.schedule-title-preview strong{color:#176337}
@media(max-width:380px){
  .schedule-calendar-nav{grid-template-columns:36px minmax(0,1fr) 36px;gap:4px}
  .schedule-calendar-nav button{width:36px}
  .schedule-calendar-nav strong{font-size:.82rem;white-space:nowrap}
  .schedule-info-panel{padding:10px}
  .schedule-calendar{padding:7px}
  .schedule-calendar-grid{gap:1px}
  .schedule-weekday{font-size:.7rem}
  .schedule-day{min-height:36px;font-size:.8rem}
}
`;
