import { PageHeader } from '@/components/PageHeader';
import { AppManual } from './AppManual';

/** The operations manual on its own route, opened from the avatar menu, so
 *  every role can reach it without going through Employees. */
export default function HelpPage() {
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Help & Manual" subtitle="How PWRI works, chapter by chapter" />
      <AppManual />
    </div>
  );
}
