import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface UserDetailsStepProps {
  single: { username: string; first_name: string; last_name: string; middle_name: string; suffix: string };
  onFieldChange: (field: string, value: string) => void;
}

export function UserDetailsStep({ single, onFieldChange }: UserDetailsStepProps) {
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onFieldChange(field, e.target.value);

  return (
    <div className="space-y-2">
      <div><Label htmlFor="single-username">Username *</Label><Input id="single-username" autoComplete="username" value={single.username} onChange={set('username')} placeholder="e.g. jdelacruz" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="single-first">First name *</Label><Input id="single-first" autoComplete="given-name" value={single.first_name} onChange={set('first_name')} /></div>
        <div><Label htmlFor="single-last">Last name *</Label><Input id="single-last" autoComplete="family-name" value={single.last_name} onChange={set('last_name')} /></div>
        <div><Label htmlFor="single-middle">Middle name</Label><Input id="single-middle" autoComplete="additional-name" value={single.middle_name} onChange={set('middle_name')} /></div>
        <div><Label htmlFor="single-suffix">Suffix</Label><Input id="single-suffix" autoComplete="honorific-suffix" value={single.suffix} onChange={set('suffix')} placeholder="Jr., Sr.…" /></div>
      </div>
    </div>
  );
}
