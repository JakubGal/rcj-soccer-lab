import { SimulatorApp } from '@/components/simulator/SimulatorApp';
import { LocalizationProvider } from '@/components/i18n/LocalizationProvider';
import { AccountProvider } from '@/components/account';

export const dynamic = 'force-static';

export default function Home() {
  return (
    <LocalizationProvider>
      <AccountProvider>
        <SimulatorApp />
      </AccountProvider>
    </LocalizationProvider>
  );
}
