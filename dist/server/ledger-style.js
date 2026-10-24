export const ledgerCss=`
.ledger{min-width:0;padding:24px;background:#fff}
.ledger-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ledger-actions{display:flex;gap:8px;flex-wrap:wrap}
.ledger-actions button,.ledger button{min-height:44px;white-space:nowrap}
.ledger-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}
.ledger-summary>div{min-width:0;background:#f6faf7;border:1px solid #e1ece4;border-radius:12px;padding:12px;color:#54715f;font-size:.9rem}
.ledger-summary>div:last-child{background:#edf8f0;border-color:#cfe6d5}
.ledger-summary strong{display:block;font-size:1.15rem;color:#20422f;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.ledger-summary>div:last-child strong{color:#176337}
.ledger-income{color:#176337!important}.ledger-expense{color:#a13a30!important}
.ledger-opening{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ledger-opening input{max-width:240px}
.ledger-scroll{max-width:100%;overflow-x:auto;border:1px solid #e1ece4;border-radius:12px;margin:14px 0}
.ledger-scroll:focus-visible{outline:2px solid #03ac50;outline-offset:2px}
.ledger-table{width:100%;min-width:780px;border-collapse:collapse;font-size:.9rem}
.ledger-table th{background:#f0f8f2;text-align:left;color:#245c39}
.ledger-table th,.ledger-table td{padding:12px 10px;border-bottom:1px solid #e7eee9;vertical-align:middle}
.ledger-table td:nth-child(1){white-space:nowrap}
.ledger-table td:nth-child(n+3):nth-child(-n+5){text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ledger-table td:nth-child(2),.ledger-table td:nth-child(6){min-width:150px;max-width:300px;overflow-wrap:anywhere}
.ledger-table input{min-width:120px;width:100%;min-height:44px;padding:8px;font-size:16px}
.ledger-table input[type=date]{min-width:150px}.ledger-table input[type=number]{min-width:130px}
.ledger-table tbody tr:last-child td{border-bottom:0}
.ledger-memo{box-sizing:border-box;width:min(560px,calc(100vw - 28px));max-height:85vh;max-height:85dvh;overflow:auto;border:1px solid #cfe4d5;border-radius:16px;background:#fff;padding:20px;color:#24392e}
.ledger-memo::backdrop{background:#14251e66}
.ledger-memo textarea{box-sizing:border-box;width:100%;min-height:220px;font-size:16px;line-height:1.6;padding:12px;resize:vertical;border:1px solid #d6e6da;border-radius:9px;background:#fff}
.ledger-note-paper{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;padding:16px;background:#f1f8f3;border:1px solid #dfebe2;border-left:3px solid #8bc99d;color:#344039;border-radius:9px;min-height:120px}
.ledger-memo h2{margin:0}.ledger-memo .muted{overflow-wrap:anywhere}
.ledger #ledgerError:empty{display:none}
@media(max-width:650px){
  .ledger{padding:14px}
  .ledger-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .ledger-summary strong{font-size:1rem}
  .ledger-summary>div{padding:10px}
  .ledger-heading h1{font-size:1.9rem}
}
@media(max-width:390px){
  .ledger{padding:14px}
  .ledger-heading{align-items:flex-start}
  .ledger-heading h1{font-size:1.75rem}
  .ledger-actions{gap:6px}
  .ledger-actions button{padding:9px 11px}
  .ledger-memo{padding:16px;border-radius:14px}
  .ledger-note-paper{padding:13px}
}
@media(max-width:480px){
  .operator-layout .ledger-summary{grid-template-columns:minmax(0,1fr)}
}
`;
