export const ledgerListsCss=`
.ledger-list{font-family:inherit}
.ledger-list-scroll{max-height:min(58vh,520px);overflow:auto;border:1px solid #e1ece4;border-radius:12px;margin:14px 0;overscroll-behavior:contain}
.ledger-list-scroll:focus-visible{outline:2px solid #03ac50;outline-offset:2px}
.ledger-list-table{width:100%;min-width:360px;border-collapse:collapse;font-size:inherit}
.ledger-list-table.editing{min-width:560px}
.ledger-list-table th{position:sticky;top:0;z-index:1;background:#f0f8f2;text-align:left;color:#245c39}
.ledger-list-table th,.ledger-list-table td{padding:10px;border-bottom:1px solid #e7eee9;vertical-align:middle}
.ledger-list-table .list-name{min-width:100px;max-width:320px;overflow-wrap:anywhere}
.ledger-list-table .list-amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ledger-list-table .list-date{white-space:nowrap;font-variant-numeric:tabular-nums}
.ledger-list-table input{box-sizing:border-box;min-height:44px;padding:8px;font:inherit}
.ledger-list-table input[type=text]{width:100%;min-width:120px}
.ledger-list-table input[type=number]{width:140px;min-width:130px}
.ledger-list-table input[type=date]{width:160px;min-width:150px}
.ledger-list-table input[type=checkbox]{width:22px;height:22px;padding:0;vertical-align:middle;accent-color:#168447}
.ledger-list-table tbody tr:last-child td{border-bottom:0}
.ledger-list-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ledger-list-actions button{min-height:44px}
.ledger-list-total{margin:12px 0;color:#54715f;font-size:.92rem;font-weight:600;font-variant-numeric:tabular-nums}
.ledger-list-error:empty{display:none}
.excellent-member-badge{display:inline-block;margin-left:5px;padding:2px 5px;border-radius:999px;background:#e5f5e9;color:#176337;font-size:10px;line-height:1.4;white-space:nowrap;vertical-align:middle}
@media(max-width:480px){
  .ledger-list{padding:14px}
  .ledger-list-table th,.ledger-list-table td{padding:9px 8px}
}
`;
