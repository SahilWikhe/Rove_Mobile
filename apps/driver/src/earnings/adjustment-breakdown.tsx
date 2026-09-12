import { View } from 'react-native';
import { Copy } from '@rove/mobile-ui';
export function AdjustmentBreakdown({
  gross,
  adjustment,
  refund,
  dispute,
}: {
  gross: number;
  adjustment: number;
  refund?: number;
  dispute?: number;
}) {
  const rows = [
    { label: 'Gross trip earnings', amount: gross },
    ...(refund !== undefined && dispute !== undefined
      ? [
          { label: 'Refund adjustments', amount: refund },
          { label: 'Dispute adjustments', amount: dispute },
        ]
      : [{ label: 'Adjustments', amount: adjustment }]),
  ];
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row) => (
        <View
          key={row.label}
          style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}
        >
          <Copy kind="muted" style={{ fontSize: 13, lineHeight: 20 }}>
            {row.label}
          </Copy>
          <Copy style={{ fontSize: 14, lineHeight: 22 }}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.amount / 100)}
          </Copy>
        </View>
      ))}
    </View>
  );
}
