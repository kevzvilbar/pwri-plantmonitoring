import type { BookPart } from './types';
import { Lead, P, H3, List, Ref, Note, ManualFigure, WorkflowStrip } from '../bookPrimitives';
export const partIV : BookPart =   {
    part: 'Part IV â€” Finance',
    chapters: [
      {
        id: 'costs',
        number: 12,
        title: 'Costs & Tariffs',
        dek: 'Everything that feeds a cost-per-unit picture of the operation',
        body: (
          <>
            <Lead>
              Hidden for Operators. Up to six tabs depending on role â€” Rollup, Power, Compare, Prices, Filters,
              and, Manager/Admin only, Budget.
            </Lead>
            <Ref
              cols={['Tab', 'Purpose']}
              rows={[
                ['Rollup', 'Combined production-cost breakdown â€” chemicals, power, other inputs â€” for a plant and period.'],
                ['Power', 'Electric bill entry and history, reconciled against logged power readings.'],
                ['Compare', 'Side-by-side cost/production comparison across plants.'],
                ['Prices', "Unit price list for chemicals â€” feeds the dosing cost estimates in RO Trains."],
                ['Filters', 'Cost tracking for filter media (cartridge filters, AFM, etc.).'],
                ['Budget', 'Budget vs. actual by month, Manager/Admin only.'],
              ]}
            />
            <P>
              Logging a monthly electric bill on the Power tab takes previous and current meter readings â€” total
              kWh is calculated automatically â€” plus generation, distribution, and other charges. Chemical and
              filter prices on the Prices/Filters tabs carry an{' '}
              <strong className="font-sans font-semibold not-italic">effective date</strong> rather than simply
              overwriting the old figure, so a cost calculation for a past period keeps using whatever price
              actually applied at the time, even after today&rsquo;s price changes.
            </P>
          </>
        ),
      },
    ],
  };


