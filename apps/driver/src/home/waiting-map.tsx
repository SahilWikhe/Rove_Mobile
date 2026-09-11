import { View } from 'react-native';
import { Copy, theme } from '@rove/mobile-ui';

export function WaitingMap({ synthetic }: { synthetic: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.raised, justifyContent: 'center', padding: 24 }}>
      <Copy kind="muted">
        {synthetic ? 'Synthetic location · ' : ''}The live map is available in the iOS and Android apps.
      </Copy>
    </View>
  );
}
