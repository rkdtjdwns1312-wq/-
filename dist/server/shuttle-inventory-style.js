export const shuttleInventoryCss=`
.shuttle-inventory{font-family:inherit}
.inventory-current{margin:3px 0 0;color:#54715f}.inventory-current strong{color:#176337;font-size:1.2rem;font-variant-numeric:tabular-nums}
.inventory-scroll{max-height:min(62vh,560px);overflow:auto;border:1px solid #e1ece4;border-radius:12px;margin:14px 0;overscroll-behavior:contain}
.inventory-scroll:focus-visible{outline:2px solid #03ac50;outline-offset:2px}
.inventory-table{width:100%;min-width:360px;border-collapse:collapse}
.inventory-table.editing{min-width:600px}
.inventory-table th{position:sticky;top:0;z-index:1;background:#f0f8f2;text-align:left;color:#245c39}
.inventory-table th,.inventory-table td{padding:11px 12px;border-bottom:1px solid #e7eee9;vertical-align:middle}
.inventory-table tbody tr:last-child td{border-bottom:0}
.inventory-table th:nth-child(n+2),.inventory-table td:nth-child(n+2){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.inventory-table input{box-sizing:border-box;min-height:44px;padding:8px;font:inherit}
.inventory-table input[type=date]{width:170px}.inventory-table input[type=number]{width:160px;text-align:right}
.inventory-change,.inventory-total{font-weight:700}.inventory-in{color:#176337}.inventory-out{color:#b2483d}.inventory-total{color:#20422f}
.shuttle-inventory #inventoryError:empty{display:none}
@media(max-width:480px){.shuttle-inventory{padding:14px}.inventory-table th,.inventory-table td{padding:10px 9px}}
`;
