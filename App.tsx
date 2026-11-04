import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ShiftLightScreen } from './src/ui/ShiftLightScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ShiftLightScreen />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
