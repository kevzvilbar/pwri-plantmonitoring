import AdminPage from '@/features/admin/pages/AdminPage';
import { AdminIdleLock } from '@/features/auth/components/AdminIdleLock';

// Idle re-verification (TOTP) for the Admin console; never signs out (offline queue stays intact).
export default function Admin() {
  return (
    <AdminIdleLock>
      <AdminPage />
    </AdminIdleLock>
  );
}
