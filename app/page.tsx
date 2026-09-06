import { SimulatorApp } from '@/components/simulator/SimulatorApp';
import { LocalizationProvider } from '@/components/i18n/LocalizationProvider';

export const dynamic = 'force-static';

export default function Home() {
  return (
    <LocalizationProvider>
      <SimulatorApp />
    </LocalizationProvider>
  );
}
