# Reset program funding controls

Date: 2026-10-03

## Change

Cabinet program funding now distinguishes four controls:

- Required by law: fixed at 100 percent.
- Adjustable: Cabinet may request 0 to 200 percent.
- No separate allocation: no Cabinet funding control is shown.
- Externally settled: the existing specialized finance system remains authoritative.

Mixed law families resolve from the enacted policy option. Opening US, UK, and JP programs use country-specific 1991 classifications.

## Verification

Command:

```text
npm run test:run -- scripts/sim/resetPaidCash240.test.ts src/lib/resetLegislation/rules/fundingControl.test.ts src/lib/resetCabinet/rules/programRoster.test.ts src/lib/resetCabinet/rules/allocation.test.ts src/lib/resetCabinet/readModel.test.ts src/lib/resetFinance/rules/liveDepartmentTurn.test.ts src/lib/resetFinance/settleCashTurn.test.ts src/app/country/[code]/executive/cabinet/[positionId]/office/components/DepartmentFinancePanel.test.tsx
```

Result: 8 files passed, 47 tests passed.

The 240-turn simulation covered unchanged revenue, revenue shock, and no-issuance cases for the US, UK, and JP. All nine cases produced a maximum cash-reconciliation residual of zero. Lowest paid-authority ratios remained within the valid 0 to 1 range. No emergency advances were created.

Opening working capital is included as a funding source in the department reconciliation invariant. This matches the reset rule that ordinary departments begin with one year of net authority as a buffer.

## Balance impact

The opening configuration remains at 100 percent, so this change does not alter the default program outlay schedule. It prevents Cabinet allocation controls from underfunding or overfunding statutory obligations, hides controls where no separate appropriation exists, and preserves specialized defense and intelligence settlement.
