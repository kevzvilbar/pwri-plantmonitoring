import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { StaffMember } from '@/features/admin/employees/types';
import { PendingApprovals } from './PendingApprovals';

const user = (id: string, first: string, last: string) =>
  ({ id, first_name: first, last_name: last, username: first.toLowerCase(), designation: 'Operator', status: 'Pending' }) as unknown as StaffMember;

describe('PendingApprovals (Admin → Users queue)', () => {
  it('renders nothing when nobody is waiting', () => {
    const { container } = render(<PendingApprovals pending={[]} onApprove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists each waiting account and the count', () => {
    render(<PendingApprovals pending={[user('u1', 'Ana', 'Cruz'), user('u2', 'Ben', 'Reyes')]} onApprove={vi.fn()} />);
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText('Ben Reyes')).toBeInTheDocument();
  });

  it('approves through the callback it is given, and never touches the database itself', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<PendingApprovals pending={[user('u1', 'Ana', 'Cruz')]} onApprove={onApprove} />);
    fireEvent.click(screen.getByTestId('pending-approve-u1'));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('u1', 'Ana Cruz'));
  });

  it('disables that account\'s button while its approval is in flight, then re-enables it', async () => {
    let finish!: () => void;
    const onApprove = vi.fn(() => new Promise<void>((res) => { finish = res; }));
    render(<PendingApprovals pending={[user('u1', 'Ana', 'Cruz'), user('u2', 'Ben', 'Reyes')]} onApprove={onApprove} />);
    fireEvent.click(screen.getByTestId('pending-approve-u1'));
    await waitFor(() => expect(screen.getByTestId('pending-approve-u1')).toBeDisabled());
    expect(screen.getByTestId('pending-approve-u2')).not.toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByTestId('pending-approve-u1')).not.toBeDisabled());
  });
});
